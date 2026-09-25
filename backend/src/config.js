require('dotenv').config();

const config = {
  port: parseInt(process.env.PORT, 10) || 5000,
  groqApiKey: process.env.GROQ_API_KEY || '',
  groqModel: process.env.GROQ_MODEL || 'llama-3.1-8b-instant',
  // Default to mock mode unless explicitly disabled with MOCK_MODE=false.
  mockMode: process.env.MOCK_MODE === undefined ? true : process.env.MOCK_MODE === 'true',
  maxRequestsPerMinute: parseInt(process.env.MAX_REQUESTS_PER_MINUTE, 10) || 30,
  // Server-side judge limits + escalation (see services/attemptTracker.js).
  maxJudgesPerSession: parseInt(process.env.MAX_JUDGES_PER_SESSION, 10) || 20,
  escalationWindowMinutes: parseInt(process.env.ESCALATION_WINDOW_MINUTES, 10) || 30,
  // Configurable timeout for the LLM request (ms).
  llmTimeoutMs: parseInt(process.env.LLM_TIMEOUT_MS, 10) || 10000,
};

module.exports = config;
