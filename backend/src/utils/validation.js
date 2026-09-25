// Input validation + sanitization helpers for the Judge API.
//
// Flow: validate -> sanitize -> detect prompt injection (sanitize redacts).

function isNonEmptyString(value, maxLength) {
  if (typeof value !== 'string' || value.trim().length === 0) return false;
  if (maxLength && value.length > maxLength) return false;
  return true;
}

function isIntInRange(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

// Accepts both shapes:
//   { energy, excuse, context: { platform, requestedMinutes } }  (spec)
//   { energy, excuse, platform, requestedMinutes }                (legacy/flat)
// Returns { valid, error?, value? } where value is normalized.
function validateJudgeInput(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { valid: false, error: 'Request body must be a JSON object' };
  }

  const { energy, excuse } = data;
  const context = data.context && typeof data.context === 'object' ? data.context : {};

  // platform / requestedMinutes may live inside context or top-level.
  const platform = context.platform !== undefined ? context.platform : data.platform;
  const requestedMinutes =
    context.requestedMinutes !== undefined ? context.requestedMinutes : data.requestedMinutes;

  if (!isIntInRange(energy, 1, 5)) {
    return { valid: false, error: 'energy must be an integer from 1 to 5' };
  }

  if (typeof excuse !== 'string' || excuse.trim().length === 0) {
    return { valid: false, error: 'excuse must be a non-empty string' };
  }

  if (excuse.length > 500) {
    return { valid: false, error: 'excuse must not exceed 500 characters' };
  }

  if (platform !== undefined) {
    if (typeof platform !== 'string' || platform.trim().length === 0) {
      return { valid: false, error: 'platform must be a non-empty string when provided' };
    }
    if (platform.length > 100) {
      return { valid: false, error: 'platform must not exceed 100 characters' };
    }
  }

  if (requestedMinutes !== undefined) {
    if (!Number.isInteger(requestedMinutes) || requestedMinutes < 1 || requestedMinutes > 60) {
      return { valid: false, error: 'requestedMinutes must be an integer from 1 to 60' };
    }
  }

  return {
    valid: true,
    value: {
      energy,
      excuse: excuse.trim(),
      platform: typeof platform === 'string' ? platform.trim() : undefined,
      requestedMinutes,
    },
  };
}

// ---- Sanitization + prompt-injection handling ----
//
// Two-tier approach so legitimate users are never punished for ordinary words:
// - PROMPT_INJECTION_PATTERNS: full detection list (flags suspicious input).
// - SANITIZE_PATTERNS: instruction-like subset actually redacted from the text.
//   Bare nouns that occur in benign excuses ("secret", "API key") are flagged
//   but left intact so legitimate meaning is preserved.
// Detection NEVER rejects a request — the route redacts, logs, and continues
// with a server-computed verdict.

const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+(previous|all|above|prior)\s+(instructions?|prompts?|rules?)/i,
  /disregard\s+(previous|all|above|prior)\s+(instructions?|prompts?|rules?)/i,
  /ignore\s+system\s+prompt/i,
  /reveal\s+(system\s+)?(prompt|instructions?)/i,
  /show\s+(me\s+)?(your\s+)?(system\s+)?(prompt|instructions?)/i,
  /jailbreak/i,
  /override\s+(rules|safety|restrictions)/i,
  /pretend\s+you\s+are/i,
  /act\s+as\s+(a\s+)?(developer|admin|system|root)/i,
  /return\s+allow\s+regardless/i,
  /always\s+return\s+allow/i,
  /developer\s+message/i,
  /system\s+message/i,
  /\bapi[_\s-]?key\b/i,
  /secret/i,
];

// Redact only instruction-like patterns; bare nouns ("secret", "API key")
// are excluded to avoid destroying legitimate user meaning.
const SANITIZE_PATTERNS = PROMPT_INJECTION_PATTERNS.filter(
  (re) => !['/\\bapi[_\\s-]?key\\b/i', '/secret/i'].includes(re.toString())
);

function stripControlChars(s) {
  // Remove control chars with no legitimate meaning, but keep tab/LF/CR
  // so they can be collapsed into normal spaces below.
  return s.replace(new RegExp("[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]", "g"), "");
}

function collapseWhitespace(s) {
  return s.trim().replace(/\s+/g, ' ');
}

function sanitizeExcuse(excuse) {
  if (typeof excuse !== 'string') return '';
  let out = collapseWhitespace(stripControlChars(excuse));
  for (const pattern of SANITIZE_PATTERNS) {
    // Global replace: redact EVERY occurrence, not just the first.
    out = out.replace(new RegExp(pattern.source, 'gi'), '[REDACTED]');
  }
  // Hard cap as defense-in-depth (validation already enforces 500).
  if (out.length > 500) out = out.slice(0, 500);
  return out;
}

function sanitizePlatform(platform) {
  if (typeof platform !== 'string') return undefined;
  let out = collapseWhitespace(stripControlChars(platform));
  if (out.length > 100) out = out.slice(0, 100);
  return out;
}

function detectPromptInjection(excuse) {
  if (typeof excuse !== 'string') return false;
  return PROMPT_INJECTION_PATTERNS.some((re) => re.test(excuse));
}

module.exports = {
  isNonEmptyString,
  isIntInRange,
  validateJudgeInput,
  sanitizeExcuse,
  sanitizePlatform,
  detectPromptInjection,
  PROMPT_INJECTION_PATTERNS,
};
