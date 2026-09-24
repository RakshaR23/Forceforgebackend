const { open } = require('sqlite3');
const path = require('path');
const dbPath = path.resolve(__dirname, '../data/focusforge.db');

let db = null;

async function init() {
  db = await new Promise((resolve, reject) => {
    const openOptions = {
      filename: dbPath,
      driver: require('sqlite3').Database,
    };

    open(openOptions, (err, connection) => {
      if (err) {
        reject(err);
      } else {
        resolve(connection);
      }
    });
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      platform TEXT,
      url TEXT,
      energy INTEGER,
      excuse TEXT,
      need_category TEXT,
      verdict TEXT,
      reason TEXT,
      action TEXT,
      reset_seconds INTEGER,
      escalation_level TEXT,
      requested_minutes INTEGER,
      completed_reset BOOLEAN DEFAULT FALSE,
      outcome TEXT,
      persona TEXT,
      focus_tokens_spent INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS daily_calibration (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      date TEXT DEFAULT (date('now')),
      hours_slept REAL,
      energy_level INTEGER,
      strictness_multiplier REAL DEFAULT 1.0,
      focus_tokens_balance INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS focus_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      balance INTEGER DEFAULT 0,
      earned INTEGER DEFAULT 0,
      spent INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS experiments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      recommendation TEXT,
      hypothesis TEXT,
      start_date TEXT DEFAULT (date('now')),
      duration_days INTEGER DEFAULT 7,
      target_metric TEXT,
      baseline_value REAL,
      result_value REAL,
      status TEXT DEFAULT 'pending'
    );

    CREATE TABLE IF NOT EXISTS experiment_measurements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      experiment_id INTEGER,
      date TEXT DEFAULT (date('now')),
      focus_score REAL,
      interruption_count INTEGER DEFAULT 0,
      recovery_minutes INTEGER DEFAULT 0,
      session_count INTEGER DEFAULT 1,
      completed BOOLEAN DEFAULT FALSE,
      FOREIGN KEY (experiment_id) REFERENCES experiments(id)
    );
  `);

  console.log('SQLite database initialized');
}

function getDb() {
  if (!db) {
    throw new Error('Database not initialized');
  }
  return db;
}

module.exports = { init, getDb };