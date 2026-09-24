require('dotenv').config();

const config = {
  port: process.env.PORT || 5000,
  groqApiKey: process.env.GROQ_API_KEY,
  groqModel: process.env.GROQ_MODEL || 'llama-3.1-8b-instant',
  mockMode: process.env.MOCK_MODE === 'true',
  maxRequestsPerMinute: parseInt(process.env.MAX_REQUESTS_PER_MINUTE) || 30,
};

module.exports = config;