const rateLimit = require('express-rate-limit');
const config = require('../config');

// Rate limiting appropriate for an AI API:
// - AI inference is expensive, so keep per-minute limits tight.
// - Applies per IP. Adjust MAX_REQUESTS_PER_MINUTE in .env as needed.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: config.maxRequestsPerMinute || 30,
  standardHeaders: true, // RateLimit-* headers
  legacyHeaders: false, // Disable X-RateLimit-* headers
  message: {
    success: false,
    message: 'Too many requests, please try again later.',
  },
});

module.exports = apiLimiter;
