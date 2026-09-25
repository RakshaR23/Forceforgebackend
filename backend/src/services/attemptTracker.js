// Server-side attempt limits + escalation for POST /judge.
//
// The browser is NEVER trusted to enforce limits: the client is keyed by
// server-derived req.ip, and any client-submitted escalation/verdict fields
// are ignored by the route. All decisions here are computed server-side.
//
// Modular design: AttemptTracker depends only on the small AttemptStore
// interface ({ append, list, prune, clear, clientIds, size }), so the
// in-memory store can later be swapped for Redis or a database without
// touching routes.
//
// PRODUCTION WARNING: InMemoryAttemptStore keeps state in a single Node.js
// process. It is lost on restart, is not shared between instances, and must
// NOT be relied on for multi-instance production deployment. Use a shared
// store (Redis/DB) behind a load balancer.

const config = require('../config');

const ONE_MINUTE_MS = 60 * 1000;

// Consecutive non-allow streak needed to reach each escalation level.
// Index = level. Kept modest and non-punitive by design.
const ESCALATION_STREAK_THRESHOLDS = [0, 2, 4, 6];
// Cooldown (seconds) reported per level. Capped at 5 minutes — firm but not
// punitive. Level 0 means "no cooldown".
const ESCALATION_COOLDOWNS = [0, 60, 120, 300];
const MAX_ESCALATION_LEVEL = 3;

// Hygiene caps so one actor cannot exhaust server memory.
const MAX_ATTEMPTS_PER_CLIENT = 200;
const MAX_TRACKED_CLIENTS = 10000;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

// ---- Store interface (implement for Redis/DB later) ----
// append(clientId, entry) / list(clientId) -> entry[] (asc by ts) /
// prune(clientId, windowMs, now) / clear(clientId) / clientIds() / size()

class InMemoryAttemptStore {
  constructor({ maxClients = MAX_TRACKED_CLIENTS } = {}) {
    this.clients = new Map(); // clientId -> [{ ts, verdict, requiredWaitSeconds }]
    this.maxClients = maxClients;
  }

  append(clientId, entry) {
    let list = this.clients.get(clientId);
    if (!list) {
      if (this.clients.size >= this.maxClients) {
        // FIFO eviction of the oldest client bucket (dev-grade safety valve).
        const oldest = this.clients.keys().next().value;
        this.clients.delete(oldest);
      }
      list = [];
      this.clients.set(clientId, list);
    }
    list.push(entry);
    if (list.length > MAX_ATTEMPTS_PER_CLIENT) {
      list.splice(0, list.length - MAX_ATTEMPTS_PER_CLIENT);
    }
  }

  list(clientId) {
    return this.clients.get(clientId) || [];
  }

  prune(clientId, windowMs, now = Date.now()) {
    const list = this.clients.get(clientId);
    if (!list) return;
    const cutoff = now - windowMs;
    while (list.length > 0 && list[0].ts <= cutoff) list.shift();
    if (list.length === 0) this.clients.delete(clientId);
  }

  clear(clientId) {
    this.clients.delete(clientId);
  }

  clientIds() {
    return Array.from(this.clients.keys());
  }

  size() {
    return this.clients.size;
  }
}

class AttemptTracker {
  constructor(options = {}) {
    this.store =
      options.store || new InMemoryAttemptStore({ maxClients: options.maxClients });
    this.maxRequestsPerMinute =
      options.maxRequestsPerMinute ?? config.maxRequestsPerMinute ?? 30;
    this.maxJudgesPerSession =
      options.maxJudgesPerSession ?? config.maxJudgesPerSession ?? 20;
    this.escalationWindowMs =
      (options.escalationWindowMinutes ?? config.escalationWindowMinutes ?? 30) *
      60 *
      1000;
    this._now = options.nowFn || Date.now;

    // Periodic hygiene sweep; unref'd so it never keeps the process alive.
    if (options.sweep !== false) {
      this._sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
      if (this._sweepTimer.unref) this._sweepTimer.unref();
    }
  }

  // Test seam / shutdown hook.
  close() {
    if (this._sweepTimer) clearInterval(this._sweepTimer);
  }

  sweep(now = this._now()) {
    for (const clientId of this.store.clientIds()) {
      this.store.prune(clientId, this.escalationWindowMs, now);
    }
  }

  // Consecutive non-allow (deny/task) verdicts ending at the newest entry.
  // The streak breaks on an allow, on leaving the window, or when the user
  // demonstrably completed the previous reset (gap >= required wait) — i.e.
  // escalation only grows when requests repeat WITHOUT completing resets.
  _streak(entries) {
    let streak = 0;
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if (entry.verdict === 'allow') break;
      streak += 1;
      if (i > 0) {
        const prev = entries[i - 1];
        const requiredMs = (prev.requiredWaitSeconds || 0) * 1000;
        if (requiredMs > 0 && entry.ts - prev.ts >= requiredMs) break;
      }
    }
    return streak;
  }

  _levelForStreak(streak) {
    let level = 0;
    for (let l = 1; l <= MAX_ESCALATION_LEVEL; l++) {
      if (streak >= ESCALATION_STREAK_THRESHOLDS[l]) level = l;
    }
    return level;
  }

  getEscalation(clientId, now = this._now()) {
    this.store.prune(clientId, this.escalationWindowMs, now);
    const level = this._levelForStreak(this._streak(this.store.list(clientId)));
    return { level, cooldownSeconds: ESCALATION_COOLDOWNS[level] };
  }

  // Pre-judge gate. Returns { allowed: true } or
  // { allowed: false, status: 429, message, escalation }.
  checkLimits(clientId, now = this._now()) {
    this.store.prune(clientId, this.escalationWindowMs, now);
    const entries = this.store.list(clientId);

    const minuteAgo = now - ONE_MINUTE_MS;
    const recentCount = entries.filter((e) => e.ts > minuteAgo).length;
    if (recentCount >= this.maxRequestsPerMinute) {
      return {
        allowed: false,
        status: 429,
        message: 'Too many requests, please try again later.',
        escalation: this.getEscalation(clientId, now),
      };
    }

    const streak = this._streak(entries);
    if (streak >= this.maxJudgesPerSession) {
      return {
        allowed: false,
        status: 429,
        message: 'Too many repeated requests. Please complete a reset and try again later.',
        escalation: { level: MAX_ESCALATION_LEVEL, cooldownSeconds: ESCALATION_COOLDOWNS[MAX_ESCALATION_LEVEL] },
      };
    }

    return { allowed: true };
  }

  recordAttempt(clientId, { verdict, requiredWaitSeconds = 0 } = {}, now = this._now()) {
    this.store.append(clientId, { ts: now, verdict, requiredWaitSeconds });
  }
}

// Shared default tracker used by the route (reads live config).
const defaultTracker = new AttemptTracker();

module.exports = {
  AttemptTracker,
  InMemoryAttemptStore,
  defaultTracker,
  MAX_ESCALATION_LEVEL,
};
