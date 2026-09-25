// Judge service — owns the decision logic so routes stay thin.
// Routes must never contain AI logic; they call `evaluate()` only.
//
// Pipeline: judge service calls LLM -> validate LLM JSON -> apply
// server-side rules -> return final verdict. The client-supplied verdict
// (if any) is never trusted — evaluate() does not even accept one.

const llmService = require('./llm');
const { VALID_NEEDS, VALID_VERDICTS } = require('./llm');

const DEFAULT_REASONS = {
  tired: 'Your response suggests you are mainly trying to recover from fatigue.',
  bored: 'You seem to be looking for stimulation rather than rest.',
  stressed: 'You seem under pressure right now.',
  lonely: 'You seem to be seeking connection rather than rest.',
  avoiding: 'This looks like avoidance rather than a real need for a break.',
  genuine: 'This looks like a legitimate need.',
};

const DEFAULT_ACTIONS = {
  deny: 'Take a short 2-minute reset before deciding.',
  task: 'Try a 5-minute focused work sprint instead.',
  allow: 'Take a brief break and come back refreshed.',
};

function clampResetSeconds(verdict, resetSeconds) {
  if (verdict === 'allow') return 0;
  // deny/task should normally be 60-120.
  if (!Number.isFinite(resetSeconds)) return verdict === 'deny' ? 120 : 60;
  const rounded = Math.round(resetSeconds);
  if (rounded < 60) return 60;
  if (rounded > 120) return 120;
  return rounded;
}

function validateLlmResult(result) {
  if (!result || typeof result !== 'object') return 'LLM returned an invalid response';
  if (!VALID_NEEDS.includes(result.need)) return 'LLM returned an invalid need';
  if (!VALID_VERDICTS.includes(result.verdict)) return 'LLM returned an invalid verdict';
  if (typeof result.reason !== 'string' || result.reason.trim().length === 0) {
    return 'LLM returned an invalid reason';
  }
  if (typeof result.action !== 'string' || result.action.trim().length === 0) {
    return 'LLM returned an invalid action';
  }
  if (typeof result.resetSeconds !== 'number' || !Number.isFinite(result.resetSeconds)) {
    return 'LLM returned an invalid resetSeconds';
  }
  return null;
}

class JudgeService {
  async evaluate({ energy, excuse, platform, requestedMinutes }) {
    const llmResult = await llmService.judgeWithLLM({
      energy,
      excuse,
      platform,
      requestedMinutes,
    });

    if (!llmResult || !llmResult.success) {
      return {
        success: false,
        message: (llmResult && llmResult.message) || 'Judging failed',
      };
    }

    // Validate raw LLM JSON before trusting it.
    const validationError = validateLlmResult(llmResult);
    if (validationError) {
      return { success: false, message: validationError };
    }

    // Apply server-side rules — final authority on every field.
    const need = llmResult.need;
    const verdict = llmResult.verdict;
    const reason = llmResult.reason.trim().slice(0, 300) || DEFAULT_REASONS[need];
    const action = llmResult.action.trim().slice(0, 300) || DEFAULT_ACTIONS[verdict];
    const resetSeconds = clampResetSeconds(verdict, llmResult.resetSeconds);

    return { success: true, need, verdict, reason, action, resetSeconds };
  }
}

module.exports = new JudgeService();
module.exports.JudgeService = JudgeService;
module.exports.VALID_NEEDS = VALID_NEEDS;
module.exports.VALID_VERDICTS = VALID_VERDICTS;
