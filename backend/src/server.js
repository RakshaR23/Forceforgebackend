require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const config = require('./config');
const apiLimiter = require('./middleware/rateLimit');
const securityMiddleware = require('./middleware/security');
const judgeRouter = require('./routes/judge');
const statsRouter = require('./routes/stats');

const app = express();

// Security + parsing middleware
app.use(helmet());
app.use(cors());
// Tight body cap: legit judge payloads are ~1KB (excuse max is 500 chars).
app.use(express.json({ limit: '100kb' }));
app.use(securityMiddleware);

// Basic request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl}`);
  next();
});

// Rate limiting (appropriate for an AI API)
app.use('/api/', apiLimiter);
app.use('/judge', apiLimiter);

// Health endpoint (reports mock mode so clients/tests know which judge is active)
app.get('/health', (req, res) => {
  const mockMode = process.env.MOCK_MODE !== undefined
    ? process.env.MOCK_MODE !== 'false'
    : config.mockMode;
  return res.json({
    success: true,
    message: 'FocusForge backend is running',
    mockMode,
  });
});

// API routes (judge router serves both POST /judge and POST /api/judge)
app.use('/judge', judgeRouter);
app.use('/api/judge', judgeRouter);
app.use('/api/stats', statsRouter);

// 404 handler
app.use((req, res) => {
  return res.status(404).json({
    success: false,
    message: 'Not found',
  });
});

// Centralized error handler.
// Never expose stack traces, API keys, internal prompts, or internal error
// details in responses — log them server-side only and return safe,
// generic messages. Public shape ({ success, message }) is unchanged.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err.stack || err.message);

  // Malformed JSON / oversized body from the JSON parser: safe 4xx.
  if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return res.status(400).json({ success: false, message: 'Invalid JSON body' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ success: false, message: 'Request body too large' });
  }

  const status = err.status && Number.isInteger(err.status) ? err.status : 500;
  // 4xx with a safe curated message may pass through; 5xx is always generic.
  const message =
    status < 500 && err.message && !/groq|api[_-]?key|prompt|stack|ENOENT|ECONN/i.test(err.message)
      ? err.message
      : 'Unable to process request';
  return res.status(status).json({ success: false, message });
});

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`FocusForge backend running on port ${config.port}`);
    console.log(`Mode: ${config.mockMode ? 'MOCK' : 'LIVE'}`);
    console.log(`GROQ model: ${config.groqModel}`);
    console.log(`Rate limit: ${config.maxRequestsPerMinute} requests per minute`);
    console.log(
      `Judge session cap: ${config.maxJudgesPerSession} consecutive deny/task per ${config.escalationWindowMinutes}min window`
    );
  });
}

module.exports = app;
