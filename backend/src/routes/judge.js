const express = require('express');
const judgeService = require('../services/judge');
const { defaultTracker } = require('../services/attemptTracker');
const {
  validateJudgeInput,
  sanitizeExcuse,
  sanitizePlatform,
  detectPromptInjection,
} = require('../utils/validation');

const router = express.Router();

// Server-derived client key. Never trust client-supplied identifiers for
// limits. NOTE: behind a reverse proxy, set app.set('trust proxy', ...) so
// req.ip reflects the real client IP.
function getClientId(req) {
  return req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
}

// Info route — no AI logic here.
router.get('/', (req, res) => {
  return res.json({
    success: true,
    message: 'Judge route ready. POST /judge (or /api/judge) to get a verdict.',
  });
});

// POST /judge (mounted as both /judge and /api/judge in server.js)
// Flow: server-side limits -> validate -> sanitize -> detect prompt
// injection -> judge service -> record attempt -> respond with escalation.
// The client canNOT submit its own escalation level: req.body.escalation is
// never read; the `escalation` in the response is always computed server-side.
router.post('/', async (req, res, next) => {
  try {
    // 0. Server-side limits first (fail closed on floods, before any AI work).
    const clientId = getClientId(req);
    const gate = defaultTracker.checkLimits(clientId);
    if (!gate.allowed) {
      return res
        .status(gate.status)
        .json({ success: false, message: gate.message, escalation: gate.escalation });
    }

    // 1. Validate request (400 on invalid input).
    const validation = validateJudgeInput(req.body);
    if (!validation.valid) {
      return res.status(400).json({ success: false, message: validation.error });
    }

    // NOTE: any client-supplied verdict/need is deliberately ignored.
    const { energy, excuse, requestedMinutes } = validation.value;

    // 2. Sanitize input (excuse is untrusted data; platform too, since it is
    //    also interpolated into the LLM user message).
    const sanitizedExcuse = sanitizeExcuse(excuse);
    const sanitizedPlatform = sanitizePlatform(validation.value.platform);

    // 3. Detect prompt injection (log metadata + continue on sanitized input).
    //    Flagged requests are NOT rejected — the verdict stays server-computed.
    if (detectPromptInjection(excuse)) {
      console.warn('Prompt injection attempt redacted in /judge request');
    }

    // 4-7. Judge service: calls LLM, validates LLM JSON, applies server-side rules.
    const result = await judgeService.evaluate({
      energy,
      excuse: sanitizedExcuse,
      platform: sanitizedPlatform,
      requestedMinutes,
    });

    if (!result.success) {
      // Upstream/provider failure: log the internal detail server-side only
      // and return a safe generic response (never leak internals, prompts, keys).
      console.error(`Judge evaluation failed: ${result.message}`);
      return res.status(502).json({ success: false, message: 'Unable to process request' });
    }

    // 5. Record the verdict server-side and report the escalation level.
    //    requiredWaitSeconds = the suggested reset: a later request arriving
    //    before it elapses counts as "reset not completed" (streak grows);
    //    arriving after it breaks the streak.
    defaultTracker.recordAttempt(clientId, {
      verdict: result.verdict,
      requiredWaitSeconds: result.resetSeconds,
    });
    const escalation = defaultTracker.getEscalation(clientId);

    return res.json({
      success: true,
      verdict: result.verdict,
      need: result.need,
      reason: result.reason,
      action: result.action,
      resetSeconds: result.resetSeconds,
      escalation,
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
