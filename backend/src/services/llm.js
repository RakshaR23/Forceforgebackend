// LLM service — Groq provider + deterministic fallback.
//
// Isolated from Express routes: services/judge.js calls `judgeWithLLM()`.
// Routes never touch this module's internals or the API key.
//
// IMPORTANT: GROQ_API_KEY lives only on the server (config) and is never
// sent to the client or included in any API response. Logging below
// deliberately avoids API keys and full user input.

const config = require('../config');
const { BOUNCER_SYSTEM_PROMPT, buildBouncerUserMessage } = require('./bouncerPrompt');

const VALID_NEEDS = ['tired', 'bored', 'stressed', 'lonely', 'avoiding', 'genuine'];
const VALID_VERDICTS = ['deny', 'task', 'allow'];

const DEFAULT_TIMEOUT_MS = 10000;

class LlmService {
  constructor() {
    this.model = config.groqModel;
    // Server-side only. Never expose via routes/responses/logs.
    this.apiKey = config.groqApiKey;
    this._client = null;
  }

  isMockMode() {
    // Default to mock mode unless explicitly disabled with MOCK_MODE=false.
    if (process.env.MOCK_MODE !== undefined) return process.env.MOCK_MODE !== 'false';
    return config.mockMode;
  }

  getTimeoutMs() {
    if (process.env.LLM_TIMEOUT_MS !== undefined) {
      const parsed = parseInt(process.env.LLM_TIMEOUT_MS, 10);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    return config.llmTimeoutMs || DEFAULT_TIMEOUT_MS;
  }

  /**
   * Provider interface used by the judge service.
   * Sends energy / excuse / optional platform / optional requestedMinutes
   * to the LLM and returns STRICT JSON per schema:
   * { need, verdict, reason, action, resetSeconds }.
   *
   * Never throws for provider failures: JSON parse errors, schema
   * failures, timeouts, Groq errors, or a missing API key all fall back
   * to the deterministic mock judge (success: true).
   *
   * @param {{ energy: number, excuse: string, platform?: string, requestedMinutes?: number }} input
   * @returns {Promise<{ success: boolean, need?: string, verdict?: string, reason?: string, action?: string, resetSeconds?: number, message?: string }>}
   */
  async judgeWithLLM({ energy, excuse, platform, requestedMinutes }) {
    if (this.isMockMode()) {
      return this._mockJudge({ energy, excuse, platform, requestedMinutes });
    }

    const apiKey = (process.env.GROQ_API_KEY || this.apiKey || '').trim();
    if (!apiKey) {
      console.warn('GROQ_API_KEY missing — using fallback judge.');
      return this._mockJudge({ energy, excuse, platform, requestedMinutes });
    }

    try {
      const raw = await this._callGroq({ energy, excuse, platform, requestedMinutes, apiKey });
      const parsed = this._extractJson(raw);
      if (!parsed) {
        console.warn('Groq response was not valid JSON — using fallback judge.');
        return this._mockJudge({ energy, excuse, platform, requestedMinutes });
      }
      const schemaError = this._validateSchema(parsed);
      if (schemaError) {
        console.warn(`Groq JSON failed schema validation (${schemaError}) — using fallback judge.`);
        return this._mockJudge({ energy, excuse, platform, requestedMinutes });
      }
      return {
        success: true,
        need: parsed.need,
        verdict: parsed.verdict,
        reason: parsed.reason,
        action: parsed.action,
        resetSeconds: parsed.resetSeconds,
      };
    } catch (err) {
      // Log only the error message — never the key or full user input.
      console.warn(`Groq request failed (${err && err.message ? err.message : 'unknown error'}) — using fallback judge.`);
      return this._mockJudge({ energy, excuse, platform, requestedMinutes });
    }
  }

  // ---- Groq provider ----
  _getClient(apiKey) {
    if (this._client) return this._client;
    let Groq;
    try {
      ({ Groq } = require('groq-sdk'));
    } catch (err) {
      throw new Error('groq-sdk is not installed. Run: npm install groq-sdk');
    }
    this._client = new Groq({ apiKey, timeout: this.getTimeoutMs() });
    return this._client;
  }

  async _callGroq({ energy, excuse, platform, requestedMinutes, apiKey }) {
    const model = process.env.GROQ_MODEL || this.model;
    const client = this._getClient(apiKey);
    // Production prompt: system carries the rules, user message carries the
    // untrusted inputs as data. _buildPrompt() (below) builds the user part.
    const system = BOUNCER_SYSTEM_PROMPT;
    const prompt = this._buildPrompt({ energy, excuse, platform, requestedMinutes });

    const request = client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
      max_tokens: 500,
      response_format: { type: 'json_object' },
    });

