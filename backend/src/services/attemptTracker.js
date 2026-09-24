const cooldownSecondsByLevel = {
  0: 0,
  1: 60,
  2: 120,
  3: 300,
};

const VALID_VERDICTS_FOR_CONSECUTIVE = ['deny', 'task'];

class AttemptTracker {
  constructor() {
    this.minuteBuckets = new Map();
    this.consecutiveResults = new Map();
    this.escalationLevels = new Map();
    this.totalJudgesPerSession = new Map();
    this.lastSessionReset = new Map();

    this.maxRequestsPerMinute = parseInt(process.env.MAX_REQUESTS_PER_MINUTE) || 30;
    this.maxJudgesPerSession = parseInt(process.env.MAX_JUDGES_PER_SESSION) || 20;
    this.escalationWindowMinutes = parseInt(process.env.ESCALATION_WINDOW_MINUTES) || 30;
    this.maxConsecutiveDeniesTasks = parseInt(
      process.env.MAX_CONSECUTIVE_DENIES_TASKS) || 5;
  }

  _getClientId(req) {
    return req.ip || 'unknown';
  }

  _purgeOldMinutes(clientId) {
    const now = Date.now();
    const minuteIndex = Math.floor(now / 60000);
    const windowMinutes = this.escalationWindowMinutes;
    const windowMs = windowMinutes * 60 * 1000;
    const minAllowedIndex = Math.floor((now - windowMs) / 60000);

    const buckets = this.minuteBuckets.get(clientId);
    if (!buckets) return;

    for (const [key, count] of buckets) {
      if (key < minAllowedIndex) {
        buckets.delete(key);
      }
    }
  }

  _purgeOldSessionData(clientId) {
    const now = Date.now();
    const sessionData = this.totalJudgesPerSession.get(clientId) || {};
    const sessionStart = this.lastSessionReset.get(clientId) || now;

    if (now - sessionStart > this.escalationWindowMinutes * 60 * 1000) {
      this.totalJudgesPerSession.set(clientId, 0);
      this.lastSessionReset.set(clientId, now);
    }
  }

  checkLimits(req) {
    const clientId = this._getClientId(req);
    const now = Date.now();

    this._purgeOldMinutes(clientId);
    this._purgeOldSessionData(clientId);

    // 1. Check requests per minute
    let buckets = this.minuteBuckets.get(clientId);
    if (!buckets) {
      buckets = new Map();
      this.minuteBuckets.set(clientId, buckets);
    }

    const minuteIndex = Math.floor(now / 60000);
    const currentMinuteCount = (buckets.get(minuteIndex) || 0) + 1;
    buckets.set(minuteIndex, currentMinuteCount);

    if (currentMinuteCount > this.maxRequestsPerMinute) {
      return {
        success: false,
        error: 'Rate limit exceeded - too many requests per minute',
        rateLimited: true,
      };
    }

    // 2. Check total judges per session
    let totalJudges = this.totalJudgesPerSession.get(clientId) || 0;
    totalJudges++;
    this.totalJudgesPerSession.set(clientId, totalJudges);

    if (totalJudges > this.maxJudgesPerSession) {
      return {
        success: false,
        error: 'Too many judges in this session',
        rateLimited: true,
      };
    }

    return { success: true, rateLimited: false };
  }

  recordVerdict(verdict) {
    // This is called after the LLM verdict is determined
    // It needs the clientId from the current request context
    // We'll use a static method with clientId passed explicitly
    throw new Error('Use recordVerdictWithClientId instead');
  }

  recordVerdictWithClientId(clientId, verdict) {
    if (!VALID_VERDICTS_FOR_CONSECUTIVE.includes(verdict)) {
      // Not a deny or task, reset consecutive count
      const existing = this.consecutiveResults.get(clientId);
      if (existing) {
        existing.count = 0;
        existing.lastVerdict = null;
        existing.firstTimestamp = null;
      }
      return;
    }

    const consecutive = this.consecutiveResults.get(clientId) || {
      count: 0,
      lastVerdict: null,
      firstTimestamp: Date.now(),
    };

    if (consecutive.lastVerdict === verdict) {
      consecutive.count += 1;
    } else {
      consecutive.count = 1;
      consecutive.lastVerdict = verdict;
      consecutive.firstTimestamp = Date.now();
    }

    this.consecutiveResults.set(clientId, consecutive);
  }

  _shouldDeescalate(clientId, now) {
    const firstTimestamp = this.consecutiveResults.get(clientId)?.firstTimestamp;
    if (!firstTimestamp) return true;

    const elapsedMinutes = (now - firstTimestamp) / 60000;
    return elapsedMinutes >= this.escalationWindowMinutes;
  }

  getEscalationState(clientId) {
    const consecutive = this.consecutiveResults.get(clientId) || { count: 0 };
    const currentLevel = this.escalationLevels.get(clientId) || 0;

    // Check if we should de-escalate
    const now = Date.now();
    const shouldDeescalate = this._shouldDeescalate(clientId, now);
    if (shouldDeescalate && currentLevel > 0) {
      this.escalationLevels.set(clientId, 0);
    }

    const cooldownSeconds = cooldownSecondsByLevel[currentLevel];

    return {
      level: currentLevel,
      cooldownSeconds,
      consecutiveCount: consecutive.count,
    };
  }

  resetClient(clientId) {
    this.minuteBuckets.delete(clientId);
    this.consecutiveResults.delete(clientId);
    this.escalationLevels.delete(clientId);
    this.totalJudgesPerSession.delete(clientId);
    this.lastSessionReset.delete(clientId);
  }
}

module.exports = new AttemptTracker();