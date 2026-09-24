const LLMService = require('../services/llm');

class JudgeService {
  constructor() {
    this.llm = new LLMService();
  }

  async evaluate({ energy, excuse, platform, requestedMinutes }) {
    const result = await this.llm.judgeWithLLM({
      energy,
      excuse,
      platform,
      requestedMinutes,
    });

    if (!result.success) {
      return {
        success: false,
        message: result.message || 'Judging failed',
      };
    }

    return {
      success: true,
      need: result.need,
      verdict: result.verdict,
      reason: result.reason,
      action: result.action,
      resetSeconds: result.resetSeconds,
    };
  }
}

module.exports = new JudgeService();