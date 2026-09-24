const { Groq } = require('groq');

const DEFAULT_MODEL = 'llama-3.1-8b-instant';
const DEFAULT_TIMEOUT = 10000;

const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+previous\s+instruction/i,
  /ignore\s+system\s+prompt/i,
  /system\s+message/i,
  /developer\s+message/i,
  /reveal\s+prompt/i,
  /reveal\s+instructions/i,
  /api\s+key/i,
  /secret/i,
  /jailbreak/i,
  /override\s+rules/i,
  /return\s+allow\s+regardless/i,
  /pretend\s+you\s+are/i,
  /act\s+as\s+developer/i,
];

const VALID_NEEDS = ['tired', 'bored', 'stressed', 'lonely', 'avoiding', 'genuine'];
const VALID_VERDICTS = ['deny', 'task', 'allow'];

class LLMService {
  constructor() {
    this.mockMode = process.env.MOCK_MODE === 'true';
    this.apiKey = process.env.GROQ_API_KEY;
    this.model = process.env.GROQ_MODEL || DEFAULT_MODEL;
    this.timeout = parseInt(process.env.LLM_TIMEOUT) || DEFAULT_TIMEOUT;
    this.client = this.mockMode ? null : new Groq({ apiKey: this.apiKey });
  }

  async judgeWithLLM({ energy, excuse, platform, requestedMinutes }) {
    if (this.mockMode) {
      return this._mockJudge({ energy, excuse, platform, requestedMinutes });
    }

    if (!this.apiKey) {
      return this._fallbackJudge({ energy, excuse, platform, requestedMinutes });
    }

    try {
      const sanitizedExcuse = this._sanitizeInput(excuse);
      const prompt = this._buildPrompt({ energy, excuse: sanitizedExcuse, platform, requestedMinutes });

      const result = await this._withTimeout(
        this.client.chat.completions.create({
          model: this.model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.2,
          max_tokens: 500,
          response_format: { type: 'json_object' },
        }),
        this.timeout
      );

      const content = result.choices[0].message.content;
      if (!content) {
        return this._fallbackJudge({ energy, excuse, platform, requestedMinutes });
      }

      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch {
        return this._fallbackJudge({ energy, excuse, platform, requestedMinutes });
      }

      if (!this._validateResponse(parsed)) {
        return this._fallbackJudge({ energy, excuse, platform, requestedMinutes });
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
      return this._fallbackJudge({ energy, excuse, platform, requestedMinutes });
    }
  }

  _sanitizeInput(input) {
    if (typeof input !== 'string') return input;
    let sanitized = input;
    for (const pattern of PROMPT_INJECTION_PATTERNS) {
      sanitized = sanitized.replace(pattern, '[REDACTED]');
    }
    return sanitized;
  }

  _validateResponse(parsed) {
    if (
      !parsed.need ||
      !VALID_NEEDS.includes(parsed.need) ||
      !parsed.verdict ||
      !VALID_VERDICTS.includes(parsed.verdict) ||
      typeof parsed.reason !== 'string' ||
      parsed.reason.length === 0 ||
      typeof parsed.action !== 'string' ||
      parsed.action.length === 0 ||
      typeof parsed.resetSeconds !== 'number'
    ) {
      return false;
    }
    return true;
  }

  _buildPrompt({ energy, excuse, platform, requestedMinutes }) {
    const platformStr = platform ? ` on platform: ${platform}` : '';
    const minutesStr = requestedMinutes !== undefined ? ` requested minutes: ${requestedMinutes}` : '';

    return `You are an AI assistant for a focus app. A user is asking for an extension.

Energy level (1-5): ${energy}
Excuse: "${excuse}"
Context:${platformStr}${minutesStr}

Classify the user's underlying need into exactly one of: tired, bored, stressed, lonely, avoiding, genuine.
Then determine a verdict: deny, task, or allow.

Return STRICT JSON only with this exact schema:
{
  "need": "tired|bored|stressed|lonely|avoiding|genuine",
  "verdict": "deny|task|allow",
  "reason": "concise explanation",
  "action": "practical action",
  "resetSeconds": number
}

Be concise. Return only the JSON object, no text before or after.`;
  }

  _fallbackJudge({ energy, excuse, platform, requestedMinutes }) {
    return {
      success: true,
      need: this._determineNeedMock(energy),
      verdict: this._determineVerdictMock(energy),
      reason: this._generateReasonMock(energy),
      action: this._generateActionMock(energy),
      resetSeconds: this._generateResetMock(energy),
    };
  }

  _withTimeout(promise, ms) {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Timed out')), ms);
    });
    const race = promise.then(
      (val) => clearTimeout(timeoutId) || val,
      (err) => clearTimeout(timeoutId) || err
    );
    return Promise.race([race, timeoutPromise]);
  }

  _determineNeedMock(energy) {
    const e = parseInt(energy) || 3;
    if (e <= 2) return 'tired';
    if (e <= 3) return 'bored';
    if (e <= 4) return 'stressed';
    return 'avoiding';
  }

  _determineVerdictMock(energy) {
    const e = parseInt(energy) || 3;
    if (e <= 2) return 'deny';
    if (e <= 3) return 'task';
    return 'allow';
  }

  _generateReasonMock(energy) {
    const e = parseInt(energy) || 3;
    if (e <= 2) {
      return 'Your response suggests you are mainly trying to recover from fatigue.';
    }
    if (e <= 3) {
      return 'You seem looking for something to do to pass the time.';
    }
    return 'You appear to be under pressure and need support.';
  }

  _generateActionMock(energy) {
    const e = parseInt(energy) || 3;
    if (e <= 2) {
      return 'Take a short 2-minute reset before deciding.';
    }
    if (e <= 3) {
      return 'Try a 5-minute focused work session.';
    }
    return 'Stay focused on your task.';
  }

  _generateResetMock(energy) {
    const e = parseInt(energy) || 3;
    if (e <= 2) return 120;
    if (e <= 3) return 60;
    return 0;
  }
}

module.exports = new LLMService();