    const completion = await this._withTimeout(request, this.getTimeoutMs());
    const content =
      completion &&
      completion.choices &&
      completion.choices[0] &&
      completion.choices[0].message
        ? completion.choices[0].message.content
        : '';
    if (!content || typeof content !== 'string') {
      throw new Error('Groq returned an empty response');
    }
    return content;
  }

  _withTimeout(promise, ms) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Groq request timed out after ${ms}ms`)), ms);
    });
    return Promise.race([
      Promise.resolve(promise).finally(() => clearTimeout(timer)),
      timeout,
    ]);
  }

  // Models sometimes wrap JSON in fences or add prose — extract the object.
  _extractJson(raw) {
    if (typeof raw !== 'string') return null;
    let text = raw.trim();
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) text = fence[1].trim();
    if (text.startsWith('{') && text.endsWith('}')) {
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    }
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }

  // Server-side schema check. Never trust LLM output blindly.
  _validateSchema(parsed) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 'not an object';
    if (!VALID_NEEDS.includes(parsed.need)) return 'invalid need';
    if (!VALID_VERDICTS.includes(parsed.verdict)) return 'invalid verdict';
    if (typeof parsed.reason !== 'string' || parsed.reason.trim().length === 0) {
      return 'invalid reason';
    }
    if (typeof parsed.action !== 'string' || parsed.action.trim().length === 0) {
      return 'invalid action';
    }
    if (typeof parsed.resetSeconds !== 'number' || !Number.isFinite(parsed.resetSeconds)) {
      return 'invalid resetSeconds';
    }
    return null;
  }

  // User message for the Groq call. Delegates to the versioned prompt
  // module so the production wording lives in one place. Kept as a method
  // for backward compatibility with existing callers/tests.
  _buildPrompt({ energy, excuse, platform, requestedMinutes }) {
    return buildBouncerUserMessage({ energy, excuse, platform, requestedMinutes });
  }

  // ---- Deterministic fallback / mock judge (MOCK_MODE=true) ----
  // Uses only energy + excuse keywords + requestedMinutes. Fully
  // deterministic: same input -> same output, so frontend development and
  // testing are predictable. Returns the same response schema as the real
  // LLM. Also used as the automatic fallback for every Groq failure mode
  // (parse / schema / timeout / error / missing key).
  _mockJudge({ energy, excuse, platform, requestedMinutes }) {
    return this._fallbackJudge({ energy, excuse, platform, requestedMinutes });
  }

  _fallbackJudge({ energy, excuse, platform, requestedMinutes }) {
    const text = `${excuse || ''} ${platform || ''}`.toLowerCase();
    const e = Number.isInteger(energy) ? energy : 3;

    const has = (...keywords) => keywords.some((k) => text.includes(k));

    let need;
    if (e <= 2 && has('tired', 'exhaust', 'sleepy')) {
      need = 'tired';
    } else if (has('bored', 'nothing to do')) {
      need = 'bored';
    } else if (has('stress', 'overwhelm')) {
      need = 'stressed';
    } else if (has('lonely', 'no one')) {
      need = 'lonely';
    } else if (has('assignment', 'exam', 'homework', 'work', 'later')) {
      need = 'avoiding';
    } else {
      need = 'genuine';
    }

    let verdict;
    let reason;
    let action;
    let resetSeconds;

    switch (need) {
      case 'tired':
        verdict = 'deny';
        reason = 'Your response suggests you are mainly trying to recover from fatigue.';
        action = 'Take a short 2-minute reset before deciding.';
        resetSeconds = 120;
        break;
      case 'bored':
        verdict = 'task';
        reason = 'You seem to be looking for stimulation rather than rest.';
        action = 'Try a 5-minute focused work sprint instead.';
        resetSeconds = 60;
        break;
      case 'stressed':
        verdict = 'task';
        reason = 'You seem under pressure, so a short calming task will help more than scrolling.';
        action = 'Do a 90-second breathing reset, then work for 5 minutes.';
        resetSeconds = 90;
        break;
      case 'lonely':
        verdict = 'task';
        reason = 'You seem to be seeking connection rather than rest.';
        action = 'Send one quick check-in message, then return to focus for 5 minutes.';
        resetSeconds = 60;
        break;
      case 'avoiding':
        verdict = 'deny';
        reason = 'This looks like avoidance rather than a real need for a break.';
        action = 'Work for 2 minutes first, then reassess if you still need a break.';
        resetSeconds = 120;
        break;
      default: // genuine
        // Deterministic use of requestedMinutes: unusually long requested
        // breaks (>30 min) earn a short task first instead of a blank allow.
        if (Number.isInteger(requestedMinutes) && requestedMinutes > 30) {
          verdict = 'task';
          reason = 'This seems reasonable, but the break you asked for is long.';
          action = 'Complete a 5-minute focused sprint first, then take your break.';
          resetSeconds = 60;
        } else {
          verdict = 'allow';
          reason = 'This looks like a legitimate need, so a short break is reasonable.';
          action = 'Take your break and return when the timer ends.';
          resetSeconds = 0;
        }
        break;
    }

    return { success: true, need, verdict, reason, action, resetSeconds };
  }
}

module.exports = new LlmService();
module.exports.LlmService = LlmService;
module.exports.VALID_NEEDS = VALID_NEEDS;
module.exports.VALID_VERDICTS = VALID_VERDICTS;
