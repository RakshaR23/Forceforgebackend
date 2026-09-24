require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const apiLimiter = require('./middleware/rateLimit');
const securityMiddleware = require('./middleware/security');
const judgeRouter = require('../routes/judge');
const statsRouter = require('../routes/stats');
const { init: initDb, getDb } = require('./db');
const config = require('../config');

const app = express();

app.use(apiLimiter);
app.use(express.json({ limit: '1mb' }));
app.use(cors());
app.use(helmet());
app.use(securityMiddleware);

app.use('/api/judge', judgeRouter);
app.use('/api/stats', statsRouter);

app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'FocusForge backend is running',
    mockMode: process.env.MOCK_MODE === 'true',
  });
});

app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Not found' });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

initDb().then(() => {
  console.log('Database initialized');
}).catch(err => {
  console.error('Database initialization error:', err);
});

app.listen(config.port, () => {
  console.log(`FocusForge backend running on port ${config.port}`);
  console.log(`Environment: ${config.mockMode ? 'MOCK' : 'LIVE'}`);
  console.log(`GROQ Model: ${config.groqModel}`);
  console.log(`Rate limit: ${config.maxRequestsPerMinute} requests per minute`);
});