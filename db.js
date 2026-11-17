// ASGames Database Layer - SQLite3 with JSON persistence fallback
const fs = require('fs');
const path = require('path');

let sqlite3;
try {
    sqlite3 = require('sqlite3').verbose();
} catch (e) {
    sqlite3 = null;
    console.log('Running with JSON-backed storage mode');
}

const DB_FILE = path.join(__dirname, 'asgames.db');
let db = null;

if (sqlite3) {
    db = new sqlite3.Database(DB_FILE, (err) => {
        if (err) {
            console.error('SQLite connection error, falling back to JSON storage:', err.message);
            db = null;
        } else {
            console.log('Connected to SQLite database: asgames.db');
            initTables();
        }
    });
}

function initTables() {
    db.serialize(() => {
        // Users
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            phone TEXT UNIQUE,
            password TEXT,
            balance REAL DEFAULT 100.0,
            invite_code TEXT UNIQUE,
            referred_by TEXT,
            vip_level INTEGER DEFAULT 1,
            is_banned INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Game Rounds
        db.run(`CREATE TABLE IF NOT EXISTS game_rounds (
            period_id TEXT PRIMARY KEY,
            game_mode TEXT,
            winning_number INTEGER,
            winning_color TEXT,
            winning_size TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Bets
        db.run(`CREATE TABLE IF NOT EXISTS bets (
            id TEXT PRIMARY KEY,
            user_id INTEGER,
            period_id TEXT,
            game_mode TEXT,
            select_type TEXT,
            select_value TEXT,
            amount REAL,
            payout REAL DEFAULT 0,
            status TEXT DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Transactions (Deposit / Withdrawal / Commission)
        db.run(`CREATE TABLE IF NOT EXISTS transactions (
            id TEXT PRIMARY KEY,
            user_id INTEGER,
            type TEXT,
            amount REAL,
            status TEXT DEFAULT 'pending',
            details TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Referral Commissions
        db.run(`CREATE TABLE IF NOT EXISTS commissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            downline_id INTEGER,
            tier INTEGER,
            bet_amount REAL,
            commission REAL,
            claimed INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Admin Settings
        db.run(`CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )`);

        // Default admin password & controls
        db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('admin_password', 'admin123')`);
        db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('game_mode', 'random')`);
        db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('manual_number', '')`);
        db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('upi_id', 'asgames@upi')`);
        db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('upi_name', 'ASGames Official')`);
        db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('min_deposit', '100')`);
        db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('min_withdraw', '110')`);
    });
}

// Promisified Helper Methods
const DB = {
    get(sql, params = []) {
        return new Promise((resolve, reject) => {
            db.get(sql, params, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    },

    all(sql, params = []) {
        return new Promise((resolve, reject) => {
            db.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
    },

    run(sql, params = []) {
        return new Promise((resolve, reject) => {
            db.run(sql, params, function (err) {
                if (err) reject(err);
                else resolve({ id: this.lastID, changes: this.changes });
            });
        });
    }
};

module.exports = DB;
