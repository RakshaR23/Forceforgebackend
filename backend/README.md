# FocusForge Backend

Express API with security, rate limiting, and the AI Bouncer judging API (Groq + deterministic fallback).

## Structure

```
backend/
  src/
    server.js              # Express app entry point
    config.js              # dotenv-based environment config
    routes/
      judge.js             # POST /judge (thin route, no AI logic)
      stats.js             # Stats routes (stub)
    services/
      judge.js             # Decision logic: validate LLM JSON + server-side rules
      llm.js               # Provider interface + deterministic mock (MOCK_MODE=true)
      bouncerPrompt.js     # Fixed production system prompt + user-message builder
      attemptTracker.js    # Server-side limits + escalation (in-memory store)
    middleware/
      rateLimit.js         # AI-API rate limiting
      security.js          # Extra security headers
    utils/
      validation.js        # Validation + sanitize + prompt-injection detection
  .env                     # Local env (not committed)
  .env.example             # Env placeholders
  package.json
  README.md
```

## Install

```bash
cd backend
npm install
```

## Start

```bash
npm run dev   # nodemon, auto-reload (development)
npm start     # node src/server.js (production)
```

Server runs on `http://localhost:5000` by default (see `PORT`).
`MOCK_MODE=true` (default) uses the deterministic mock — no network calls.
Set `MOCK_MODE=false` plus `GROQ_API_KEY` for live Groq judging; any Groq
failure (bad JSON, schema error, timeout, API error, missing key) falls back
to the deterministic mock automatically.

## Test

```bash
curl http://localhost:5000/health
# {"success":true,"message":"FocusForge backend is running","mockMode":true}
# mockMode mirrors MOCK_MODE (true = deterministic mock judge, no Groq calls)
```

## Judge API

`POST /judge` (also available as `POST /api/judge` for backwards compatibility).

Request:

```json
{
  "energy": 1,
  "excuse": "I'm tired and want to watch YouTube for a while",
  "context": {
    "platform": "youtube",
    "requestedMinutes": 10
  }
}
```

- `energy`: integer 1–5 (required)
- `excuse`: non-empty string, max 500 chars (required)
- `context.platform`: string (optional)
- `context.requestedMinutes`: integer 1–60 (optional)
- Flat `platform` / `requestedMinutes` top-level fields are also accepted.
- Any client-supplied `verdict` / `need` is ignored — the decision is server-side.

Success response:

```json
{
  "success": true,
  "verdict": "deny",
  "need": "tired",
  "reason": "Your response suggests you are mainly trying to recover from fatigue.",
  "action": "Take a short 2-minute reset before deciding.",
  "resetSeconds": 120,
  "escalation": { "level": 0, "cooldownSeconds": 0 }
}
```

- `need`: exactly one of `tired|bored|stressed|lonely|avoiding|genuine`
- `verdict`: exactly one of `deny|task|allow`
- `resetSeconds`: 60–120 for `deny`/`task`, `0` for `allow`
- Invalid input returns `400 { success: false, message }`.

### curl examples

1. Tired user → `deny / tired / 120`:

```bash
curl -X POST http://localhost:5000/judge \
  -H "Content-Type: application/json" \
  -d '{"energy":1,"excuse":"I'"'"'m tired and want to watch YouTube for a while","context":{"platform":"youtube","requestedMinutes":10}}'
```

2. Bored user → `task / bored / 60`:

```bash
curl -X POST http://localhost:5000/judge \
  -H "Content-Type: application/json" \
  -d '{"energy":3,"excuse":"I am bored, there is nothing to do","context":{"platform":"tiktok","requestedMinutes":5}}'
```

3. Genuine user → `allow / genuine / 0`:

```bash
curl -X POST http://localhost:5000/judge \
  -H "Content-Type: application/json" \
  -d '{"energy":5,"excuse":"I need to join an important family video call","context":{"requestedMinutes":10}}'
```

4. Invalid energy → `400`:

```bash
curl -X POST http://localhost:5000/judge \
  -H "Content-Type: application/json" \
  -d '{"energy":9,"excuse":"test"}'
# {"success":false,"message":"energy must be an integer from 1 to 5"}
```

5. Excessively long excuse → `400`:

```bash
python3 -c "print('{\"energy\": 3, \"excuse\": \"' + 'a'*501 + '\"}')" > /tmp/long.json
curl -X POST http://localhost:5000/judge \
  -H "Content-Type: application/json" -d @/tmp/long.json
# {"success":false,"message":"excuse must not exceed 500 characters"}
```

