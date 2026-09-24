const express = require('express');
const router = express.Router();
const JudgeService = require('../services/judge');
const { validateJudgeInput } = require('../utils/validation');
const attemptTracker = require('../services/attemptTracker');
const judgeService = new JudgeService();

router.post('/', async (req, res) => {
  const { error } = validateJudgeInput(req.body);
  if (error) {
    return res.status(400).json({
      success: false,
      message: error.details[0].message,
    });
  }

  try {
    // 1. Check rate limits and session limits
    const limitsResult = attemptTracker.checkLimits(req);
    if (!limitsResult.success) {
      return res.status(429).json({
        success: false,
        error: limitsResult.error,
      });
    }

    // 2. Process the LLM judgment
    const result = await judgeService.evaluate(req.body);
    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: result.message,
      });
    }

    // 3. Record the verdict for consecutive tracking
    const clientId = attemptTracker._getClientId(req);
    attemptTracker.recordVerdictWithClientId(clientId, result.verdict);

    // 4. Get escalation state for response
    const escalationState = attemptTracker.getEscalationState(clientId);

    return res.json({
      success: true,
      verdict: result.verdict,
      need: result.need,
      reason: result.reason,
      action: result.action,
      resetSeconds: result.resetSeconds,
      escalation: {
        level: escalationState.level,
        cooldownSeconds: escalationState.cooldownSeconds,
      },
    });
  } catch (err) {
    console.error('Judge route error:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
});

module.exports = router;