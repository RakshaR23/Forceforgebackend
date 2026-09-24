const express = require('express');
const router = express.Router();
const JudgeService = require('../services/judge');
const { validateJudgeInput } = require('../utils/validation');
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
    const result = await judgeService.evaluate(req.body);
    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: result.message,
      });
    }

    return res.json({
      success: true,
      verdict: result.verdict,
      need: result.need,
      reason: result.reason,
      action: result.action,
      resetSeconds: result.resetSeconds,
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