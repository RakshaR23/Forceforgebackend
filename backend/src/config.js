require('dotenv').config();

const config = {
  port: process.env.PORT || 5000,
  groqApiKey: process.env.GROQ_API_KEY,
  groqModel: process.env.GROQ_MODEL || 'llama-3.1-8b-instant',
  mockMode: process.env.MOCK_MODE === 'true',
  maxRequestsPerMinute: parseInt(process.env.MAX_REQUESTS_PER_MINUTE) || 30,
  maxJudgesPerSession: parseInt(process.env.MAX_JUDGES_PER_SESSION) || 20,
  escalationWindowMinutes: parseInt(process.env.ESCALATION_WINDOW_MINUTES) || 30,
  maxConsecutiveDeniesTasks: parseInt(process.env.MAX_CONSECUTIVE_DENIES_TASKS) || 5,
};

module.exports = config;