## Env

Copy `.env.example` to `.env`:

| Variable | Example | Description |
|---|---|---|
| `PORT` | `5000` | Server port |
| `GROQ_API_KEY` | `` | Server-side only, never exposed to client |
| `GROQ_MODEL` | `llama-3.1-8b-instant` | Model used when `MOCK_MODE=false` |
| `MOCK_MODE` | `true` | `true` = deterministic mock judge, no live AI calls |
| `MAX_REQUESTS_PER_MINUTE` | `30` | Rate limit for `/api/*` and `/judge` + per-client judge attempts/min |
| `MAX_JUDGES_PER_SESSION` | `20` | Max consecutive deny/task verdicts per client in the escalation window (429 after) |
| `ESCALATION_WINDOW_MINUTES` | `30` | Sliding window for attempt history + escalation streaks |
| `LLM_TIMEOUT_MS` | `10000` | Configurable timeout for the Groq request |

## Notes

- `GROQ_API_KEY` is read only via `src/config.js` / `src/services/llm.js` on the server and never returned in responses.
- Flow: `validate → sanitize → detect prompt injection → judge service → LLM → validate LLM JSON → server-side rules → final verdict`.
- Mock judge (`MOCK_MODE=true`) is deterministic — same input always yields the same output, and Groq is never called. Needs are classified in this order:

| Condition | `need` → `verdict` / `resetSeconds` |
|---|---|
| energy ≤ 2 + `tired`/`exhausted`/`sleepy` | tired → deny / 120 |
| `bored` / `nothing to do` | bored → task / 60 |
| `stress` / `overwhelmed` | stressed → task / 90 |
| `lonely` / `no one` | lonely → task / 60 |
| `assignment` / `exam` / `homework` / `work` / `later` | avoiding → deny / 120 |
| otherwise | genuine → allow / 0 (or task / 60 if `requestedMinutes` > 30) |
- Live mode (`MOCK_MODE=false`): `services/llm.js` calls Groq (`groq-sdk`, `response_format: json_object`, strict prompt) with a configurable timeout; every failure mode falls back to the mock. Logs contain only error messages/metadata — never the API key or full user input.

## Security (hardened `/judge`)

- The excuse is untrusted data: validated (energy 1–5, excuse 1–500 chars), sanitized (control chars stripped, injection directives redacted globally, benign words like "secret" left intact), and sent only as a separate user/data message — the system prompt is a fixed constant with no user interpolation.
- Injection detection never rejects legitimate users: flagged requests are redacted, logged, and still receive a server-computed verdict. Client-supplied `verdict`/`need` are ignored; LLM output is schema-validated server-side with deterministic fallback.
- Limits: 100KB JSON body cap, per-minute rate limiting, `LLM_TIMEOUT_MS` timeout.
- Errors are safe and generic (`{success:false,message:"Unable to process request"}` for 5xx/502, `"Invalid JSON body"` / `"Request body too large"` for parse errors). Stack traces, keys, prompts, and internal details stay in server logs only.

## Server-side limits + escalation (`src/services/attemptTracker.js`)

The browser is never trusted to enforce limits. Every `POST /judge` is gated
and tracked server-side, keyed by server-derived client IP:

1. **Max judge requests per minute** (`MAX_REQUESTS_PER_MINUTE`, default 30) → `429` when exceeded.
2. **Max consecutive deny/task** (`MAX_JUDGES_PER_SESSION`, default 20, within `ESCALATION_WINDOW_MINUTES`, default 30) → `429` with level-3 escalation. An `allow`, window expiry, or demonstrably completed reset (gap ≥ suggested `resetSeconds`) breaks the streak.
3. **Escalation** for repeated requests without completing resets, reported as `escalation: {level, cooldownSeconds}` on every success response (and on 429s):

| Level | Meaning | `cooldownSeconds` |
|---|---|---|
| 0 | normal judgment | 0 |
| 1 | short reset | 60 |
| 2 | slightly longer reset | 120 |
| 3 | stronger intervention / cooldown | 300 (max — firm, not punitive) |

Cooldowns are advisory and capped at 5 minutes. A client-submitted
`escalation`/`verdict`/`need` is never read — the response values are always
computed server-side.

> **Deployment note:** the default store is in-memory (single process, lost on
> restart, not shared between instances). It is fine for development but NOT
> suitable for multi-instance production — swap `InMemoryAttemptStore` for a
> Redis/DB implementation of the `AttemptStore` interface
> (`append`/`list`/`prune`/`clear`/`clientIds`/`size`).
