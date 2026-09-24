# FocusForge Backend

## Overview

Backend API for the FocusForge platform, built with Node.js + Express.

## Directory Structure

```
backend/
├── src/
│   ├── server.js          # Main entry point
│   ├── routes/
│   │   ├── judge.js       # Judge/AI evaluation routes
│   │   └── stats.js       # Statistics routes
│   ├── services/
│   │   ├── judge.js       # Judge service (AI evaluation)
│   │   └── llm.js         # LLM service
│   ├── middleware/
│   │   └── security.js    # Security middleware
│   └── config.js          # Configuration/env variables
├── .env                   # Environment variables (not committed)
├── .env.example           # Example environment variables
├── package.json           # Dependencies and scripts
└── README.md              # This file
```

## Installation

```bash
cd backend
npm install
```

## Available Scripts

- `npm run dev` - Start with nodemon (auto-reload)
- `npm start` - Start production server

## Environment Variables

Copy `.env.example` to `.env` and configure:

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `5000` | Server port |
| `GROQ_API_KEY` | Yes (for AI) | - | Groq API key |
| `GROQ_MODEL` | No | `llama-3.1-8b-instant` | Groq model name |
| `MOCK_MODE` | No | `true` | Use mock mode without API key |

## API Endpoints

- `GET /health` - Health check
- `GET /api/judge` - Judge route (AI not yet implemented)
- `POST /api/judge` - Evaluate code (AI not yet implemented)
- `GET /api/stats` - Stats route

## Development

```bash
npm run dev
# Server starts on http://localhost:5000
```

## Testing Health Check

```bash
curl http://localhost:5000/health
# Response: {"success":true,"message":"FocusForge backend is running"}
```