"""
ASGames - PythonAnywhere Flask Web Application & Central Database
Runs seamlessly on PythonAnywhere (www.pythonanywhere.com) and acts as the central
permanent database for both the PythonAnywhere site and Render!
"""

import os
import sys
import re
import time
import json
import sqlite3
import random
import smtplib
import threading
from email.mime.text import MIMEText
import math
from datetime import datetime, timedelta, timezone
from flask import Flask, request, jsonify, send_from_directory

OTP_STORE = {}  # email -> { 'code', 'purpose', 'expires_at' }

def mask_email(email):
    if not email or '@' not in email:
        return email
    u, d = email.split('@', 1)
    return f"{u[:2]}***@{d}"

def send_gmail_otp(to_email, otp_code, purpose):
    import urllib.request
    with get_db() as conn:
        c = conn.cursor()
        c.execute('SELECT key, value FROM settings WHERE key IN ("gmail_user", "gmail_app_password", "email_webhook_url")')
        s = {r['key']: r['value'] for r in c.fetchall()}

    title = 'Reset Your ASGames Password' if purpose == 'forgot' else 'Verify Your ASGames Account'
    subject = f"🔐 {otp_code} is your ASGames {'Password Reset' if purpose == 'forgot' else 'Verification'} OTP"
    html = f"""
    <div style="font-family:Arial,sans-serif;max-width:460px;margin:0 auto;background:#121626;color:#fff;padding:24px;border-radius:14px;border:1px solid #f5c443;">
        <h2 style="color:#f5c443;margin:0 0 10px;text-align:center;">👑 ASGames VIP</h2>
        <p style="color:#cbd5e1;font-size:14px;text-align:center;">{title}</p>
        <div style="background:#1c223c;border:2px dashed #f5c443;border-radius:10px;padding:18px;text-align:center;margin:20px 0;">
            <div style="font-size:32px;font-weight:900;letter-spacing:8px;color:#fde047;">{otp_code}</div>
        </div>
        <p style="color:#94a3b8;font-size:12px;text-align:center;">Valid for 10 minutes. Do not share this code with anyone.</p>
    </div>
    """

    # Priority 1: Google Apps Script HTTPS Webhook (Port 443)
    webhook_url = (os.environ.get('EMAIL_WEBHOOK_URL') or s.get('email_webhook_url') or '').strip()
    if webhook_url.startswith('https://'):
        try:
            payload = json.dumps({'secret': 'spp213201pty', 'to': to_email, 'subject': subject, 'html': html}).encode('utf-8')
            req = urllib.request.Request(webhook_url, data=payload, headers={'Content-Type': 'text/plain;charset=utf-8'}, method='POST')
            with urllib.request.urlopen(req, timeout=10) as resp:
                body = resp.read().decode('utf-8', errors='ignore')
                if 'true' in body:
                    return True, 'webhook'
        except Exception as e:
            pass

    # Priority 2: Direct Gmail SMTP (6s timeout)
    g_user = (os.environ.get('GMAIL_USER') or s.get('gmail_user') or '').strip()
    g_pass = (os.environ.get('GMAIL_PASS') or s.get('gmail_app_password') or '').replace(' ', '')
    if not g_user or not g_pass:
        return False, 'not_configured'
    try:
        msg = MIMEText(html, 'html')
        msg['Subject'] = subject
        msg['From'] = f"ASGames VIP <{g_user}>"
        msg['To'] = to_email
        with smtplib.SMTP_SSL('smtp.gmail.com', 465, timeout=6) as server:
            server.login(g_user, g_pass)
            server.sendmail(g_user, [to_email], msg.as_string())
        return True, 'sent'
    except Exception as e:
        return False, str(e)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_FILE = os.path.join(BASE_DIR, 'asgames.db')

app = Flask(__name__, static_folder=BASE_DIR)

# Enable CORS for all incoming requests (Render, local, GitHub Pages, etc.)
@app.after_request
def add_cors_headers(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, x-admin-key'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
    return response

@app.route('/<path:dummy>', methods=['OPTIONS'])
@app.route('/', methods=['OPTIONS'])
def options_handler(dummy=None):
    return '', 204


# ========================================================
# DATABASE INITIALIZATION (SQLite on PythonAnywhere)
# ========================================================

def get_db():
    conn = sqlite3.connect(DB_FILE, timeout=15)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Verify schema compatibility for legacy sqlite files
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='game_rounds'")
        if cursor.fetchone():
            cols = [r[1] for r in cursor.execute('PRAGMA table_info(game_rounds)').fetchall()]
            if 'period' not in cols:
                cursor.execute('DROP TABLE game_rounds')

        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='bets'")
        if cursor.fetchone():
            cols = [r[1] for r in cursor.execute('PRAGMA table_info(bets)').fetchall()]
            if 'period' not in cols:
                cursor.execute('DROP TABLE bets')
            elif 'game_mode' not in cols:
                try:
                    cursor.execute('ALTER TABLE bets ADD COLUMN game_mode TEXT DEFAULT "30s"')
                except:
                    pass

        cursor.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phone TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                balance REAL DEFAULT 100.0,
                invite_code TEXT,
                referred_by TEXT,
                vip_level INTEGER DEFAULT 1,
                is_banned INTEGER DEFAULT 0,
                created_at TEXT
            )
        ''')
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS game_rounds (
                period TEXT PRIMARY KEY,
                number INTEGER,
                color TEXT,
                premium_sum INTEGER,
                created_at TEXT
            )
        ''')
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS bets (
                id TEXT PRIMARY KEY,
                user_id INTEGER,
                period TEXT,
                select_type TEXT,
                select_val TEXT,
                amount REAL,
                win_amount REAL DEFAULT 0,
                status TEXT DEFAULT 'pending',
                created_at TEXT
            )
        ''')
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS transactions (
                id TEXT PRIMARY KEY,
                user_id INTEGER,
                type TEXT,
                amount REAL,
                status TEXT,
                details TEXT,
                created_at TEXT
            )
        ''')
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
            )
        ''')
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS gift_codes (
                code TEXT PRIMARY KEY,
                amount REAL DEFAULT 50.0,
                max_uses INTEGER DEFAULT 100,
                claimed_by TEXT DEFAULT '[]',
                created_at TEXT
            )
        ''')
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS commissions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                downline_id INTEGER NOT NULL,
                tier INTEGER NOT NULL,
                bet_amount REAL NOT NULL,
                commission REAL NOT NULL,
                type TEXT DEFAULT 'deposit',
                claimed INTEGER DEFAULT 0,
                created_at TEXT NOT NULL
            )
        ''')
        cursor.execute(
            'INSERT OR IGNORE INTO gift_codes (code, amount, max_uses, claimed_by, created_at) VALUES (?, ?, ?, ?, ?)',
            ('ASG50', 50.0, 100, '[]', datetime.now().isoformat())
        )

        # Default Settings
        defaults = {
            'admin_password': 'spp213201pty',
            'game_mode': 'random',
            'manual_number': '',
            'upi_id': 'akshit9908@barodampay',
            'upi_name': 'AKSHIT KUMAR SAXENA',
            'deposit_upi_id': 'akshit9908@barodampay',
            'deposit_upi_name': 'AKSHIT KUMAR SAXENA',
            'deposit_arpay_upi': 'manusaxena465267@ikwik',
            'deposit_qr_url': '/assets/deposit-qr.jpg',
            'min_deposit': '100',
            'min_withdraw': '110'
        }
        for k, v in defaults.items():
            cursor.execute('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', (k, v))
            # Always ensure admin password matches spp213201pty
            if k == 'admin_password':
                cursor.execute('UPDATE settings SET value = ? WHERE key = ?', (v, k))

        # Auto-add email & email_verified columns to users if missing
        u_cols = [r[1] for r in cursor.execute('PRAGMA table_info(users)').fetchall()]
        if 'email' not in u_cols:
            cursor.execute("ALTER TABLE users ADD COLUMN email TEXT DEFAULT ''")
        if 'email_verified' not in u_cols:
            cursor.execute("ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 1")

        # Auto-repair any legacy deposit/withdraw rows where amount slipped into type column
        cursor.execute("UPDATE transactions SET amount = CAST(type AS REAL), type = 'deposit', details = COALESCE(NULLIF(details, ''), 'UPI Deposit') WHERE id LIKE 'DEP%' AND type NOT IN ('deposit', 'withdraw', 'win', 'commission')")
        cursor.execute("UPDATE transactions SET amount = CAST(type AS REAL), type = 'withdraw', details = COALESCE(NULLIF(details, ''), 'Withdrawal Request') WHERE id LIKE 'WTH%' AND type NOT IN ('deposit', 'withdraw', 'win', 'commission')")

        # Friends & Online Multiplayer Ludo Rooms tables
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS friends (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                from_uid INTEGER NOT NULL,
                to_uid INTEGER NOT NULL,
                status TEXT DEFAULT 'pending',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS friend_messages (
                id TEXT PRIMARY KEY,
                pair_key TEXT NOT NULL,
                from_uid INTEGER NOT NULL,
                to_uid INTEGER NOT NULL,
                text TEXT NOT NULL,
                room_code TEXT DEFAULT '',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS ludo_rooms (
                code TEXT PRIMARY KEY,
                state_json TEXT NOT NULL,
                updated_at REAL DEFAULT 0
            )
        ''')
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS support_messages (
                id TEXT PRIMARY KEY,
                thread_id TEXT NOT NULL,
                user_id INTEGER,
                phone TEXT DEFAULT 'Guest',
                label TEXT DEFAULT '',
                sender TEXT NOT NULL,
                text TEXT NOT NULL,
                read_by_admin INTEGER DEFAULT 0,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS game_history (
                id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                game TEXT NOT NULL,
                detail TEXT DEFAULT '',
                bet_amount REAL DEFAULT 0,
                win_amount REAL DEFAULT 0,
                status TEXT DEFAULT 'Pending',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS king_markets (
                key TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                time TEXT DEFAULT '',
                is_local INTEGER DEFAULT 0,
                old_num TEXT DEFAULT '--',
                new_num TEXT DEFAULT '--',
                updated_at TEXT DEFAULT ''
            )
        ''')
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS king_bets (
                id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                phone TEXT DEFAULT '',
                market TEXT NOT NULL,
                bet_type TEXT NOT NULL,
                number TEXT NOT NULL,
                amount REAL DEFAULT 0,
                multiplier REAL DEFAULT 9,
                win_amount REAL DEFAULT 0,
                result_num TEXT DEFAULT '',
                status TEXT DEFAULT 'pending',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS macrodroid_payments (
                id TEXT PRIMARY KEY,
                utr TEXT,
                amount REAL DEFAULT 0,
                sender TEXT DEFAULT '',
                raw_message TEXT DEFAULT '',
                status TEXT DEFAULT 'unclaimed',
                matched_user_id INTEGER,
                matched_tx_id TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS macrodroid_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                time TEXT DEFAULT CURRENT_TIMESTAMP,
                utr TEXT DEFAULT '',
                amount REAL DEFAULT 0,
                action TEXT DEFAULT '',
                user_id INTEGER,
                details TEXT DEFAULT '',
                raw TEXT DEFAULT ''
            )
        ''')
        for k, n, tm, loc, oldn, newn in [
            ('asgames', 'AS GAMES', 'Live 24/7', 1, '47', '83'),
            ('faridabad', 'FARIDABAD', '06:15 PM', 0, '62', '--'),
            ('gaziabad', 'GAZIABAD', '08:40 PM', 0, '19', '--'),
            ('gali', 'GALI', '11:30 PM', 0, '74', '--'),
            ('disawar', 'DISAWAR', '05:10 AM', 0, '35', '--'),
        ]:
            cursor.execute('INSERT OR IGNORE INTO king_markets (key, name, time, is_local, old_num, new_num) VALUES (?, ?, ?, ?, ?, ?)',
                           (k, n, tm, loc, oldn, newn))

        # Ensure 2-Wallet Architecture columns exist in users table
        try:
            cursor.execute('ALTER TABLE users ADD COLUMN deposit_balance REAL DEFAULT 0.0')
        except Exception:
            pass
        try:
            cursor.execute('ALTER TABLE users ADD COLUMN winning_balance REAL DEFAULT 0.0')
        except Exception:
            pass
        try:
            cursor.execute('ALTER TABLE transactions ADD COLUMN tds_amount REAL DEFAULT 0.0')
        except Exception:
            pass
        try:
            cursor.execute('ALTER TABLE transactions ADD COLUMN net_amount REAL DEFAULT 0.0')
        except Exception:
            pass
        try:
            cursor.execute("ALTER TABLE commissions ADD COLUMN type TEXT DEFAULT 'deposit'")
        except Exception:
            pass
        try:
            cursor.execute("ALTER TABLE users ADD COLUMN name TEXT DEFAULT ''")
        except Exception:
            pass

        # Ensure all new users automatically receive at least a 6-digit UID (>= 101001)
        cursor.execute('SELECT MAX(id) FROM users')
        max_uid_row = cursor.fetchone()
        max_uid = int(max_uid_row[0]) if (max_uid_row and max_uid_row[0]) else 0
        next_seq = max(101000, max_uid)
        cursor.execute('SELECT seq FROM sqlite_sequence WHERE name = "users"')
        if cursor.fetchone():
            cursor.execute('UPDATE sqlite_sequence SET seq = MAX(seq, ?) WHERE name = "users"', (next_seq,))
        else:
            cursor.execute('INSERT INTO sqlite_sequence (name, seq) VALUES ("users", ?)', (next_seq,))
        conn.commit()

init_db()

def apply_user_wallet_delta(conn, user_id, delta, tx_type=None):
    c = conn.cursor()
    c.execute('SELECT balance, deposit_balance, winning_balance FROM users WHERE id = ?', (user_id,))
    u = c.fetchone()
    if not u:
        return 0.0, 0.0, 0.0
    bal = float(u['balance'] or 0)
    dep_bal = float(u['deposit_balance'] or 0)
    win_bal = float(u['winning_balance'] or 0)

    # Initialize if zero and bal > 0
    if dep_bal == 0 and win_bal == 0 and bal > 0:
        win_bal = bal

    d = float(delta)
    if d > 0:
        if tx_type == 'deposit':
            dep_bal = round(dep_bal + d, 2)
        else:
            win_bal = round(win_bal + d, 2)
    elif d < 0:
        deduct = abs(d)
        if tx_type == 'withdraw':
            win_bal = max(0.0, round(win_bal - deduct, 2))
        else:
            from_dep = min(dep_bal, deduct)
            from_win = max(0.0, deduct - from_dep)
            dep_bal = max(0.0, round(dep_bal - from_dep, 2))
            win_bal = max(0.0, round(win_bal - from_win, 2))

    bal = round(dep_bal + win_bal, 2)
    c.execute('UPDATE users SET balance = ?, deposit_balance = ?, winning_balance = ? WHERE id = ?', (bal, dep_bal, win_bal, user_id))
    return bal, dep_bal, win_bal

def reconcile_user_wallet_sqlite(conn, user_id):
    c = conn.cursor()
    c.execute('SELECT balance, deposit_balance, winning_balance FROM users WHERE id = ?', (user_id,))
    u = c.fetchone()
    if not u:
        return 0.0, 0.0, 0.0
    bal = max(0.0, float(u['balance'] or 0))
    dep_bal = max(0.0, float(u['deposit_balance'] or 0))
    win_bal = max(0.0, float(u['winning_balance'] or 0))
    if round(dep_bal + win_bal, 2) != round(bal, 2):
        win_bal = max(0.0, round(bal - dep_bal, 2))
    try:
        c.execute('UPDATE users SET balance = ?, deposit_balance = ?, winning_balance = ? WHERE id = ?', (bal, dep_bal, win_bal, user_id))
    except Exception:
        pass
    return bal, dep_bal, win_bal

def distribute_deposit_commissions(conn, user_id, deposit_amount):
    try:
        dep_amt = float(deposit_amount or 0)
        if dep_amt <= 0:
            return

        cursor = conn.cursor()
        cursor.execute('SELECT referred_by FROM users WHERE id = ?', (user_id,))
        u = cursor.fetchone()
        if not u or not u['referred_by']:
            return

        now_iso = datetime.now().isoformat()
        ref1_code = u['referred_by']

        # Tier 1 (5% of deposit, max ₹100 cap)
        cursor.execute('SELECT id, referred_by FROM users WHERE invite_code = ?', (ref1_code,))
        t1 = cursor.fetchone()
        if not t1:
            return
        comm1 = min(100.0, round(dep_amt * 0.05, 2))
        if comm1 > 0:
            cursor.execute(
                'INSERT INTO commissions (user_id, downline_id, tier, bet_amount, commission, type, claimed, created_at) VALUES (?, ?, 1, ?, ?, ?, 0, ?)',
                (t1['id'], user_id, dep_amt, comm1, 'deposit', now_iso)
            )

        # Tier 2 (2% of deposit, max ₹100 cap)
        if not t1['referred_by']:
            return
        cursor.execute('SELECT id, referred_by FROM users WHERE invite_code = ?', (t1['referred_by'],))
        t2 = cursor.fetchone()
        if not t2:
            return
        comm2 = min(100.0, round(dep_amt * 0.02, 2))
        if comm2 > 0:
            cursor.execute(
                'INSERT INTO commissions (user_id, downline_id, tier, bet_amount, commission, type, claimed, created_at) VALUES (?, ?, 2, ?, ?, ?, 0, ?)',
                (t2['id'], user_id, dep_amt, comm2, 'deposit', now_iso)
            )

        # Tier 3 (1% of deposit, max ₹100 cap)
        if not t2['referred_by']:
            return
        cursor.execute('SELECT id FROM users WHERE invite_code = ?', (t2['referred_by'],))
        t3 = cursor.fetchone()
        if not t3:
            return
        comm3 = min(100.0, round(dep_amt * 0.01, 2))
        if comm3 > 0:
            cursor.execute(
                'INSERT INTO commissions (user_id, downline_id, tier, bet_amount, commission, type, claimed, created_at) VALUES (?, ?, 3, ?, ?, ?, 0, ?)',
                (t3['id'], user_id, dep_amt, comm3, 'deposit', now_iso)
            )
    except Exception as e:
        print(f"Error distributing deposit commissions: {e}")


# ========================================================
# GAME STATE & WIN-GO ENGINE (100% SERVER AUTHORITATIVE)
# ========================================================

WINGO_MODES = {
    '30s': {'duration': 30, 'prefix': '1'},
    '1m':  {'duration': 60, 'prefix': '2'},
    '3m':  {'duration': 180, 'prefix': '3'},
    '5m':  {'duration': 300, 'prefix': '5'},
}

def determine_color(num):
    if num == 0:
        return 'red-violet'
    elif num == 5:
        return 'green-violet'
    elif num in [1, 3, 7, 9]:
        return 'green'
    else:
        return 'red'

# Current period synchronized using UTC wall-clock deterministic slots
def get_current_period_info(mode='30s', now_ts=None):
    if now_ts is None:
        now_ts = time.time()
    cfg = WINGO_MODES.get(mode, WINGO_MODES['30s'])
    duration = cfg['duration']
    now_sec = int(now_ts)
    remaining = duration - (now_sec % duration)
    is_locked = remaining <= 5

    utc_dt = datetime.fromtimestamp(now_ts, timezone.utc)
    y = utc_dt.strftime('%Y')
    m = utc_dt.strftime('%m')
    day = utc_dt.strftime('%d')
    sec_in_day = utc_dt.hour * 3600 + utc_dt.minute * 60 + utc_dt.second
    day_slot = (sec_in_day // duration) + 1
    period = f"{y}{m}{day}{cfg['prefix']}{day_slot:04d}"

    return {
        'mode': mode,
        'duration': duration,
        'period': period,
        'remainingSeconds': remaining,
        'isLocked': is_locked,
        'serverTime': int(now_ts * 1000)
    }

def draw_round_if_needed(period, mode='30s'):
    if not period:
        return None
    period_str = str(period).strip()
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM game_rounds WHERE period = ?', (period_str,))
        row = cursor.fetchone()
        if row:
            d = dict(row)
            num = int(d.get('number', 0))
            col = d.get('color') or determine_color(num)
            sz = 'Big' if num >= 5 else 'Small'
            return {
                'period': period_str,
                'period_id': period_str,
                'number': num,
                'winning_number': num,
                'color': col,
                'winning_color': col,
                'size': sz,
                'winning_size': sz,
                'game_mode': mode,
                'created_at': d.get('created_at', '')
            }

        # Check admin settings specifically for this Win Go mode
        mode_key = f"wingo_{mode}_mode"
        manual_key = f"wingo_{mode}_manual"
        cursor.execute('SELECT value FROM settings WHERE key = ?', (mode_key,))
        m_row = cursor.fetchone()
        current_mode = m_row['value'] if m_row else None

        cursor.execute('SELECT value FROM settings WHERE key = ?', (manual_key,))
        man_row = cursor.fetchone()
        manual_num = man_row['value'] if man_row else ''

        # Backwards compatibility fallback for 30s
        if not current_mode and mode == '30s':
            cursor.execute('SELECT value FROM settings WHERE key = "game_mode"')
            leg_m = cursor.fetchone()
            current_mode = leg_m['value'] if leg_m else 'house_edge'
        if not current_mode:
            current_mode = 'house_edge'

        if manual_num == '' and mode == '30s':
            cursor.execute('SELECT value FROM settings WHERE key = "manual_number"')
            leg_man = cursor.fetchone()
            if leg_man and leg_man['value']:
                manual_num = leg_man['value']

        winning_num = random.randint(0, 9)

        # Check pending bets on this period and mode
        cursor.execute('SELECT * FROM bets WHERE (period = ? OR id LIKE ?) AND (game_mode = ? OR game_mode IS NULL) AND status = "pending"', (period_str, f"%{period_str}%", mode))
        period_bets = cursor.fetchall()

        cursor.execute('SELECT value FROM settings WHERE key = ?', (f'wingo_{mode}_lock',))
        lock_row = cursor.fetchone()
        is_lock_active = lock_row and lock_row['value'] == '1'

        if current_mode == 'manual' and manual_num != '':
            try:
                winning_num = int(manual_num)
                if winning_num < 0 or winning_num > 9:
                    winning_num = random.randint(0, 9)
            except:
                winning_num = random.randint(0, 9)
            if not is_lock_active:
                # Clear ONLY this mode's manual override if not continuous lock
                cursor.execute('UPDATE settings SET value = "" WHERE key = ?', (manual_key,))
                cursor.execute('UPDATE settings SET value = "lowest_bet" WHERE key = ?', (mode_key,))
                if mode == '30s':
                    cursor.execute('UPDATE settings SET value = "" WHERE key = "manual_number"')
                    cursor.execute('UPDATE settings SET value = "lowest_bet" WHERE key = "game_mode"')
        elif current_mode in ['lowest_bet', 'house_edge'] and period_bets:
            # Sabse Kam Bet Win (Min Payout - Max House Profit)
            lowest_payout = float('inf')
            best_numbers = []

            for test_num in range(10):
                test_color = determine_color(test_num)
                test_size = 'big' if test_num >= 5 else 'small'
                payout = 0.0

                for b in period_bets:
                    b_amt = float(b['amount'] or 0)
                    stype = str(b['select_type'] or '')
                    sval = str(b['select_val'] or '').lower()

                    if stype == 'number' and sval == str(test_num):
                        payout += b_amt * 9.0 * 0.98
                    elif stype == 'color':
                        if sval == 'green':
                            if test_color == 'green': payout += b_amt * 2.0 * 0.98
                            elif test_color == 'green-violet': payout += b_amt * 1.5 * 0.98
                        elif sval == 'red':
                            if test_color == 'red': payout += b_amt * 2.0 * 0.98
                            elif test_color == 'red-violet': payout += b_amt * 1.5 * 0.98
                        elif sval == 'violet' and (test_num == 0 or test_num == 5):
                            payout += b_amt * 4.5 * 0.98
                    elif stype == 'size' and sval == test_size:
                        payout += b_amt * 2.0 * 0.98

                if payout < lowest_payout:
                    lowest_payout = payout
                    best_numbers = [test_num]
                elif payout == lowest_payout:
                    best_numbers.append(test_num)

            winning_num = random.choice(best_numbers) if best_numbers else random.randint(0, 9)

        color = determine_color(winning_num)
        size = 'Big' if winning_num >= 5 else 'Small'
        premium_sum = random.randint(1000, 9999)
        now_iso = datetime.now().isoformat()

        cursor.execute(
            'INSERT OR REPLACE INTO game_rounds (period, number, color, premium_sum, created_at) VALUES (?, ?, ?, ?, ?)',
            (period_str, winning_num, color, premium_sum, now_iso)
        )

        # Settle bets for this period
        for b in period_bets:
            b_id = b['id']
            u_id = b['user_id']
            stype = str(b['select_type'] or '')
            sval = str(b['select_val'] or '').lower()
            amt = float(b['amount'] or 0)
            won = False
            win_amt = 0.0

            if stype == 'number' and str(winning_num) == sval:
                won = True
                win_amt = amt * 9.0
            elif stype == 'color':
                if sval == 'green' and color in ['green', 'green-violet']:
                    won = True
                    win_amt = amt * (1.5 if color == 'green-violet' else 2.0)
                elif sval == 'red' and color in ['red', 'red-violet']:
                    won = True
                    win_amt = amt * (1.5 if color == 'red-violet' else 2.0)
                elif sval == 'violet' and color in ['red-violet', 'green-violet']:
                    won = True
                    win_amt = amt * 4.5
            elif stype == 'size':
                if sval == 'big' and winning_num >= 5:
                    won = True
                    win_amt = amt * 2.0
                elif sval == 'small' and winning_num < 5:
                    won = True
                    win_amt = amt * 2.0

            new_status = 'won' if won else 'lost'
            cursor.execute('UPDATE bets SET win_amount = ?, status = ? WHERE id = ?', (win_amt, new_status, b_id))
            cursor.execute('UPDATE game_history SET win_amount = ?, status = ? WHERE id = ?', (win_amt, 'Won' if won else 'Lost', b_id))
            if won and win_amt > 0:
                net_payout = math.floor(win_amt * 0.98 * 100) / 100
                apply_user_wallet_delta(conn, u_id, net_payout, 'win')
                cursor.execute(
                    'INSERT INTO transactions (id, user_id, type, amount, status, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    (f"WIN_{int(time.time()*1000)}_{random.randint(100,999)}", u_id, 'win', net_payout, 'completed', f'Win Go Prize #{period_str}', now_iso)
                )
        conn.commit()

        return {
            'period': period_str,
            'period_id': period_str,
            'number': winning_num,
            'winning_number': winning_num,
            'color': color,
            'winning_color': color,
            'size': size,
            'winning_size': size,
            'game_mode': mode,
            'created_at': now_iso
        }

def seed_initial_history_if_needed(mode='30s'):
    cfg = WINGO_MODES.get(mode, WINGO_MODES['30s'])
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT COUNT(*) as c FROM game_rounds')
        row = cursor.fetchone()
        cnt = row['c'] if row else 0
        if cnt < 15:
            now_ts = time.time()
            now_iso = datetime.now().isoformat()
            for i in range(15, 0, -1):
                past_info = get_current_period_info(mode, now_ts - i * cfg['duration'])
                p = past_info['period']
                cursor.execute('SELECT period FROM game_rounds WHERE period = ?', (p,))
                if not cursor.fetchone():
                    h = 0
                    for c in p: h = (h * 31 + ord(c)) & 0xffffffff
                    num = abs(h) % 10
                    cursor.execute(
                        'INSERT OR IGNORE INTO game_rounds (period, number, color, premium_sum, created_at) VALUES (?, ?, ?, ?, ?)',
                        (p, num, determine_color(num), 5000 + num * 100, now_iso)
                    )
            conn.commit()


# ========================================================
# SYNCHRONIZED AVIATOR ENGINE (SERVER-WIDE LIVE FLIGHTS)
# ========================================================
AVIATOR_CONFIG = {
    'betting_duration': 5.0,
    'crashed_duration': 3.0
}

def generate_aviator_crash(mode='smart_profit', active_bets=None):
    active_bets = active_bets or []
    total_wager = sum(float(b.get('amount', 0)) for b in active_bets)
    if mode == 'early_crash':
        return round(1.02 + random.random() * 0.24, 2)
    if mode == 'high_flight':
        return round(8.00 + random.random() * 22.0, 2)
    if mode == 'random':
        u = min(0.992, max(0.001, random.random()))
        if random.random() < 0.04:
            return 1.00
        return min(50.00, max(1.01, round((0.96 / (1.0 - u)), 2)))
    # smart_profit:
    if total_wager > 0:
        r = random.random()
        if r < 0.40:
            return round(1.02 + random.random() * 0.18, 2)
        if r < 0.75:
            return round(1.20 + random.random() * 0.35, 2)
        if r < 0.92:
            return round(1.55 + random.random() * 0.65, 2)
        return round(2.20 + random.random() * 1.50, 2)
    r = random.random()
    if r < 0.15:
        return round(1.02 + random.random() * 0.25, 2)
    if r < 0.50:
        return round(1.30 + random.random() * 1.40, 2)
    if r < 0.80:
        return round(2.70 + random.random() * 4.80, 2)
    if r < 0.95:
        return round(7.50 + random.random() * 12.50, 2)
    return round(20.00 + random.random() * 28.00, 2)

_AVIATOR_ENGINE = {
    'round_num': 1,
    'round_id': f"AV-{datetime.now().strftime('%Y%m%d')}-0001",
    'state': 'betting',
    'state_start_ts': time.time(),
    'crash_multiplier': 2.15,
    'last_crash': 1.84,
    'history': [1.84, 3.42, 1.15, 6.78, 2.10, 1.05, 14.50, 2.45],
    'active_bets': [],
    'forced_crash': None
}

def calc_aviator_multiplier(elapsed):
    if elapsed <= 0:
        return 1.00
    m = 1.00 + 0.08 * elapsed + 0.015 * math.pow(elapsed, 1.75)
    return math.floor(m * 100.0) / 100.0

def calc_aviator_flight_duration(crash_multiplier):
    if crash_multiplier <= 1.00:
        return 0.5
    low, high = 0.1, 60.0
    for _ in range(24):
        mid = (low + high) / 2.0
        if calc_aviator_multiplier(mid) < crash_multiplier:
            low = mid
        else:
            high = mid
    return (low + high) / 2.0

def update_aviator_engine():
    now = time.time()
    elapsed = now - _AVIATOR_ENGINE['state_start_ts']

    try:
        with get_db() as conn:
            c = conn.cursor()
            c.execute('SELECT value FROM settings WHERE key="aviator_mode"')
            mr = c.fetchone()
            mode = mr['value'] if mr else 'smart_profit'
            c.execute('SELECT value FROM settings WHERE key="aviator_crash"')
            cr = c.fetchone()
            forced = float(cr['value']) if (cr and cr['value']) else None
            if forced and forced >= 1.00:
                _AVIATOR_ENGINE['forced_crash'] = forced
    except:
        mode = 'smart_profit'

    if _AVIATOR_ENGINE['state'] == 'betting':
        if elapsed >= AVIATOR_CONFIG['betting_duration']:
            _AVIATOR_ENGINE['state'] = 'flying'
            _AVIATOR_ENGINE['state_start_ts'] = now
            if _AVIATOR_ENGINE['forced_crash'] and _AVIATOR_ENGINE['forced_crash'] >= 1.00:
                _AVIATOR_ENGINE['crash_multiplier'] = _AVIATOR_ENGINE['forced_crash']
            else:
                _AVIATOR_ENGINE['crash_multiplier'] = generate_aviator_crash(mode, _AVIATOR_ENGINE['active_bets'])
    elif _AVIATOR_ENGINE['state'] == 'flying':
        flight_dur = calc_aviator_flight_duration(_AVIATOR_ENGINE['crash_multiplier'])
        if elapsed >= flight_dur:
            _AVIATOR_ENGINE['state'] = 'crashed'
            _AVIATOR_ENGINE['state_start_ts'] = now
            _AVIATOR_ENGINE['last_crash'] = _AVIATOR_ENGINE['crash_multiplier']
            _AVIATOR_ENGINE['history'].insert(0, _AVIATOR_ENGINE['crash_multiplier'])
            if len(_AVIATOR_ENGINE['history']) > 25:
                _AVIATOR_ENGINE['history'].pop()
            for b in _AVIATOR_ENGINE['active_bets']:
                if b.get('status') == 'in_flight':
                    b['status'] = 'crashed'
    elif _AVIATOR_ENGINE['state'] == 'crashed':
        if elapsed >= AVIATOR_CONFIG['crashed_duration']:
            _AVIATOR_ENGINE['state'] = 'betting'
            _AVIATOR_ENGINE['state_start_ts'] = now
            _AVIATOR_ENGINE['round_num'] += 1
            ymd = datetime.now().strftime('%Y%m%d')
            pad = str(_AVIATOR_ENGINE['round_num']).zfill(4)
            _AVIATOR_ENGINE['round_id'] = f"AV-{ymd}-{pad}"
            _AVIATOR_ENGINE['active_bets'] = []

def get_aviator_public_state(is_admin=False):
    update_aviator_engine()
    now = time.time()
    elapsed = max(0.0, now - _AVIATOR_ENGINE['state_start_ts'])

    if _AVIATOR_ENGINE['state'] == 'betting':
        cur_mult = 1.00
        rem_sec = max(0, int(math.ceil(AVIATOR_CONFIG['betting_duration'] - elapsed)))
    elif _AVIATOR_ENGINE['state'] == 'flying':
        cur_mult = min(_AVIATOR_ENGINE['crash_multiplier'], calc_aviator_multiplier(elapsed))
        rem_sec = max(0, int(math.floor(elapsed)))
    else:
        cur_mult = _AVIATOR_ENGINE['crash_multiplier']
        rem_sec = max(0, int(math.ceil(AVIATOR_CONFIG['crashed_duration'] - elapsed)))

    total_bet = sum(float(b.get('amount', 0)) for b in _AVIATOR_ENGINE['active_bets'])
    res = {
        'success': True,
        'round_id': _AVIATOR_ENGINE['round_id'],
        'round_num': _AVIATOR_ENGINE['round_num'],
        'state': _AVIATOR_ENGINE['state'],
        'current_multiplier': cur_mult,
        'last_crash': _AVIATOR_ENGINE['last_crash'],
        'history': _AVIATOR_ENGINE['history'][:15],
        'remaining_seconds': rem_sec,
        'elapsed_seconds': round(elapsed, 1),
        'active_bets': _AVIATOR_ENGINE['active_bets'],
        'total_bets_amount': total_bet,
        'active_players_count': len(_AVIATOR_ENGINE['active_bets']),
        'forced_crash': _AVIATOR_ENGINE['forced_crash'],
        'forced_target': _AVIATOR_ENGINE['forced_crash'] if _AVIATOR_ENGINE.get('mode') == 'manual' else None,
        'mode': _AVIATOR_ENGINE.get('mode', 'smart_profit')
    }
    if is_admin:
        res['crash_multiplier'] = _AVIATOR_ENGINE['crash_multiplier']
    return res


# ========================================================
# AUTH HELPERS
# ========================================================

def get_current_user(req):
    auth = req.headers.get('Authorization', '')
    token = auth.replace('Bearer ', '').strip() if auth.startswith('Bearer ') else ''
    if not token:
        token = req.args.get('token', '')
    if not token or not token.startswith('asg_user_'):
        return None
    try:
        user_id = int(token.replace('asg_user_', ''))
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT * FROM users WHERE id = ?', (user_id,))
            row = cursor.fetchone()
            return dict(row) if row else None
    except:
        return None

def verify_admin(req):
    key = req.headers.get('x-admin-key') or req.args.get('adminKey') or ''
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT value FROM settings WHERE key = ?', ('admin_password',))
        row = cursor.fetchone()
        expected = row['value'] if row else 'spp213201pty'
        return key == expected, expected


# ========================================================
# USER AUTHENTICATION & GMAIL OTP APIS
# ========================================================

@app.route('/api/auth/send-otp', methods=['POST'])
def api_send_otp():
    data = request.get_json(silent=True) or {}
    purpose = 'forgot' if data.get('purpose') == 'forgot' else 'register'
    target_email = str(data.get('email', '')).strip().lower()
    phone_or_email = str(data.get('phone') or data.get('email') or '').strip()

    with get_db() as conn:
        cursor = conn.cursor()
        if purpose == 'register':
            if not target_email or '@' not in target_email or '.' not in target_email:
                return jsonify({'success': False, 'message': 'Please enter a valid Gmail address (e.g. name@gmail.com).'}), 400
            cursor.execute('SELECT id FROM users WHERE LOWER(email) = ?', (target_email,))
            if cursor.fetchone():
                return jsonify({'success': False, 'message': 'This Gmail is already registered! Please login instead.'}), 400
        else:
            if not phone_or_email:
                return jsonify({'success': False, 'message': 'Please enter your registered mobile number or Gmail.'}), 400
            cursor.execute('SELECT * FROM users WHERE phone = ? OR LOWER(email) = ?', (phone_or_email, phone_or_email.lower()))
            user = cursor.fetchone()
            if not user:
                return jsonify({'success': False, 'message': 'Account not found! Please check your mobile number or Gmail.'}), 404
            u_email = (user['email'] or '').strip().lower()
            if not u_email or '@' not in u_email:
                return jsonify({'success': False, 'message': 'No Gmail linked to this account! Please contact admin.'}), 400
            target_email = u_email

    otp_code = str(random.randint(100000, 999999))
    OTP_STORE[target_email] = {
        'code': otp_code,
        'purpose': purpose,
        'expires_at': time.time() + 600
    }

    sent, reason = send_gmail_otp(target_email, otp_code, purpose)
    if sent:
        return jsonify({
            'success': True,
            'masked_email': mask_email(target_email),
            'message': f"OTP sent to {mask_email(target_email)}! Please check your Gmail inbox."
        })
    else:
        return jsonify({
            'success': True,
            'masked_email': mask_email(target_email),
            'demo_otp': otp_code,
            'smtp_warning': True,
            'message': f"OTP generated for {mask_email(target_email)} (Configure Gmail App Password in Admin for live email). OTP: {otp_code}"
        })

@app.route('/api/auth/register', methods=['POST'])
def api_register():
    data = request.get_json(silent=True) or {}
    name = str(data.get('name', '')).strip()
    phone = str(data.get('phone', '')).strip()
    email = str(data.get('email', '')).strip().lower()
    otp = str(data.get('otp', '')).strip()
    password = str(data.get('password', '')).strip()
    invite_code = str(data.get('invite_code', '')).strip()

    if not name:
        return jsonify({'success': False, 'message': 'Full name is required.'}), 400
    if not phone or len(phone) < 10 or not password:
        return jsonify({'success': False, 'message': 'Valid 10-digit mobile number and password required.'}), 400
    if not email or '@' not in email:
        return jsonify({'success': False, 'message': 'Please enter your valid Gmail address.'}), 400

    stored = OTP_STORE.get(email)
    if not stored or stored['purpose'] != 'register' or stored['code'] != otp or time.time() > stored['expires_at']:
        return jsonify({'success': False, 'message': 'Invalid or expired Gmail OTP! Please click Send OTP and enter the 6-digit code.'}), 400

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT id FROM users WHERE phone = ?', (phone,))
        if cursor.fetchone():
            return jsonify({'success': False, 'message': 'Mobile number already registered. Please login.'}), 400
        cursor.execute('SELECT id FROM users WHERE LOWER(email) = ?', (email,))
        if cursor.fetchone():
            return jsonify({'success': False, 'message': 'Gmail already registered. Please login.'}), 400

        OTP_STORE.pop(email, None)

        user_invite = f"ASG{random.randint(10000, 99999)}"
        created_at = datetime.now().isoformat()
        final_name = name or f"Player {phone[-4:]}"
        cursor.execute(
            'INSERT INTO users (name, phone, email, email_verified, password, balance, deposit_balance, winning_balance, invite_code, referred_by, vip_level, is_banned, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            (final_name, phone, email, 1, password, 50.0, 50.0, 0.0, user_invite, invite_code, 1, 0, created_at)
        )
        user_id = cursor.lastrowid
        cursor.execute(
            'INSERT INTO transactions (id, user_id, type, amount, status, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            (f"BON{int(time.time()*1000)}", user_id, 'bonus', 50.0, 'approved', 'Welcome Registration Bonus ₹50', created_at)
        )
        conn.commit()

    token = f"asg_user_{user_id}"
    return jsonify({
        'success': True,
        'message': 'Gmail verified & Registration successful! ₹50 Welcome Bonus credited.',
        'token': token,
        'user': {'id': user_id, 'phone': phone, 'email': email, 'balance': 50.0, 'deposit_balance': 50.0, 'winning_balance': 0.0, 'invite_code': user_invite}
    })

# Special VIP Superpower Phone Helper
def is_special_vip_phone(phone):
    if not phone:
        return False
    clean = ''.join(c for c in str(phone) if c.isdigit())
    return clean == '9720955287' or clean.endswith('9720955287')

@app.route('/api/auth/login', methods=['POST'])
def api_login():
    data = request.get_json(silent=True) or {}
    login_id = str(data.get('phone', '')).strip()
    password = str(data.get('password', '')).strip()

    with get_db() as conn:
        cursor = conn.cursor()
        # Login with Phone OR Gmail — NO OTP needed once verified at registration!
        cursor.execute('SELECT * FROM users WHERE phone = ? OR LOWER(email) = ?', (login_id, login_id.lower()))
        user = cursor.fetchone()
        if not user or user['password'] != password:
            return jsonify({'success': False, 'message': 'Invalid phone/Gmail or password.'}), 400
        if user['is_banned']:
            return jsonify({'success': False, 'message': 'Account is suspended. Please contact admin.'}), 403

        token = f"asg_user_{user['id']}"
        return jsonify({
            'success': True,
            'message': 'Login successful',
            'token': token,
            'user': {
                'id': user['id'],
                'phone': user['phone'],
                'email': user['email'] or '',
                'balance': user['balance'],
                'invite_code': user['invite_code'],
                'vip_level': user['vip_level'],
                'is_special_vip': is_special_vip_phone(user['phone'])
            }
        })

def to_public_uid(uid):
    try:
        n = int(uid)
        return (100000 + n) if (0 < n < 100000) else n
    except Exception:
        return 100001

def resolve_user_id(conn, raw_uid):
    try:
        n = int(raw_uid)
    except Exception:
        return None
    c = conn.cursor()
    c.execute('SELECT id FROM users WHERE id = ?', (n,))
    r = c.fetchone()
    if r:
        return int(r['id'])
    if 100000 < n < 200000:
        c.execute('SELECT id FROM users WHERE id = ?', (n - 100000,))
        r2 = c.fetchone()
        if r2:
            return int(r2['id'])
    return None

@app.route('/api/auth/me', methods=['GET'])
def api_me():
    user = get_current_user(request)
    if not user:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 401
    user['uid'] = to_public_uid(user['id'])

    with get_db() as conn:
        bal, dep, win = reconcile_user_wallet_sqlite(conn, user['id'])
        conn.commit()

    user['balance'] = bal
    user['deposit_balance'] = dep
    user['winning_balance'] = win
    user['withdrawable_balance'] = win
    user['name'] = user.get('name') or f"Player {str(user.get('phone', ''))[-4:]}"
    user['is_special_vip'] = is_special_vip_phone(user.get('phone'))
    return jsonify({'success': True, 'user': user})

@app.route('/api/auth/forgot-password', methods=['POST'])
def api_forgot_password():
    data = request.get_json(silent=True) or {}
    login_id = str(data.get('phone', '')).strip()
    otp = str(data.get('otp', '')).strip()
    new_pass = str(data.get('new_password', '')).strip()

    if not login_id or not new_pass or len(new_pass) < 4:
        return jsonify({'success': False, 'message': 'Registered mobile/Gmail, 6-digit OTP and new password required.'}), 400

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM users WHERE phone = ? OR LOWER(email) = ?', (login_id, login_id.lower()))
        user = cursor.fetchone()
        if not user:
            return jsonify({'success': False, 'message': 'Account not found! Please check or register.'}), 404

        u_email = (user['email'] or '').strip().lower()
        stored = OTP_STORE.get(u_email)
        if not stored or stored['purpose'] != 'forgot' or stored['code'] != otp or time.time() > stored['expires_at']:
            return jsonify({'success': False, 'message': 'Invalid or expired Gmail OTP! Please click Send OTP first.'}), 400

        OTP_STORE.pop(u_email, None)
        cursor.execute('UPDATE users SET password = ? WHERE id = ?', (new_pass, user['id']))
        conn.commit()

    return jsonify({'success': True, 'message': 'Password reset successfully! You can now log in directly without OTP.'})


# ========================================================
# WALLET & TRANSACTIONS APIS
# ========================================================

@app.route('/api/wallet/deposit', methods=['POST'])
@app.route('/api/wallet/recharge', methods=['POST'])
def api_recharge():
    user = get_current_user(request)
    if not user:
        return jsonify({'success': False, 'message': 'Unauthorized. Please login first.'}), 401

    data = request.get_json(silent=True) or {}
    amount = float(data.get('amount', 0))
    utr = str(data.get('utr', '')).strip()
    channel = str(data.get('channel', 'UPI')).strip()
    details = str(data.get('details', '')).strip()
    usdt_amount = float(data.get('usdt_amount', 0))
    usdt_rate_in = float(data.get('usdt_rate', 0))

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT value FROM settings WHERE key = "deposit_usdt_rate"')
        rate_row = cursor.fetchone()
        live_usdt_rate = float(rate_row['value']) if rate_row and rate_row['value'] else 90.0

    is_usdt = ('USDT' in channel.upper()) or (usdt_amount > 0)
    if is_usdt:
        rate = usdt_rate_in if usdt_rate_in > 0 else live_usdt_rate
        if usdt_amount <= 0 and amount > 0:
            usdt_amount = round(amount / rate, 2)
        if usdt_amount <= 0:
            return jsonify({'success': False, 'message': 'Please enter valid USDT amount (Min: 2 USDT)'}), 400
        amount = round(usdt_amount * rate, 2)
        details = f"₮ USDT Deposit: {usdt_amount} USDT @ ₹{rate}/USDT = ₹{amount:.2f} Coins | Network: {channel or 'USDT-TRC20'} | TxID: {utr}"
    elif not details and utr:
        details = f"Channel: {channel} | UTR: {utr}"
    elif not details:
        details = f"Channel: {channel} | UPI Deposit Request"

    if amount < 100:
        return jsonify({'success': False, 'message': 'Minimum deposit is ₹100'}), 400
    if utr and len(utr) < 6:
        return jsonify({'success': False, 'message': 'Please enter a valid 12-digit UTR / Blockchain TxID'}), 400

    tx_id = f"DEP{int(time.time()*1000)}"
    now_iso = datetime.now().isoformat()
    clean_utr = _re.sub(r'\D', '', utr) if utr else ''

    with get_db() as conn:
        cursor = conn.cursor()

        # Check if pre-captured by MacroDroid (Only for non-USDT UPI deposits)
        if not is_usdt and clean_utr:
            cursor.execute('SELECT * FROM macrodroid_payments WHERE status = "unclaimed" AND utr = ?', (clean_utr,))
            pre = cursor.fetchone()
            if pre:
                credit_amt = float(pre['amount']) if float(pre['amount'] or 0) > 0 else amount
                cursor.execute(
                    'UPDATE macrodroid_payments SET status = "matched", matched_user_id = ?, matched_tx_id = ? WHERE id = ?',
                    (user['id'], tx_id, pre['id'])
                )
                cursor.execute(
                    'INSERT INTO transactions (id, user_id, type, amount, status, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    (tx_id, user['id'], 'deposit', credit_amt, 'completed', f"Channel: {channel} | UTR: {clean_utr} | Auto-verified via MacroDroid", now_iso)
                )
                apply_user_wallet_delta(conn, user['id'], credit_amt, 'deposit')
                distribute_deposit_commissions(conn, user['id'], credit_amt)
                cursor.execute(
                    'INSERT INTO macrodroid_logs (utr, amount, action, user_id, details, raw) VALUES (?, ?, ?, ?, ?, ?)',
                    (clean_utr, credit_amt, 'INSTANT_AUTO_CREDITED', user['id'], f"Player submitted UTR {clean_utr}. Matched existing bank payment! Credited ₹{credit_amt} instantly.", f"TxID: {tx_id}")
                )
                conn.commit()
                return jsonify({
                    'success': True,
                    'instant_credited': True,
                    'amount': credit_amt,
                    'message': f'🎉 Payment Verified! ₹{credit_amt:.2f} has been credited to your wallet instantly!',
                    'tx_id': tx_id
                })

        cursor.execute(
            'INSERT INTO transactions (id, user_id, type, amount, status, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            (tx_id, user['id'], 'deposit', amount, 'pending', details, now_iso)
        )
        conn.commit()

    msg = f"USDT Deposit of {usdt_amount} USDT (₹{amount:.2f} Coins) submitted! Balance will update after admin approval." if is_usdt else 'Deposit submitted! Balance will update after admin approval.'
    return jsonify({'success': True, 'message': msg, 'tx_id': tx_id})

def is_withdrawal_time_open():
    # Indian Standard Time is UTC + 5.5 hours
    utc_now = datetime.utcnow()
    ist_time = utc_now + timedelta(hours=5, minutes=30)
    hour = ist_time.hour
    minute = ist_time.minute
    if hour < 10:
        return False
    if hour > 20:
        return False
    if hour == 20 and minute > 0:
        return False
    return True

@app.route('/api/wallet/turnover-status', methods=['GET'])
def api_turnover_status():
    user = get_current_user(request)
    if not user:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 401

    uid = int(user['id'])
    alt_uid = uid + 100000 if uid < 100000 else uid - 100000

    utc_now = datetime.utcnow()
    ist_now = utc_now + timedelta(hours=5, minutes=30)
    today_ist_str = ist_now.strftime('%Y-%m-%d')

    with get_db() as conn:
        bal, dep_bal, win_bal = reconcile_user_wallet_sqlite(conn, user['id'])

        cursor = conn.cursor()
        cursor.execute(
            'SELECT created_at FROM transactions WHERE user_id IN (?, ?) AND type = "withdraw"',
            (uid, alt_uid)
        )
        all_wds = cursor.fetchall()
        today_count = 0
        for row in all_wds:
            c_at = row['created_at']
            if c_at:
                try:
                    tx_dt = datetime.fromisoformat(str(c_at).replace('Z', '+00:00'))
                    tx_ist = tx_dt + timedelta(hours=5, minutes=30)
                    if tx_ist.strftime('%Y-%m-%d') == today_ist_str:
                        today_count += 1
                except Exception:
                    if str(c_at)[:10] == today_ist_str:
                        today_count += 1

        remaining_wds = max(0, 3 - today_count)

        last_win_time = user.get('last_win_time')
        last_win_ts = 0
        if last_win_time:
            try:
                last_win_ts = datetime.fromisoformat(str(last_win_time).replace('Z', '+00:00')).timestamp()
            except Exception:
                pass
        if not last_win_ts:
            cursor.execute(
                'SELECT created_at FROM transactions WHERE user_id IN (?, ?) AND type = "win" ORDER BY created_at DESC LIMIT 1',
                (uid, alt_uid)
            )
            last_win_row = cursor.fetchone()
            if last_win_row and last_win_row['created_at']:
                try:
                    last_win_ts = datetime.fromisoformat(str(last_win_row['created_at']).replace('Z', '+00:00')).timestamp()
                except Exception:
                    pass

        win_cooldown_remaining_sec = 0
        if last_win_ts > 0:
            elapsed_sec = time.time() - last_win_ts
            if elapsed_sec < 1800:
                win_cooldown_remaining_sec = int(1800 - elapsed_sec) + 1

        conn.commit()

    return jsonify({
        'success': True,
        'balance': bal,
        'deposit_balance': dep_bal,
        'winning_balance': win_bal,
        'withdrawable_balance': win_bal,
        'withdrawableBalance': win_bal,
        'is_time_open': is_withdrawal_time_open(),
        'isTimeOpen': is_withdrawal_time_open(),
        'today_withdrawals_count': today_count,
        'daily_limit': 3,
        'remaining_withdrawals': remaining_wds,
        'win_cooldown_remaining_sec': win_cooldown_remaining_sec
    })

@app.route('/api/wallet/withdraw', methods=['POST'])
def api_withdraw():
    user = get_current_user(request)
    if not user:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 401

    # 1. 10:00 AM to 08:00 PM IST timing check
    if not is_withdrawal_time_open():
        return jsonify({
            'success': False,
            'message': 'Withdrawal timings are from 10:00 AM to 08:00 PM IST only. Withdrawals are closed right now!'
        }), 400

    data = request.get_json(silent=True) or {}
    amount = float(data.get('amount', 0))
    details = str(data.get('bank_info') or data.get('details') or 'Bank / UPI Withdrawal').strip()

    if amount < 110:
        return jsonify({'success': False, 'message': 'Minimum withdrawal is ₹110'}), 400

    uid = int(user['id'])
    alt_uid = uid + 100000 if uid < 100000 else uid - 100000

    utc_now = datetime.utcnow()
    ist_now = utc_now + timedelta(hours=5, minutes=30)
    today_ist_str = ist_now.strftime('%Y-%m-%d')

    with get_db() as conn:
        cursor = conn.cursor()

        # 2. Maximum 3 withdrawals per day check (including approved, pending, rejected)
        cursor.execute(
            'SELECT created_at FROM transactions WHERE user_id IN (?, ?) AND type = "withdraw"',
            (uid, alt_uid)
        )
        all_wds = cursor.fetchall()
        today_count = 0
        for row in all_wds:
            c_at = row['created_at']
            if c_at:
                try:
                    tx_dt = datetime.fromisoformat(str(c_at).replace('Z', '+00:00'))
                    tx_ist = tx_dt + timedelta(hours=5, minutes=30)
                    if tx_ist.strftime('%Y-%m-%d') == today_ist_str:
                        today_count += 1
                except Exception:
                    if str(c_at)[:10] == today_ist_str:
                        today_count += 1

        if today_count >= 3:
            return jsonify({
                'success': False,
                'message': 'Daily withdrawal limit reached! Ek din me maximum 3 withdrawal requests allow hain (Chahe approved, pending ya rejected ho).'
            }), 400

        current_bal, dep_bal, win_bal = reconcile_user_wallet_sqlite(conn, user['id'])

        # 3. Balance check
        if current_bal < amount:
            return jsonify({'success': False, 'message': f'Insufficient wallet balance! You have ₹{current_bal:.2f}'}), 400

        # 4. Winning balance check: Only won money can be withdrawn, NOT deposited money
        if amount > win_bal:
            return jsonify({
                'success': False,
                'message': f'Sirf game se jeete hue paise hi withdraw ho sakte hain! Aapka withdrawable jeeta hua balance ₹{win_bal:.2f} hai. Deposit balance game me khel kar jeetne ke baad hi withdraw hoga.'
            }), 400

        # 5. 30-Minute Win Cooldown check: Game jeetne ke 30 minute baad hi jeete hue paise withdraw ho sakein
        last_win_time = user.get('last_win_time')
        last_win_ts = 0
        if last_win_time:
            try:
                last_win_ts = datetime.fromisoformat(str(last_win_time).replace('Z', '+00:00')).timestamp()
            except Exception:
                pass
        if not last_win_ts:
            cursor.execute(
                'SELECT created_at FROM transactions WHERE user_id IN (?, ?) AND type = "win" ORDER BY created_at DESC LIMIT 1',
                (uid, alt_uid)
            )
            last_win_row = cursor.fetchone()
            if last_win_row and last_win_row['created_at']:
                try:
                    last_win_ts = datetime.fromisoformat(str(last_win_row['created_at']).replace('Z', '+00:00')).timestamp()
                except Exception:
                    pass

        if last_win_ts > 0:
            elapsed_minutes = (time.time() - last_win_ts) / 60.0
            if elapsed_minutes < 30.0:
                rem_min = int(30.0 - elapsed_minutes) + 1
                return jsonify({
                    'success': False,
                    'message': f'Game jeetne ke 30 minute baad hi jeete hue paise withdraw ho sakte hain! Kripya {rem_min} minute baad dobara koshish karein.'
                }), 400

        # Deduct from Winning Balance
        new_win_bal = max(0.0, round(win_bal - amount, 2))
        new_bal = max(0.0, round(current_bal - amount, 2))
        cursor.execute('UPDATE users SET balance = ?, winning_balance = ? WHERE id = ?', (new_bal, new_win_bal, user['id']))

        tds_amt = round(amount * 0.18, 2)
        net_amt = round(amount - tds_amt, 2)
        full_details = f"{details} | Gross: ₹{amount:.2f} | TDS 18%: -₹{tds_amt:.2f} | Net: ₹{net_amt:.2f}"
        tx_id = f"WTH{int(time.time()*1000)}"
        now_iso = datetime.now().isoformat()
        cursor.execute(
            'INSERT INTO transactions (id, user_id, type, amount, status, details, tds_amount, net_amount, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            (tx_id, user['id'], 'withdraw', amount, 'pending', full_details, tds_amt, net_amt, now_iso)
        )
        conn.commit()

    return jsonify({
        'success': True,
        'balance': new_bal,
        'winning_balance': new_win_bal,
        'deposit_balance': dep_bal,
        'gross_amount': amount,
        'tds_amount': tds_amt,
        'net_amount': net_amt,
        'message': f'Withdrawal of ₹{amount:.2f} requested! (18% TDS: -₹{tds_amt:.2f} | Net to receive: ₹{net_amt:.2f}). Processing within working hours (10:00 AM - 08:00 PM).',
        'tx_id': tx_id
    })

@app.route('/api/wallet/transactions', methods=['GET'])
def api_my_transactions():
    user = get_current_user(request)
    if not user:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 401

    uid = int(user['id'])
    alt_uid = uid + 100000 if uid < 100000 else uid - 100000
    tx_type = request.args.get('type')
    with get_db() as conn:
        cursor = conn.cursor()
        if tx_type:
            cursor.execute('SELECT * FROM transactions WHERE user_id IN (?, ?) AND type = ? ORDER BY created_at DESC LIMIT 100', (uid, alt_uid, tx_type))
        else:
            cursor.execute('SELECT * FROM transactions WHERE user_id IN (?, ?) ORDER BY created_at DESC LIMIT 100', (uid, alt_uid))
        rows = [dict(r) for r in cursor.fetchall()]

    return jsonify({'success': True, 'transactions': rows})

@app.route('/api/wallet/withdrawals', methods=['GET'])
def api_my_withdrawals():
    user = get_current_user(request)
    if not user:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 401

    uid = int(user['id'])
    alt_uid = uid + 100000 if uid < 100000 else uid - 100000
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM transactions WHERE user_id IN (?, ?) AND type = "withdraw" ORDER BY created_at DESC LIMIT 100', (uid, alt_uid))
        rows = [dict(r) for r in cursor.fetchall()]

    return jsonify({'success': True, 'withdrawals': rows, 'transactions': rows})

@app.route('/api/wallet/sync-game-delta', methods=['POST'])
def api_sync_game_delta():
    user = get_current_user(request)
    if not user:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 401
    data = request.get_json(silent=True) or {}
    try:
        delta = float(data.get('delta', 0))
    except:
        delta = 0.0
    if delta == 0:
        return jsonify({'success': True, 'balance': user['balance']})

    with get_db() as conn:
        new_bal, new_dep, new_win = apply_user_wallet_delta(conn, user['id'], delta, 'game')
        tx_type = 'win' if delta > 0 else 'bet'
        game = str(data.get('game', 'Game')).strip()
        details = str(data.get('details', '')).strip() or f"{game} {'Win' if delta > 0 else 'Bet'}"
        tx_id = str(data.get('id', '')).strip() or f"TX{int(time.time()*1000)}{random.randint(100,999)}"
        cursor = conn.cursor()
        cursor.execute(
            'INSERT INTO transactions (id, user_id, type, amount, status, details, created_at) VALUES (?, ?, ?, ?, "approved", ?, ?)',
            (tx_id, user['id'], tx_type, abs(delta), details, datetime.now().isoformat())
        )
        conn.commit()

    return jsonify({'success': True, 'balance': new_bal, 'deposit_balance': new_dep, 'winning_balance': new_win})

@app.route('/api/referral/stats', methods=['GET'])
def api_referral_stats():
    user = get_current_user(request)
    if not user:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 401
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT id, phone, created_at, balance FROM users WHERE referred_by = ? ORDER BY created_at DESC', (user['invite_code'],))
        subordinates = [dict(r) for r in cursor.fetchall()]

        cursor.execute('SELECT * FROM commissions WHERE user_id = ?', (user['id'],))
        commissions = [dict(r) for r in cursor.fetchall()]

        total_earned = round(sum(float(c['commission'] or 0) for c in commissions), 2)
        unclaimed = round(sum(float(c['commission'] or 0) for c in commissions if int(c.get('claimed', 0)) == 0), 2)
        total_turnover = round(sum(float(c['bet_amount'] or 0) for c in commissions), 2)

        tier1_count = len(subordinates)
        tier2_count = len([c for c in commissions if c.get('tier') == 2])
        tier3_count = len([c for c in commissions if c.get('tier') == 3])

    return jsonify({
        'success': True,
        'invite_code': user['invite_code'],
        'invite_link': f"https://akshitkumarsaxena3-cyber.github.io/asgames/?r={user['invite_code']}",
        'tier1Count': tier1_count,
        'tier2Count': tier2_count,
        'tier3Count': tier3_count,
        'totalMembers': tier1_count + tier2_count + tier3_count,
        'totalTurnover': total_turnover,
        'totalEarned': total_earned,
        'unclaimedCommission': unclaimed,
        'unclaimed_commission': unclaimed,
        'totalCommission': total_earned,
        'total_commission': total_earned,
        'subordinates': [{
            'id': s['id'],
            'phone': _re.sub(r'(\d{3})\d{4}(\d{3})', r'\1****\2', str(s['phone'])) if len(str(s.get('phone') or '')) >= 10 else s.get('phone'),
            'date': s.get('created_at', ''),
            'created_at': s.get('created_at', '')
        } for s in subordinates[:50]]
    })

@app.route('/api/referral/claim', methods=['POST'])
def api_referral_claim():
    user = get_current_user(request)
    if not user:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 401
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT id, commission FROM commissions WHERE user_id = ? AND claimed = 0', (user['id'],))
        unclaimed_rows = cursor.fetchall()
        total = round(sum(float(r['commission'] or 0) for r in unclaimed_rows), 2)
        if total <= 0:
            return jsonify({'success': False, 'message': 'No commission available to claim.'})

        cursor.execute('UPDATE commissions SET claimed = 1 WHERE user_id = ? AND claimed = 0', (user['id'],))
        apply_user_wallet_delta(conn, user['id'], total, 'deposit')
        now_iso = datetime.now().isoformat()
        cursor.execute(
            'INSERT INTO transactions (id, user_id, type, amount, status, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            (f"TX{int(time.time()*1000)}", user['id'], 'commission', total, 'approved', 'Referral Commission Claim', now_iso)
        )
        conn.commit()
    return jsonify({'success': True, 'message': f'Successfully claimed ₹{total:.2f} referral commission!', 'claimed': total})


# ========================================================
# GAME APIS (Win-Go 1Min / 30s)
# ========================================================

@app.route('/api/game/current', methods=['GET'])
def api_game_current():
    mode = str(request.args.get('mode', '30s'))
    info = get_current_period_info(mode)
    prev_info = get_current_period_info(mode, time.time() - info['duration'])
    draw_round_if_needed(prev_info['period'], mode)
    return jsonify({
        'success': True,
        'mode': mode,
        'period': info['period'],
        'currentPeriod': info['period'],
        'remainingSeconds': info['remainingSeconds'],
        'isLocked': info['isLocked'],
        'serverTime': info['serverTime']
    })

@app.route('/api/game/round-result', methods=['GET'])
def api_game_round_result():
    mode = str(request.args.get('mode', '30s'))
    period = str(request.args.get('period', '')).strip()
    if not period:
        return jsonify({'success': False, 'message': 'Missing period parameter'}), 400

    round_data = draw_round_if_needed(period, mode)
    if round_data:
        num = int(round_data.get('number', 0))
        col = round_data.get('color') or determine_color(num)
        sz = round_data.get('size') or ('Big' if num >= 5 else 'Small')
        return jsonify({
            'success': True,
            'drawn': True,
            'period': str(round_data.get('period') or period),
            'period_id': str(round_data.get('period') or period),
            'number': num,
            'winning_number': num,
            'color': col,
            'winning_color': col,
            'size': sz,
            'winning_size': sz,
            'game_mode': mode,
            'created_at': round_data.get('created_at', '')
        })
    return jsonify({'success': False, 'drawn': False, 'message': 'Drawing in progress...'})

@app.route('/api/game/bet', methods=['POST'])
def api_game_bet():
    user = get_current_user(request)
    if not user:
        return jsonify({'success': False, 'message': 'Please login to place bets'}), 401

    data = request.get_json(silent=True) or {}
    game_mode = str(data.get('game_mode', '30s'))
    info = get_current_period_info(game_mode)
    req_period = str(data.get('period_id') or data.get('period') or '').strip()
    if not req_period or req_period == info['period']:
        if info['isLocked'] or info['remainingSeconds'] <= 5:
            return jsonify({'success': False, 'message': 'Round is locked for last 5 seconds! Please wait for next round.'}), 400

    effective_period = str(data.get('period_id') or data.get('period') or info['period']).strip()
    select_type = data.get('select_type')
    select_val = str(data.get('select_value') or data.get('select_val') or '').lower()
    amount = float(data.get('amount', 0))

    if amount < 1:
        return jsonify({'success': False, 'message': 'Minimum bet is ₹1'}), 400

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT 1 FROM game_rounds WHERE period = ?', (effective_period,))
        if cursor.fetchone():
            return jsonify({'success': False, 'message': 'This round has already closed and drawn! Please wait for next round.'}), 400
        cursor.execute('SELECT balance FROM users WHERE id = ?', (user['id'],))
        row = cursor.fetchone()
        balance = float(row['balance']) if row else 0.0

        if balance < amount:
            return jsonify({'success': False, 'message': 'Insufficient balance! Please deposit.'}), 400

        new_bal, new_dep, new_win = apply_user_wallet_delta(conn, user['id'], -amount, 'bet')
        bet_id = f"BET_{int(time.time()*1000)}_{random.randint(100, 999)}"
        now_iso = datetime.now().isoformat()
        cursor.execute(
            'INSERT INTO bets (id, user_id, period, select_type, select_val, amount, win_amount, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            (bet_id, user['id'], effective_period, select_type, select_val, amount, 0.0, 'pending', now_iso)
        )
        bet_detail = f"Win Go {game_mode} Period #{effective_period} • {select_val.upper()}"
        cursor.execute(
            'INSERT INTO transactions (id, user_id, type, amount, status, details, created_at) VALUES (?, ?, "bet", ?, "approved", ?, ?)',
            (bet_id, user['id'], amount, bet_detail, now_iso)
        )
        cursor.execute(
            'INSERT INTO game_history (id, user_id, game, detail, bet_amount, win_amount, status, created_at) VALUES (?, ?, "Win Go", ?, ?, 0.0, "Pending", ?)',
            (bet_id, user['id'], f"{game_mode} • #{effective_period} • {select_val.upper()}", amount, now_iso)
        )
        conn.commit()

    return jsonify({'success': True, 'message': 'Bet placed successfully!', 'balance': new_bal, 'newBalance': new_bal, 'new_balance': new_bal, 'period_id': effective_period, 'serverSettled': True})

@app.route('/api/game/history', methods=['GET'])
def api_game_history():
    mode = str(request.args.get('mode', '30s'))
    info = get_current_period_info(mode)
    prev_info = get_current_period_info(mode, time.time() - info['duration'])
    draw_round_if_needed(prev_info['period'], mode)
    seed_initial_history_if_needed(mode)

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM game_rounds ORDER BY created_at DESC, period DESC LIMIT 50')
        rows = []
        for r in cursor.fetchall():
            d = dict(r)
            num = int(d.get('number', 0))
            col = d.get('color') or determine_color(num)
            sz = d.get('size') or ('Big' if num >= 5 else 'Small')
            p = str(d.get('period', ''))
            rows.append({
                'period': p,
                'period_id': p,
                'number': num,
                'winning_number': num,
                'color': col,
                'winning_color': col,
                'size': sz,
                'winning_size': sz,
                'game_mode': d.get('game_mode', mode),
                'created_at': d.get('created_at', '')
            })

    return jsonify({'success': True, 'history': rows})

@app.route('/api/game/my-bets', methods=['GET'])
def api_game_my_bets():
    user = get_current_user(request)
    if not user:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 401

    uid = int(user['id'])
    alt_uid = uid + 100000 if uid < 100000 else uid - 100000
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM bets WHERE user_id IN (?, ?) ORDER BY created_at DESC LIMIT 50', (uid, alt_uid))
        rows = [dict(r) for r in cursor.fetchall()]

        for b in rows:
            p = str(b.get('period') or '')
            cursor.execute('SELECT number, color FROM game_rounds WHERE period = ?', (p,))
            rnd = cursor.fetchone()
            if rnd:
                num = rnd['number']
                b['winning_number'] = num
                b['winning_color'] = rnd['color']
                b['winning_size'] = 'Big' if (num is not None and num >= 5) else 'Small'

    return jsonify({'success': True, 'bets': rows})


# ========================================================
# ADMIN CONTROL & RIGGING APIS (Password: spp213201pty)
# ========================================================

@app.route('/api/admin/login', methods=['POST'])
def api_admin_login():
    data = request.get_json(silent=True) or {}
    password = str(data.get('password', '')).strip()

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT value FROM settings WHERE key = ?', ('admin_password',))
        row = cursor.fetchone()
        expected = row['value'] if row else 'spp213201pty'

    if password == expected:
        return jsonify({'success': True, 'message': 'Admin verified', 'adminKey': expected})
    return jsonify({'success': False, 'message': 'Invalid Admin Password!'}), 403

@app.route('/api/admin/overview', methods=['GET'])
def api_admin_overview():
    ok, _ = verify_admin(request)
    if not ok:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 403

    info_30s = get_current_period_info('30s')
    period = info_30s['period']
    remaining = info_30s['remainingSeconds']
    is_locked = info_30s['isLocked']

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT COUNT(*) as c, SUM(balance) as b FROM users')
        u_row = cursor.fetchone()
        users_count = u_row['c'] or 0
        total_balance = u_row['b'] or 0.0

        cursor.execute('SELECT COUNT(*) as c FROM transactions WHERE type="deposit" AND status="pending"')
        pending_dep = cursor.fetchone()['c'] or 0

        cursor.execute('SELECT COUNT(*) as c FROM transactions WHERE type="withdraw" AND status="pending"')
        pending_wth = cursor.fetchone()['c'] or 0

        cursor.execute('SELECT value FROM settings WHERE key="game_mode"')
        mode_row = cursor.fetchone()
        game_mode = mode_row['value'] if mode_row else 'random'

        cursor.execute('SELECT value FROM settings WHERE key="manual_number"')
        man_row = cursor.fetchone()
        manual_num = man_row['value'] if man_row else ''

        cursor.execute('SELECT key, value FROM settings')
        all_sets = {r['key']: r['value'] for r in cursor.fetchall()}

        # Collect info for all 4 Win Go Modes
        wingo_modes = {}
        for m in ['30s', '1m', '3m', '5m']:
            inf = get_current_period_info(m)
            m_mode = all_sets.get(f'wingo_{m}_mode')
            if not m_mode and m == '30s':
                m_mode = all_sets.get('game_mode', 'house_edge')
            if not m_mode:
                m_mode = 'house_edge'

            m_man = all_sets.get(f'wingo_{m}_manual')
            if (m_man is None or m_man == '') and m == '30s':
                m_man = all_sets.get('manual_number', '')
            if m_man is None:
                m_man = ''

            # Wagers on current period for mode m
            cursor.execute('SELECT select_val, SUM(amount) as amt FROM bets WHERE period = ? GROUP BY select_val', (inf['period'],))
            wager_rows = cursor.fetchall()
            m_wagers = {
                'green': 0.0, 'red': 0.0, 'violet': 0.0, 'big': 0.0, 'small': 0.0,
                'numbers': {str(i): 0.0 for i in range(10)}
            }
            for r in wager_rows:
                s_val = str(r['select_val']).lower()
                amt = float(r['amt'] or 0)
                if s_val in ['green', 'red', 'violet', 'big', 'small']:
                    m_wagers[s_val] = amt
                elif s_val in m_wagers['numbers']:
                    m_wagers['numbers'][s_val] = amt
                elif s_val.isdigit() and 0 <= int(s_val) <= 9:
                    m_wagers['numbers'][str(int(s_val))] = amt

            cursor.execute('''
                SELECT b.id, b.select_type, b.select_val, b.amount, b.created_at, u.phone as user_phone, u.name as user_name
                FROM bets b LEFT JOIN users u ON b.user_id = u.id
                WHERE b.period = ?
                ORDER BY b.created_at DESC LIMIT 50
            ''', (inf['period'],))
            m_bets = [dict(r) for r in cursor.fetchall()]

            wingo_modes[m] = {
                'mode': m,
                'period': inf['period'],
                'remainingSeconds': inf.get('remainingSeconds', 0),
                'isLocked': inf.get('isLocked', False),
                'duration': inf['duration'],
                'gameMode': m_mode,
                'manualNumber': m_man,
                'wagers': m_wagers,
                'activeBets': m_bets
            }

        def30 = wingo_modes.get('30s', {})

    return jsonify({
        'success': True,
        'currentPeriod': def30.get('period', period),
        'remainingSeconds': def30.get('remainingSeconds', remaining),
        'isLocked': def30.get('isLocked', is_locked),
        'gameMode': def30.get('gameMode', 'house_edge'),
        'manualNumber': def30.get('manualNumber', ''),
        'wagers': def30.get('wagers', {}),
        'activeBets': def30.get('activeBets', []),
        'wingoModes': wingo_modes,
        'aviatorMode': all_sets.get('aviator_mode', 'smart_profit'),
        'aviatorCrash': all_sets.get('aviator_crash', '2.00'),
        'aviatorState': get_aviator_public_state(is_admin=True),
        'minesMode': all_sets.get('mines_mode', 'random'),
        'minesMaxSafe': all_sets.get('mines_max_safe', '1'),
        'k3Mode': all_sets.get('k3_mode', 'random'),
        'k3Dice': all_sets.get('k3_dice', '1,2,3'),
        'ludoMode': all_sets.get('ludo_mode', 'fair'),
        'stats': {
            'users': users_count,
            'totalBalance': total_balance,
            'pendingDeposits': pending_dep,
            'pendingWithdrawals': pending_wth
        }
    })

@app.route('/api/game/all-rigging', methods=['GET'])
def api_game_all_rigging():
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT key, value FROM settings')
        s = {r['key']: r['value'] for r in cursor.fetchall()}
    return jsonify({
        'success': True,
        'wingo_30s_mode': s.get('wingo_30s_mode') or s.get('game_mode', 'house_edge'),
        'wingo_30s_manual': s.get('wingo_30s_manual', s.get('manual_number', '')),
        'wingo_1m_mode': s.get('wingo_1m_mode', 'house_edge'),
        'wingo_1m_manual': s.get('wingo_1m_manual', ''),
        'wingo_3m_mode': s.get('wingo_3m_mode', 'house_edge'),
        'wingo_3m_manual': s.get('wingo_3m_manual', ''),
        'wingo_5m_mode': s.get('wingo_5m_mode', 'house_edge'),
        'wingo_5m_manual': s.get('wingo_5m_manual', ''),
        'wingo_mode': s.get('game_mode', 'house_edge'),
        'wingo_manual_number': s.get('manual_number', ''),
        'aviator_mode': s.get('aviator_mode', 'smart_profit'),
        'aviator_crash': float(s.get('aviator_crash', '2.00') or 2.00),
        'aviator_force_ts': int(s.get('aviator_force_ts', '0') or 0),
        'mines_mode': s.get('mines_mode', 'random'),
        'mines_max_safe': int(s.get('mines_max_safe', '1') or 1),
        'k3_mode': s.get('k3_mode', 'random'),
        'k3_dice': s.get('k3_dice', '1,2,3'),
        'ludo_mode': s.get('ludo_mode', 'fair')
    })

@app.route('/api/admin/control', methods=['POST'])
def api_admin_control():
    ok, _ = verify_admin(request)
    if not ok:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 403

    data = request.get_json(silent=True) or {}
    target_game = data.get('wingo_game') or data.get('target_mode') or '30s'

    with get_db() as conn:
        cursor = conn.cursor()
        if 'mode' in data and data['mode'] is not None:
            cursor.execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', (f'wingo_{target_game}_mode', str(data['mode'])))
            if target_game == '30s':
                cursor.execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ('game_mode', str(data['mode'])))

        if 'manual_number' in data and data['manual_number'] is not None:
            cursor.execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', (f'wingo_{target_game}_manual', str(data['manual_number'])))
            if target_game == '30s':
                cursor.execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ('manual_number', str(data['manual_number'])))

        if 'lock_force' in data and data['lock_force'] is not None:
            cursor.execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', (f'wingo_{target_game}_lock', '1' if data['lock_force'] else '0'))

        mapping = {
            'aviator_mode': 'aviator_mode',
            'aviator_crash': 'aviator_crash',
            'aviator_force_ts': 'aviator_force_ts',
            'mines_mode': 'mines_mode',
            'mines_max_safe': 'mines_max_safe',
            'k3_mode': 'k3_mode',
            'k3_dice': 'k3_dice',
            'ludo_mode': 'ludo_mode'
        }
        for body_key, db_key in mapping.items():
            if body_key in data and data[body_key] is not None:
                cursor.execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', (db_key, str(data[body_key])))
        conn.commit()

    if 'aviator_crash' in data and data['aviator_crash'] is not None:
        try:
            val = float(data['aviator_crash'])
            if val >= 1.00:
                _AVIATOR_ENGINE['forced_crash'] = val
                _AVIATOR_ENGINE['crash_multiplier'] = val
        except:
            pass

    return jsonify({'success': True, 'message': f'Controls updated for Win Go [{target_game}] and other games successfully!'})

# ========================================================
# AVIATOR PUBLIC / PLAYER / ADMIN APIS
# ========================================================

@app.route('/api/aviator/state', methods=['GET'])
def api_aviator_state():
    is_admin = False
    admin_key = request.headers.get('x-admin-key') or request.args.get('adminKey') or ''
    if admin_key:
        ok, _ = verify_admin(request)
        is_admin = ok
    return jsonify(get_aviator_public_state(is_admin=is_admin))

@app.route('/api/aviator/bet', methods=['POST'])
def api_aviator_bet():
    user = get_current_user(request)
    if not user:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 401

    update_aviator_engine()
    if _AVIATOR_ENGINE['state'] in ('flying', 'crashed'):
        return jsonify({'success': False, 'message': 'Flight has already taken off! Please wait for next round countdown.'}), 400

    data = request.get_json(silent=True) or {}
    try:
        amount = max(10.0, float(data.get('amount', 0)))
    except:
        amount = 10.0
    try:
        auto_cashout = float(data.get('auto_cashout', 0))
    except:
        auto_cashout = 0.0

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT balance, phone, name FROM users WHERE id = ?', (user['id'],))
        row = cursor.fetchone()
        if not row or float(row['balance'] or 0) < amount:
            return jsonify({'success': False, 'message': 'Insufficient balance! Please deposit.'}), 400

        new_bal, new_dep, new_win = apply_user_wallet_delta(conn, user['id'], -amount, 'bet')
        bet_id = f"AVB{int(time.time()*1000)}{random.randint(100, 999)}"
        now_iso = datetime.now().isoformat()

        cursor.execute(
            'INSERT INTO transactions (id, user_id, type, amount, status, details, created_at) VALUES (?, ?, "bet", ?, "approved", ?, ?)',
            (bet_id, user['id'], amount, f"Aviator Bet #{_AVIATOR_ENGINE['round_id']}", now_iso)
        )
        conn.commit()

    bet_obj = {
        'id': bet_id,
        'user_id': user['id'],
        'phone': user.get('phone') or '9999999999',
        'name': user.get('name') or 'Player',
        'amount': amount,
        'auto_cashout': auto_cashout if auto_cashout > 1.0 else 0.0,
        'status': 'in_flight',
        'cashout_mult': 0.0,
        'win_amount': 0.0,
        'created_at': now_iso
    }
    _AVIATOR_ENGINE['active_bets'].append(bet_obj)

    return jsonify({
        'success': True,
        'message': 'Aviator bet placed!',
        'balance': new_bal,
        'round_id': _AVIATOR_ENGINE['round_id'],
        'bet_id': bet_id
    })

@app.route('/api/aviator/cashout', methods=['POST'])
def api_aviator_cashout():
    user = get_current_user(request)
    if not user:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 401

    update_aviator_engine()
    if _AVIATOR_ENGINE['state'] != 'flying':
        return jsonify({'success': False, 'message': 'Flight is not in the air!'}), 400

    bet = next((b for b in _AVIATOR_ENGINE['active_bets'] if b['user_id'] == user['id'] and b['status'] == 'in_flight'), None)
    if not bet:
        return jsonify({'success': False, 'message': 'No active flight bet found!'}), 400

    now = time.time()
    elapsed = max(0.0, now - _AVIATOR_ENGINE['state_start_ts'])
    live_mult = min(_AVIATOR_ENGINE['crash_multiplier'], calc_aviator_multiplier(elapsed))

    data = request.get_json(silent=True) or {}
    try:
        req_mult = float(data.get('multiplier', live_mult))
    except:
        req_mult = live_mult

    mult = max(1.01, min(live_mult, req_mult))
    won_amount = math.floor(bet['amount'] * mult * 100.0) / 100.0

    bet['status'] = 'cashed_out'
    bet['cashout_mult'] = mult
    bet['win_amount'] = won_amount

    with get_db() as conn:
        new_bal, new_dep, new_win = apply_user_wallet_delta(conn, user['id'], won_amount, 'win')
        tx_id = f"AVW{int(time.time()*1000)}{random.randint(100, 999)}"
        cursor = conn.cursor()
        cursor.execute(
            'INSERT INTO transactions (id, user_id, type, amount, status, details, created_at) VALUES (?, ?, "win", ?, "approved", ?, ?)',
            (tx_id, user['id'], won_amount, f"Aviator Cashout @ {mult:.2f}x", datetime.now().isoformat())
        )
        conn.commit()

    return jsonify({
        'success': True,
        'won_amount': won_amount,
        'multiplier': mult,
        'balance': new_bal
    })

@app.route('/api/admin/aviator-force', methods=['POST'])
def api_admin_aviator_force():
    ok, _ = verify_admin(request)
    if not ok:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 403

    data = request.get_json(silent=True) or {}
    try:
        crash_point = float(data.get('crash') or data.get('multiplier') or data.get('target_multiplier') or data.get('aviator_crash') or 1.50)
    except:
        crash_point = 1.50

    if crash_point < 1.00:
        return jsonify({'success': False, 'message': 'Invalid crash multiplier'}), 400

    _AVIATOR_ENGINE['forced_crash'] = crash_point
    _AVIATOR_ENGINE['crash_multiplier'] = crash_point
    _AVIATOR_ENGINE['mode'] = 'manual'

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('INSERT OR REPLACE INTO settings (key, value) VALUES ("aviator_crash", ?)', (str(crash_point),))
        cursor.execute('INSERT OR REPLACE INTO settings (key, value) VALUES ("aviator_mode", "manual")')
        conn.commit()

    return jsonify({
        'success': True,
        'target': crash_point,
        'message': f"Next Aviator flight locked at {crash_point:.2f}x!",
        'forced_crash': crash_point
    })

# ========================================================
# SPECIAL VIP SUPERPOWER CONTROLLER APIS (User: 9720955287)
# ========================================================

@app.route('/api/game/vip-control-status', methods=['GET'])
def api_vip_control_status():
    user = get_current_user(request)
    if not user or not is_special_vip_phone(user.get('phone')):
        return jsonify({'success': False, 'message': 'VIP Access Required'}), 403

    modes = {}
    with get_db() as conn:
        cursor = conn.cursor()
        for m in ['30s', '1m', '3m', '5m']:
            inf = get_current_period_info(m)
            cursor.execute('SELECT value FROM settings WHERE key = ?', (f'wingo_{m}_mode',))
            r_mode = cursor.fetchone()
            cursor.execute('SELECT value FROM settings WHERE key = ?', (f'wingo_{m}_manual',))
            r_man = cursor.fetchone()
            cursor.execute('SELECT value FROM settings WHERE key = ?', (f'wingo_{m}_lock',))
            r_lock = cursor.fetchone()

            active_m = r_mode['value'] if r_mode else 'lowest_bet'
            active_man = r_man['value'] if r_man else ''
            is_locked = (r_lock['value'] == '1') if r_lock else False

            modes[m] = {
                'period': inf['period'],
                'remaining_seconds': inf.get('remainingSeconds', 0),
                'mode': active_m,
                'manual_number': active_man,
                'is_locked': is_locked
            }

    return jsonify({
        'success': True,
        'is_vip': True,
        'phone': user.get('phone'),
        'modes': modes
    })

@app.route('/api/game/vip-control', methods=['POST'])
def api_vip_control():
    user = get_current_user(request)
    if not user or not is_special_vip_phone(user.get('phone')):
        return jsonify({'success': False, 'message': 'Forbidden: Special VIP Superpower is restricted to authorized account.'}), 403

    data = request.get_json(silent=True) or {}
    target_game = data.get('target_game') or data.get('wingo_game') or '30s'
    if target_game not in ['30s', '1m', '3m', '5m']:
        target_game = '30s'

    action = data.get('action')
    with get_db() as conn:
        cursor = conn.cursor()
        if action in ['revert', 'cancel']:
            cursor.execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', (f'wingo_{target_game}_mode', 'lowest_bet'))
            cursor.execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', (f'wingo_{target_game}_manual', ''))
            cursor.execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', (f'wingo_{target_game}_lock', '0'))
            if target_game == '30s':
                cursor.execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ('game_mode', 'house_edge'))
                cursor.execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ('manual_number', ''))
            conn.commit()
            return jsonify({
                'success': True,
                'message': f'[Win Go {target_game.upper()}] Force cancelled! Reverted to Auto Profit Max.',
                'target_game': target_game,
                'mode': 'lowest_bet',
                'manual_number': '',
                'lock_force': False
            })

        num_to_force = None
        man_num = data.get('manual_number')
        choice = data.get('choice')

        if man_num is not None and str(man_num).strip() != '':
            try:
                p = int(man_num)
                if 0 <= p <= 9:
                    num_to_force = p
            except (ValueError, TypeError):
                pass
        elif choice is not None:
            ch = str(choice).lower().strip()
            if ch.isdigit() and len(ch) == 1:
                num_to_force = int(ch)
            elif ch == 'green':
                num_to_force = 3
            elif ch == 'red':
                num_to_force = 2
            elif ch == 'violet':
                num_to_force = 0
            elif ch == 'big':
                num_to_force = 7
            elif ch == 'small':
                num_to_force = 2

        if num_to_force is None:
            return jsonify({'success': False, 'message': 'Invalid choice. Choose a number (0-9) or color (Green, Red, Violet, Big, Small).'})

        is_lock = bool(data.get('lock_force'))
        cursor.execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', (f'wingo_{target_game}_mode', 'manual'))
        cursor.execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', (f'wingo_{target_game}_manual', str(num_to_force)))
        cursor.execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', (f'wingo_{target_game}_lock', '1' if is_lock else '0'))
        if target_game == '30s':
            cursor.execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ('game_mode', 'manual'))
            cursor.execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ('manual_number', str(num_to_force)))
        conn.commit()

        color_desc = 'Violet-Red' if num_to_force == 0 else ('Violet-Green' if num_to_force == 5 else ('Green' if num_to_force in [1, 3, 7, 9] else 'Red'))
        size_desc = 'Big' if num_to_force >= 5 else 'Small'

        return jsonify({
            'success': True,
            'message': f"👑 Superpower Armed! Win Go {target_game.upper()} forced to {num_to_force} ({color_desc} • {size_desc})! {'🔒 Continuous Lock Active' if is_lock else '🎯 Next Round Only'}",
            'target_game': target_game,
            'forced_number': num_to_force,
            'color': color_desc,
            'size': size_desc,
            'lock_force': is_lock
        })

@app.route('/api/admin/recent-bets', methods=['GET'])
def api_admin_recent_bets():
    ok, _ = verify_admin(request)
    if not ok:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 403

    mode = request.args.get('mode')
    with get_db() as conn:
        cursor = conn.cursor()
        query = 'SELECT b.*, u.phone FROM bets b LEFT JOIN users u ON b.user_id = u.id'
        params = []
        if mode and mode != 'all':
            query += ' WHERE b.game_mode = ? OR (b.game_mode IS NULL AND ? = "30s")'
            params = [mode, mode]
        query += ' ORDER BY b.created_at DESC LIMIT 20'
        cursor.execute(query, tuple(params))
        rows = [dict(r) for r in cursor.fetchall()]

    return jsonify({'success': True, 'bets': rows})

@app.route('/api/admin/users', methods=['GET'])
def api_admin_users():
    ok, _ = verify_admin(request)
    if not ok:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 403

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT id, phone, email, password, balance, invite_code, referred_by, vip_level, is_banned, created_at FROM users ORDER BY id DESC LIMIT 100')
        rows = [dict(r) for r in cursor.fetchall()]

    return jsonify({'success': True, 'users': rows})

@app.route('/api/admin/toggle-ban', methods=['POST'])
def api_admin_toggle_ban():
    ok, _ = verify_admin(request)
    if not ok:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 403

    data = request.get_json(silent=True) or {}
    u_id = data.get('user_id')
    is_banned = int(data.get('is_banned', 0))

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('UPDATE users SET is_banned = ? WHERE id = ?', (is_banned, u_id))
        conn.commit()

    return jsonify({'success': True, 'message': 'User status updated'})

@app.route('/api/admin/adjust-balance', methods=['POST'])
def api_admin_adjust_balance():
    ok, _ = verify_admin(request)
    if not ok:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 403

    data = request.get_json(silent=True) or {}
    u_id = data.get('user_id')
    amt = float(data.get('amount', 0))

    with get_db() as conn:
        apply_user_wallet_delta(conn, u_id, amt, 'deposit' if amt >= 0 else 'bet')
        conn.commit()

    return jsonify({'success': True, 'message': 'Balance adjusted successfully!'})

@app.route('/api/admin/deposits', methods=['GET'])
def api_admin_deposits():
    ok, _ = verify_admin(request)
    if not ok:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 403

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT t.*, u.phone, u.name as user_name, u.email as user_email, u.balance as user_balance 
            FROM transactions t 
            LEFT JOIN users u ON t.user_id = u.id 
            WHERE t.type = "deposit" AND t.status = "pending"
            ORDER BY t.created_at DESC
        ''')
        rows = [dict(r) for r in cursor.fetchall()]

    return jsonify({'success': True, 'deposits': rows})

@app.route('/api/admin/approve-deposit', methods=['POST'])
def api_admin_approve_deposit():
    ok, _ = verify_admin(request)
    if not ok:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 403

    data = request.get_json(silent=True) or {}
    tx_id = data.get('tx_id')

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM transactions WHERE id = ? AND status = "pending"', (tx_id,))
        tx = cursor.fetchone()
        if not tx:
            return jsonify({'success': False, 'message': 'Transaction not found or already processed'}), 404

        amt = float(tx['amount'])
        u_id = tx['user_id']
        apply_user_wallet_delta(conn, u_id, amt, 'deposit')
        distribute_deposit_commissions(conn, u_id, amt)
        cursor.execute('UPDATE transactions SET status = "completed" WHERE id = ?', (tx_id,))
        conn.commit()

    return jsonify({'success': True, 'message': f'Deposit of ₹{amt} approved and credited to User #{u_id}!'})

@app.route('/api/admin/reject-deposit', methods=['POST'])
def api_admin_reject_deposit():
    ok, _ = verify_admin(request)
    if not ok:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 403

    data = request.get_json(silent=True) or {}
    tx_id = data.get('tx_id')

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('UPDATE transactions SET status = "rejected" WHERE id = ? AND status = "pending"', (tx_id,))
        conn.commit()

    return jsonify({'success': True, 'message': 'Deposit request rejected.'})

@app.route('/api/admin/withdrawals', methods=['GET'])
def api_admin_withdrawals():
    ok, _ = verify_admin(request)
    if not ok:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 403

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT t.*, u.phone, u.name as user_name, u.email as user_email, u.balance as user_balance 
            FROM transactions t 
            LEFT JOIN users u ON t.user_id = u.id 
            WHERE t.type = "withdraw" AND t.status = "pending"
            ORDER BY t.created_at DESC
        ''')
        rows = [dict(r) for r in cursor.fetchall()]

    return jsonify({'success': True, 'withdrawals': rows})

@app.route('/api/admin/approve-withdrawal', methods=['POST'])
def api_admin_approve_withdrawal():
    ok, _ = verify_admin(request)
    if not ok:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 403

    data = request.get_json(silent=True) or {}
    tx_id = data.get('tx_id')

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('UPDATE transactions SET status = "completed" WHERE id = ? AND status = "pending"', (tx_id,))
        conn.commit()

    return jsonify({'success': True, 'message': 'Withdrawal approved & marked as Paid!'})

@app.route('/api/admin/reject-withdrawal', methods=['POST'])
def api_admin_reject_withdrawal():
    ok, _ = verify_admin(request)
    if not ok:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 403

    data = request.get_json(silent=True) or {}
    tx_id = data.get('tx_id')
    reason = (data.get('reason') or '').strip()
    if not reason:
        reason = 'Rejected by Admin'

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM transactions WHERE id = ? AND status = "pending"', (tx_id,))
        tx = cursor.fetchone()
        if not tx:
            return jsonify({'success': False, 'message': 'Transaction not found or already processed'}), 404

        amt = float(tx['amount'])
        u_id = tx['user_id']
        rej_detail = f' | Reason: {reason}'
        new_details = (tx['details'] or '') + rej_detail

        # Refund held balance directly back to user balance
        cursor.execute('UPDATE users SET balance = balance + ?, winning_balance = winning_balance + ? WHERE id = ?', (amt, amt, u_id))
        cursor.execute('UPDATE transactions SET status = "rejected", details = ? WHERE id = ?', (new_details, tx_id))
        conn.commit()

    return jsonify({'success': True, 'message': f'Withdrawal rejected and ₹{amt} refunded to User #{u_id}!'})

@app.route('/api/admin/all-transactions', methods=['GET'])
def api_admin_all_transactions():
    ok, _ = verify_admin(request)
    if not ok:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 403

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT t.*, u.phone, u.name as user_name, u.email as user_email 
            FROM transactions t 
            LEFT JOIN users u ON t.user_id = u.id 
            ORDER BY t.created_at DESC 
            LIMIT 100
        ''')
        rows = [dict(r) for r in cursor.fetchall()]

    return jsonify({'success': True, 'transactions': rows})

@app.route('/api/admin/sync-status', methods=['GET'])
def api_admin_sync_status():
    ok, _ = verify_admin(request)
    if not ok:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 403
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT COUNT(*) as c FROM users')
        u_c = cursor.fetchone()['c'] or 0
        cursor.execute('SELECT COUNT(*) as c FROM transactions')
        t_c = cursor.fetchone()['c'] or 0
    return jsonify({
        'success': True,
        'pythonanywhere_url': 'https://backandsopport.pythonanywhere.com',
        'is_connected': True,
        'is_master': True,
        'users_count': u_c,
        'transactions_count': t_c
    })

@app.route('/api/admin/set-pythonanywhere', methods=['POST'])
def api_admin_set_pa():
    ok, _ = verify_admin(request)
    if not ok:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 403
    return jsonify({
        'success': True,
        'message': 'PythonAnywhere is the Master Central Database! All data is saved directly in SQLite.',
        'syncSuccess': True
    })

@app.route('/api/admin/sync-now', methods=['POST'])
def api_admin_sync_now():
    ok, _ = verify_admin(request)
    if not ok:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 403
    return jsonify({
        'success': True,
        'message': 'This PythonAnywhere server is the Master Database. All data is saved permanently.'
    })

@app.route('/api/admin/gmail-settings', methods=['GET', 'POST'])
def api_admin_gmail_settings():
    ok, _ = verify_admin(request)
    if not ok:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 403
    if request.method == 'POST':
        data = request.get_json(silent=True) or {}
        g_user = str(data.get('gmail_user', '')).strip()
        g_pass = str(data.get('gmail_app_password', '')).replace(' ', '')
        w_url = str(data.get('email_webhook_url', '')).strip()
        with get_db() as conn:
            c = conn.cursor()
            if g_user:
                c.execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ('gmail_user', g_user))
            if g_pass:
                c.execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ('gmail_app_password', g_pass))
            if 'email_webhook_url' in data:
                c.execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ('email_webhook_url', w_url))
            conn.commit()
        return jsonify({'success': True, 'message': 'Gmail OTP settings saved!'})
    with get_db() as conn:
        c = conn.cursor()
        c.execute('SELECT key, value FROM settings WHERE key IN ("gmail_user", "gmail_app_password", "email_webhook_url")')
        s = {r['key']: r['value'] for r in c.fetchall()}
    return jsonify({
        'success': True,
        'gmail_user': os.environ.get('GMAIL_USER') or s.get('gmail_user', ''),
        'has_password': bool(os.environ.get('GMAIL_PASS') or s.get('gmail_app_password')),
        'email_webhook_url': os.environ.get('EMAIL_WEBHOOK_URL') or s.get('email_webhook_url', '')
    })


# ========================================================
# DYNAMIC PAYMENT & DEPOSIT DETAILS APIS (ADMIN -> PLAYERS)
# ========================================================

@app.route('/api/payment-details', methods=['GET'])
def api_payment_details():
    with get_db() as conn:
        c = conn.cursor()
        c.execute('SELECT key, value FROM settings WHERE key IN ("deposit_upi_id", "deposit_upi_name", "deposit_arpay_upi", "deposit_usdt_address", "deposit_usdt_bep20", "deposit_usdt_polygon", "deposit_usdt_arbitrum", "deposit_usdt_erc20", "deposit_usdt_solana", "deposit_usdt_rate", "deposit_usdt_network", "deposit_qr_url")')
        s = {r['key']: r['value'] for r in c.fetchall()}
    upi_id = s.get('deposit_upi_id') or 'akshit9908@barodampay'
    try:
        usdt_rate = float(s.get('deposit_usdt_rate') or 90.0)
    except Exception:
        usdt_rate = 90.0

    default_wallets = {
        'trc20': { 'name': 'TRC20 (Tron)', 'address': s.get('deposit_usdt_address') or 'TCwpq6nk9KKs3FKgm9oGhw8pgKKjs7JnKa' },
        'bep20': { 'name': 'BEP20 (BNB Smart Chain)', 'address': s.get('deposit_usdt_bep20') or '0x8f1794c280daA146Ca8A46c1b73716D9f3E52AE5' },
        'polygon': { 'name': 'Polygon (POS)', 'address': s.get('deposit_usdt_polygon') or '0x8f1794c280daA146Ca8A46c1b73716D9f3E52AE5' },
        'arbitrum': { 'name': 'Arbitrum One', 'address': s.get('deposit_usdt_arbitrum') or '0x8f1794c280daA146Ca8A46c1b73716D9f3E52AE5' },
        'erc20': { 'name': 'ERC20 (Ethereum)', 'address': s.get('deposit_usdt_erc20') or '0x8f1794c280daA146Ca8A46c1b73716D9f3E52AE5' },
        'solana': { 'name': 'Solana (SPL)', 'address': s.get('deposit_usdt_solana') or 'HdFgzjXMY1HLGh3ogAswvyrAAF5NFqKa61EDQB6krdVH' }
    }

    return jsonify({
        'success': True,
        'upi_id': upi_id,
        'upi_name': s.get('deposit_upi_name') or 'AKSHIT KUMAR SAXENA',
        'arpay_upi': s.get('deposit_arpay_upi') or 'manusaxena465267@ikwik',
        'usdt_address': s.get('deposit_usdt_address') or 'TCwpq6nk9KKs3FKgm9oGhw8pgKKjs7JnKa',
        'usdt_wallets': default_wallets,
        'usdt_rate': usdt_rate,
        'usdt_network': s.get('deposit_usdt_network') or 'TRC20',
        'qr_url': s.get('deposit_qr_url') or '/assets/deposit-qr.jpg'
    })

@app.route('/api/admin/payment-details', methods=['POST'])
def api_admin_payment_details():
    ok, _ = verify_admin(request)
    if not ok:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 403
    data = request.get_json(silent=True) or {}
    upi_id = str(data.get('upi_id', '')).strip()
    upi_name = str(data.get('upi_name', 'ASGames')).strip() or 'ASGames'
    arpay_upi = str(data.get('arpay_upi', '')).strip()
    usdt_address = str(data.get('usdt_address', 'TCwpq6nk9KKs3FKgm9oGhw8pgKKjs7JnKa')).strip()
    usdt_bep20 = str(data.get('usdt_bep20', '0x8f1794c280daA146Ca8A46c1b73716D9f3E52AE5')).strip()
    usdt_polygon = str(data.get('usdt_polygon', '0x8f1794c280daA146Ca8A46c1b73716D9f3E52AE5')).strip()
    usdt_arbitrum = str(data.get('usdt_arbitrum', '0x8f1794c280daA146Ca8A46c1b73716D9f3E52AE5')).strip()
    usdt_erc20 = str(data.get('usdt_erc20', '0x8f1794c280daA146Ca8A46c1b73716D9f3E52AE5')).strip()
    usdt_solana = str(data.get('usdt_solana', 'HdFgzjXMY1HLGh3ogAswvyrAAF5NFqKa61EDQB6krdVH')).strip()
    try:
        usdt_rate = float(data.get('usdt_rate') or 90.0)
    except Exception:
        usdt_rate = 90.0
    usdt_network = str(data.get('usdt_network', 'TRC20')).strip()
    qr_url = str(data.get('qr_url', '')).strip()
    if not upi_id:
        return jsonify({'success': False, 'message': 'Official UPI ID is required.'}), 400
    with get_db() as conn:
        c = conn.cursor()
        for k, v in [
            ('deposit_upi_id', upi_id),
            ('deposit_upi_name', upi_name),
            ('deposit_arpay_upi', arpay_upi),
            ('deposit_usdt_address', usdt_address),
            ('deposit_usdt_bep20', usdt_bep20),
            ('deposit_usdt_polygon', usdt_polygon),
            ('deposit_usdt_arbitrum', usdt_arbitrum),
            ('deposit_usdt_erc20', usdt_erc20),
            ('deposit_usdt_solana', usdt_solana),
            ('deposit_usdt_rate', str(usdt_rate)),
            ('deposit_usdt_network', usdt_network),
            ('deposit_qr_url', qr_url),
        ]:
            c.execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', (k, v))
        conn.commit()
    return jsonify({'success': True, 'message': 'Payment details updated! All players will now see your new UPI/QR/USDT details.'})


# ========================================================
# MACRODROID MOBILE DEPOSIT AUTOMATION (INSTANT AUTO-CREDIT)
# ========================================================

def parse_macrodroid_message(input_data):
    raw_text = ''
    utr = ''
    amount = 0.0
    sender = ''

    if isinstance(input_data, str):
        raw_text = input_data.strip()
        if (raw_text.startswith('{') and raw_text.endswith('}')) or (raw_text.startswith('[') and raw_text.endswith(']')):
            try:
                input_data = json.loads(raw_text)
            except Exception:
                pass

    if isinstance(input_data, dict):
        utr_candidates = [
            input_data.get('utr'), input_data.get('rrn'), input_data.get('ref'),
            input_data.get('ref_no'), input_data.get('refNo'), input_data.get('txn_id'),
            input_data.get('txnId'), input_data.get('transaction_id'), input_data.get('upi_ref'),
            input_data.get('upiref'), input_data.get('UTR'), input_data.get('RRN')
        ]
        for c in utr_candidates:
            if c:
                digits = _re.sub(r'\D', '', str(c))
                if 8 <= len(digits) <= 16:
                    utr = digits
                    break

        amt_candidates = [
            input_data.get('amount'), input_data.get('amt'), input_data.get('val'),
            input_data.get('value'), input_data.get('Amount')
        ]
        for a in amt_candidates:
            if a is not None and a != '':
                try:
                    clean = float(str(a).replace(',', ''))
                    if clean > 0:
                        amount = clean
                        break
                except ValueError:
                    pass

        sender = str(input_data.get('sender') or input_data.get('from') or input_data.get('app') or '')

        text_parts = [
            str(v) for k, v in input_data.items()
            if k in ('message', 'msg', 'text', 'sms', 'sms_message', 'notification', 'body', 'content', 'title', 'subText', 'not_text') and v
        ]
        if text_parts:
            raw_text = ' '.join(text_parts)
        elif not raw_text:
            raw_text = json.dumps(input_data)

    if not utr and raw_text:
        m1 = _re.search(r'(?:UPI\s*(?:Ref|txn|transaction)(?:\s*(?:no\.?|id))?|Ref\s*(?:no\.?|id)?|UTR(?:\s*no\.?)?|RRN|Txn\s*id|Ref\/|UPI\/)[^\w\d]*([0-9]{10,16})', raw_text, _re.I)
        if m1:
            utr = m1.group(1)
        else:
            m2 = _re.search(r'\b([0-9]{12})\b', raw_text)
            if m2:
                utr = m2.group(1)

    if not amount and raw_text:
        a1 = _re.search(r'(?:Rs\.?|INR|₹)\s*([0-9,]+(?:\.[0-9]{1,2})?)', raw_text, _re.I) or \
             _re.search(r'(?:credited|received|deposited|debited|paid|sent|withdrawn|transfer(?:red)?)\s*(?:by|with|for|of|to)?\s*(?:Rs\.?|INR|₹)?\s*([0-9,]+(?:\.[0-9]{1,2})?)', raw_text, _re.I)
        if a1:
            try:
                amount = float(a1.group(1).replace(',', ''))
            except ValueError:
                pass

    return utr, amount, sender, raw_text


@app.route('/api/webhook/macrodroid', methods=['GET', 'POST'])
@app.route('/api/webhook/macrodroi', methods=['GET', 'POST'])
def api_webhook_macrodroid():
    input_data = {}
    if request.args:
        input_data.update(request.args.to_dict())
    if request.method == 'POST':
        json_data = request.get_json(silent=True)
        if isinstance(json_data, dict):
            input_data.update(json_data)
        elif request.form:
            input_data.update(request.form.to_dict())
        else:
            raw_bytes = request.get_data()
            if raw_bytes:
                raw_str = raw_bytes.decode('utf-8', errors='ignore')
                try:
                    input_data.update(json.loads(raw_str))
                except Exception:
                    input_data['raw_body'] = raw_str

    secret = request.args.get('secret') or request.args.get('key') or request.headers.get('x-admin-key') or ''
    if isinstance(input_data, dict) and not secret:
        secret = input_data.get('secret') or input_data.get('admin_key') or input_data.get('key') or ''

    with get_db() as conn:
        c = conn.cursor()
        c.execute('SELECT value FROM settings WHERE key = "admin_password"')
        row = c.fetchone()
        expected_secret = row['value'] if row else 'spp213201pty'

    has_explicit_secret = (secret == expected_secret) or (request.headers.get('x-admin-key') == expected_secret)

    utr, amount, sender, raw_text = parse_macrodroid_message(input_data)
    now_iso = datetime.now().isoformat()

    # Check if MacroDroid's test button was clicked without UTR (sends placeholder [not_text])
    if not utr and raw_text and ('[not_text]' in raw_text):
        with get_db() as conn:
            c = conn.cursor()
            c.execute(
                'INSERT INTO macrodroid_logs (time, utr, amount, action, details, raw) VALUES (?, ?, ?, ?, ?, ?)',
                (now_iso, 'TEST_CONNECTED', 0, 'MACRODROID_CONNECTED', 'MacroDroid connected successfully! [not_text] test action received. When real bank notification arrives on phone, actual UTR & Amount will auto-credit.', raw_text[:200])
            )
            conn.commit()
        return jsonify({
            'success': True,
            'message': 'MacroDroid connected successfully! [not_text] test action received. Real bank notifications will auto-approve automatically.',
            'action': 'macrodroid_connected'
        })

    is_authorized = has_explicit_secret or bool(utr and len(utr) >= 10)

    with get_db() as conn:
        c = conn.cursor()
        if not is_authorized:
            c.execute(
                'INSERT INTO macrodroid_logs (time, utr, amount, action, details, raw) VALUES (?, ?, ?, ?, ?, ?)',
                (now_iso, utr or 'N/A', amount or 0, 'AUTH_FAILED', 'Invalid or missing secret key. Expected: spp213201pty', (raw_text or str(input_data))[:200])
            )
            conn.commit()
            return jsonify({
                'success': False,
                'message': 'Unauthorized: secret key required. Add {"secret": "spp213201pty"} in MacroDroid HTTP body or ?secret=spp213201pty'
            }), 401

        # Check for Bank Debit SMS / Payout Confirmation
        is_debit = bool(_re.search(r'\b(debited|debit|withdrawn|sent\s+to|paid\s+to|transfer\s+from)\b', raw_text, _re.I)) and not bool(_re.search(r'\b(credited|received|deposit)\b', raw_text, _re.I))
        if is_debit and amount and amount > 0:
            c.execute("SELECT * FROM transactions WHERE type = 'withdraw' AND (status = 'pending' OR status = 'Pending') ORDER BY created_at ASC")
            pending_wths = c.fetchall()
            matching_wth = None
            for pw in pending_wths:
                pw_amt = float(pw['amount'] or 0)
                pw_net = float(pw['net_amount'] or (pw_amt * 0.82)) if 'net_amount' in pw.keys() else (pw_amt * 0.82)
                if abs(pw_amt - amount) < 1 or abs(pw_net - amount) < 1:
                    matching_wth = pw
                    break
            if matching_wth:
                new_w_details = (matching_wth['details'] or '') + f" | Auto-verified via Bank Debit SMS (UTR: {utr or 'N/A'})"
                c.execute('UPDATE transactions SET status = "completed", details = ? WHERE id = ?', (new_w_details, matching_wth['id']))
                c.execute(
                    'INSERT INTO macrodroid_logs (time, utr, amount, action, user_id, details, raw) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    (now_iso, utr or 'DEBIT', float(matching_wth['amount']), 'WITHDRAW_AUTO_PAID', matching_wth['user_id'], f"Withdrawal {matching_wth['id']} for ₹{matching_wth['amount']} automatically marked Paid via Debit SMS!", raw_text[:200])
                )
                conn.commit()
                return jsonify({
                    'success': True,
                    'action': 'withdraw_auto_paid',
                    'tx_id': matching_wth['id'],
                    'amount': float(matching_wth['amount']),
                    'utr': utr or '',
                    'message': f"Withdrawal {matching_wth['id']} for ₹{matching_wth['amount']} auto-approved and marked paid via Bank Debit!"
                })
            else:
                c.execute(
                    'INSERT INTO macrodroid_logs (time, utr, amount, action, details, raw) VALUES (?, ?, ?, ?, ?, ?)',
                    (now_iso, utr or 'DEBIT', amount, 'DEBIT_NOT_MATCHED', f"Bank debited ₹{amount}, but no pending withdrawal of ₹{amount} was found in queue.", raw_text[:200])
                )
                conn.commit()
                return jsonify({
                    'success': True,
                    'action': 'debit_not_matched',
                    'amount': amount,
                    'message': f"Debit of ₹{amount} logged, but no matching pending withdrawal was found."
                })

        if not utr:
            c.execute(
                'INSERT INTO macrodroid_logs (time, utr, amount, action, details, raw) VALUES (?, ?, ?, ?, ?, ?)',
                (now_iso, 'NOT_FOUND', amount or 0, 'NO_UTR_DETECTED', 'Could not extract 10-16 digit UTR / Ref No from text.', (raw_text or str(input_data))[:200])
            )
            conn.commit()
            return jsonify({
                'success': False,
                'message': 'Webhook received but no valid UTR / Ref No detected in message.',
                'raw': raw_text
            })

        # 1. Check if already approved
        c.execute("SELECT id FROM transactions WHERE type = 'deposit' AND (status = 'approved' OR status = 'completed') AND details LIKE ?", (f"%{utr}%",))
        if c.fetchone():
            c.execute(
                'INSERT INTO macrodroid_logs (time, utr, amount, action, details, raw) VALUES (?, ?, ?, ?, ?, ?)',
                (now_iso, utr, amount or 0, 'ALREADY_PROCESSED', f'UTR {utr} was already approved earlier.', raw_text[:200])
            )
            conn.commit()
            return jsonify({
                'success': True,
                'message': f'UTR {utr} was already approved earlier.',
                'action': 'already_approved',
                'utr': utr
            })

        # 2. Check if there is an existing pending deposit by this UTR
        c.execute("SELECT * FROM transactions WHERE type = 'deposit' AND status = 'pending' AND details LIKE ? LIMIT 1", (f"%{utr}%",))
        pending_tx = c.fetchone()

        if pending_tx:
            credited_amt = float(pending_tx['amount']) if float(pending_tx['amount'] or 0) > 0 else amount
            new_details = (pending_tx['details'] or '') + ' | Auto-approved by MacroDroid Webhook'
            c.execute('UPDATE transactions SET status = "completed", details = ? WHERE id = ?', (new_details, pending_tx['id']))
            apply_user_wallet_delta(conn, pending_tx['user_id'], credited_amt, 'deposit')
            distribute_deposit_commissions(conn, pending_tx['user_id'], credited_amt)
            md_id = f"MD{int(time.time()*1000)}"
            c.execute(
                'INSERT INTO macrodroid_payments (id, utr, amount, sender, raw_message, status, matched_user_id, matched_tx_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                (md_id, utr, credited_amt, sender, raw_text, 'matched', pending_tx['user_id'], pending_tx['id'], now_iso)
            )
            c.execute(
                'INSERT INTO macrodroid_logs (time, utr, amount, action, user_id, details, raw) VALUES (?, ?, ?, ?, ?, ?, ?)',
                (now_iso, utr, credited_amt, 'AUTO_APPROVED', pending_tx['user_id'], f"Matched pending deposit {pending_tx['id']} for User #{pending_tx['user_id']}. ₹{credited_amt} credited!", raw_text[:200])
            )
            conn.commit()
            return jsonify({
                'success': True,
                'action': 'approved_pending',
                'tx_id': pending_tx['id'],
                'user_id': pending_tx['user_id'],
                'amount': credited_amt,
                'utr': utr,
                'message': f"Pending deposit {pending_tx['id']} approved automatically!"
            })

        # 3. Store as unclaimed for instant credit when player enters UTR
        c.execute('SELECT id FROM macrodroid_payments WHERE utr = ?', (utr,))
        if not c.fetchone():
            md_id = f"MD{int(time.time()*1000)}"
            c.execute(
                'INSERT INTO macrodroid_payments (id, utr, amount, sender, raw_message, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
                (md_id, utr, amount or 0, sender, raw_text, 'unclaimed', now_iso)
            )
        c.execute(
            'INSERT INTO macrodroid_logs (time, utr, amount, action, details, raw) VALUES (?, ?, ?, ?, ?, ?)',
            (now_iso, utr, amount or 0, 'STORED_FOR_INSTANT_CREDIT', f'Payment recorded in queue. When player enters UTR {utr}, ₹{amount or 0} will be credited instantly!', raw_text[:200])
        )
        conn.commit()
        return jsonify({
            'success': True,
            'action': 'stored_unclaimed',
            'utr': utr,
            'amount': amount,
            'message': f'Payment with UTR {utr} recorded! Will auto-credit player the moment they submit.'
        })


@app.route('/api/admin/macrodroid-logs', methods=['GET'])
def api_admin_macrodroid_logs():
    ok, _ = verify_admin(request)
    if not ok:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 403
    with get_db() as conn:
        c = conn.cursor()
        c.execute('SELECT * FROM macrodroid_logs ORDER BY id DESC LIMIT 50')
        logs = [dict(r) for r in c.fetchall()]
        c.execute('SELECT * FROM macrodroid_payments WHERE status = "unclaimed" ORDER BY created_at DESC LIMIT 30')
        unclaimed = [dict(r) for r in c.fetchall()]
    return jsonify({'success': True, 'logs': logs, 'unclaimed': unclaimed})


@app.route('/api/admin/macrodroid-test', methods=['POST'])
def api_admin_macrodroid_test():
    ok, _ = verify_admin(request)
    if not ok:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 403
    data = request.get_json(silent=True) or {}
    utr = data.get('utr') or '432109876543'
    amount = data.get('amount') or 500
    msg = data.get('message') or f"A/c *1234 credited with INR {amount}.00 on 18-Nov-26 by UPI Ref no {utr} -Bank of Baroda"
    p_utr, p_amt, p_snd, p_raw = parse_macrodroid_message(msg)
    return jsonify({
        'success': True,
        'test_message': msg,
        'parsed': {
            'utr': p_utr,
            'amount': p_amt,
            'sender': p_snd,
            'rawText': p_raw
        }
    })


# ========================================================
# GIFT CODE REDEMPTION & ADMIN GENERATOR APIS
# ========================================================

@app.route('/api/gift/redeem', methods=['POST'])
def api_gift_redeem():
    user = get_current_user(request)
    if not user:
        return jsonify({'success': False, 'message': 'Please login first to redeem gift codes.'}), 401
    data = request.get_json(silent=True) or {}
    code = str(data.get('code', '')).strip().upper()
    if not code:
        return jsonify({'success': False, 'message': 'Please enter a gift code.'}), 400

    with get_db() as conn:
        c = conn.cursor()
        c.execute('SELECT * FROM gift_codes WHERE UPPER(code) = ?', (code,))
        g = c.fetchone()
        if not g:
            return jsonify({'success': False, 'message': 'Invalid or expired gift code!'}), 404
        claimed = json.loads(g['claimed_by'] or '[]')
        if user['id'] in claimed:
            return jsonify({'success': False, 'message': 'You have already redeemed this gift code!'}), 400
        if len(claimed) >= (g['max_uses'] or 100):
            return jsonify({'success': False, 'message': 'This gift code has reached its maximum claim limit!'}), 400

        claimed.append(user['id'])
        amt = min(100.0, max(1.0, float(g['amount'])))
        c.execute('UPDATE gift_codes SET claimed_by = ? WHERE code = ?', (json.dumps(claimed), g['code']))
        apply_user_wallet_delta(conn, user['id'], amt, 'deposit')
        c.execute(
            'INSERT INTO transactions (id, user_id, type, amount, status, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            (f"GFT{int(time.time()*1000)}", user['id'], 'deposit', amt, 'approved', f"Gift Code: {g['code']}", datetime.now().isoformat())
        )
        conn.commit()
    return jsonify({'success': True, 'amount': amt, 'message': f"🎉 Gift code {g['code']} redeemed! ₹{amt:.2f} added to wallet."})

@app.route('/api/gift/history', methods=['GET'])
def api_gift_history():
    user = get_current_user(request)
    if not user:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 401
    with get_db() as conn:
        c = conn.cursor()
        c.execute("SELECT * FROM transactions WHERE user_id = ? AND id LIKE 'GFT%' ORDER BY created_at DESC LIMIT 30", (user['id'],))
        rows = [dict(r) for r in c.fetchall()]
    return jsonify({'success': True, 'history': rows})

@app.route('/api/admin/gifts', methods=['GET'])
def api_admin_gifts():
    ok, _ = verify_admin(request)
    if not ok:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 403
    with get_db() as conn:
        c = conn.cursor()
        c.execute('SELECT * FROM gift_codes ORDER BY created_at DESC')
        rows = []
        for r in c.fetchall():
            d = dict(r)
            d['claimed_by'] = json.loads(d.get('claimed_by') or '[]')
            rows.append(d)
    return jsonify({'success': True, 'gifts': rows})

@app.route('/api/admin/create-gift', methods=['POST'])
def api_admin_create_gift():
    ok, _ = verify_admin(request)
    if not ok:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 403
    data = request.get_json(silent=True) or {}
    code = str(data.get('code') or f"ASG{random.randint(10000,99999)}").strip().upper()
    amount = min(100.0, max(1.0, float(data.get('amount', 50))))
    max_uses = int(data.get('max_uses', 100))
    if not code or amount <= 0:
        return jsonify({'success': False, 'message': 'Valid gift code & amount required.'}), 400
    with get_db() as conn:
        c = conn.cursor()
        c.execute('SELECT code FROM gift_codes WHERE UPPER(code) = ?', (code,))
        if c.fetchone():
            return jsonify({'success': False, 'message': 'Gift code already exists!'}), 400
        c.execute(
            'INSERT INTO gift_codes (code, amount, max_uses, claimed_by, created_at) VALUES (?, ?, ?, ?, ?)',
            (code, amount, max_uses, '[]', datetime.now().isoformat())
        )
        conn.commit()
    return jsonify({'success': True, 'code': code, 'message': f'Gift code {code} (₹{amount}, {max_uses} uses) created!'})


# ========================================================
# FRIENDS BY UID & ONLINE 2P/4P LUDO MULTIPLAYER ROOMS
# ========================================================

LUDO_SAFE_TRACK = {0, 8, 13, 21, 26, 34, 39, 47}
LUDO_START_IDX = {'red': 39, 'green': 0, 'yellow': 13, 'blue': 26}

def _mask_phone_short(p):
    s = str(p or '')
    return s[:3] + '****' + s[-3:] if len(s) >= 6 else s

def _ludo_valid_tokens(tokens, roll):
    out = []
    for t in (tokens or []):
        prog = t.get('progress', -1)
        if prog >= 56:
            continue
        if prog == -1:
            if roll == 6:
                out.append(t)
        elif prog + roll <= 56:
            out.append(t)
    return out

def _ludo_finish_room(conn, room, winner_color):
    room['status'] = 'finished'
    room['phase'] = 'finished'
    room['winner_color'] = winner_color
    winner = next((p for p in room['players'] if p['color'] == winner_color), None)
    room['winner_uid'] = winner['uid'] if winner else None
    pot = int(float(room.get('entry_fee', 0)) * len(room['players']) * 0.92)
    room['prize'] = pot
    room['last_event'] = f"🏆 UID {room['winner_uid']} ({winner_color.upper()}) WON" + (f" ₹{pot}!" if pot > 0 else "!")
    if winner and pot > 0 and not room.get('paid_out'):
        room['paid_out'] = True
        c = conn.cursor()
        apply_user_wallet_delta(conn, winner['uid'], pot, 'win')
        c.execute(
            'INSERT INTO transactions (id, user_id, type, amount, status, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            (f"LDO{int(time.time()*1000)}", winner['uid'], 'win', pot, 'approved', f"Ludo Online Room #{room['code']} Win", datetime.now().isoformat())
        )
    room['updated_at'] = int(time.time() * 1000)

def _ludo_apply_move(conn, room, color, token_id, roll):
    tokens = room['tokens'].get(color, [])
    token = next((t for t in tokens if t['id'] == token_id), None)
    if not token:
        return False
    extra_turn = (roll == 6)
    if token['progress'] == -1 and roll == 6:
        token['progress'] = 0
        room['scores'][color] = room['scores'].get(color, 0) + 6
    else:
        token['progress'] += roll
        room['scores'][color] = room['scores'].get(color, 0) + roll

    mover = next((p for p in room['players'] if p['color'] == color), None)
    mover_name = f"UID {mover['uid']}" if mover else color.upper()

    if token['progress'] == 56:
        room['scores'][color] += 56
        extra_turn = True
        room['last_event'] = f"🎉 {mover_name} ({color.upper()}) reached HOME! +56 pts"
    elif 0 <= token['progress'] <= 50:
        t_idx = (LUDO_START_IDX[color] + token['progress']) % 52
        if t_idx not in LUDO_SAFE_TRACK:
            captured = False
            for opp in room['players']:
                if opp['color'] == color:
                    continue
                for ot in room['tokens'].get(opp['color'], []):
                    if 0 <= ot['progress'] <= 50:
                        o_idx = (LUDO_START_IDX[opp['color']] + ot['progress']) % 52
                        if o_idx == t_idx:
                            ot['progress'] = -1
                            extra_turn = True
                            captured = True
                            room['scores'][color] += 25
                            room['last_event'] = f"⚔️ {mover_name} captured {opp['color'].upper()}! +25 pts"
            if not captured:
                room['last_event'] = f"{mover_name} moved {roll} steps."
        else:
            room['last_event'] = f"{mover_name} landed on safe star ★"
    else:
        room['last_event'] = f"{mover_name} moved into Home Stretch!"

    if all(t['progress'] >= 56 for t in tokens):
        _ludo_finish_room(conn, room, color)
        return True

    if not extra_turn:
        next_idx = (room['turn_idx'] + 1) % len(room['players'])
        if next_idx == 0:
            room['turns_left'] = max(0, int(room.get('turns_left', 1)) - 1)
        room['turn_idx'] = next_idx

    if room['turns_left'] <= 0:
        ranked = sorted(room['players'], key=lambda p: room['scores'].get(p['color'], 0), reverse=True)
        _ludo_finish_room(conn, room, ranked[0]['color'])
        return True

    room['phase'] = 'roll'
    room['updated_at'] = int(time.time() * 1000)
    return True

@app.route('/api/friends/list', methods=['GET'])
def api_friends_list():
    user = get_current_user(request)
    if not user:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 401
    uid = user['id']
    friends, reqs, invites = [], [], []
    with get_db() as conn:
        c = conn.cursor()
        c.execute('SELECT * FROM friends WHERE from_uid = ? OR to_uid = ?', (uid, uid))
        for f in c.fetchall():
            if f['status'] == 'accepted':
                other_id = f['to_uid'] if f['from_uid'] == uid else f['from_uid']
                c.execute('SELECT id, phone FROM users WHERE id = ?', (other_id,))
                u = c.fetchone()
                if u:
                    friends.append({'uid': to_public_uid(u['id']), 'phone': _mask_phone_short(u['phone']), 'status': 'accepted'})
            elif f['status'] == 'pending' and f['to_uid'] == uid:
                c.execute('SELECT id, phone FROM users WHERE id = ?', (f['from_uid'],))
                u = c.fetchone()
                if u:
                    reqs.append({'uid': to_public_uid(u['id']), 'phone': _mask_phone_short(u['phone'])})
        cutoff = (time.time() - 1800) * 1000
        c.execute('SELECT state_json FROM ludo_rooms WHERE updated_at > ? ORDER BY updated_at DESC LIMIT 40', (cutoff,))
        for r in c.fetchall():
            rm = json.loads(r['state_json'])
            if rm.get('status') == 'waiting' and uid in (rm.get('invited_uids') or []) and not any(p['uid'] == uid for p in rm.get('players', [])):
                invites.append({
                    'room_code': rm['code'],
                    'host_uid': to_public_uid(rm['host_uid']),
                    'host_phone': rm['players'][0]['phone'] if rm.get('players') else '',
                    'max_players': rm['max_players'],
                    'joined_count': len(rm.get('players', [])),
                    'entry_fee': rm.get('entry_fee', 0)
                })
    return jsonify({'success': True, 'my_uid': to_public_uid(uid), 'friends': friends, 'requests': reqs, 'invites': invites})

@app.route('/api/friends/add', methods=['POST'])
def api_friends_add():
    user = get_current_user(request)
    if not user:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 401
    uid = user['id']
    data = request.get_json(silent=True) or {}
    raw_in = data.get('friend_uid', 0)
    with get_db() as conn:
        target_uid = resolve_user_id(conn, raw_in)
        if not target_uid:
            return jsonify({'success': False, 'message': f'User ID {raw_in} not found! Ask your friend for their 6-digit UID from Account tab.'})
        if target_uid == uid:
            return jsonify({'success': False, 'message': 'You cannot add your own UID as a friend.'})
        target_pub = to_public_uid(target_uid)
        c = conn.cursor()
        c.execute('SELECT * FROM friends WHERE (from_uid=? AND to_uid=?) OR (from_uid=? AND to_uid=?)', (uid, target_uid, target_uid, uid))
        ex = c.fetchone()
        if ex:
            if ex['status'] == 'accepted':
                return jsonify({'success': False, 'message': f'UID {target_pub} is already in your Friends list!'})
            if ex['from_uid'] == target_uid:
                c.execute('UPDATE friends SET status = "accepted" WHERE id = ?', (ex['id'],))
                conn.commit()
                return jsonify({'success': True, 'message': f'🎉 You and UID {target_pub} are now Friends!'})
            return jsonify({'success': False, 'message': f'Friend request already sent to UID {target_pub}.'})
        c.execute('INSERT INTO friends (from_uid, to_uid, status, created_at) VALUES (?, ?, "pending", ?)', (uid, target_uid, datetime.now().isoformat()))
        conn.commit()
    return jsonify({'success': True, 'message': f'Friend request sent to UID {target_pub}!'})

@app.route('/api/friends/respond', methods=['POST'])
def api_friends_respond():
    user = get_current_user(request)
    if not user:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 401
    uid = user['id']
    data = request.get_json(silent=True) or {}
    action = 'accept' if data.get('action') == 'accept' else 'reject'
    with get_db() as conn:
        from_uid = resolve_user_id(conn, data.get('friend_uid', 0)) or int(data.get('friend_uid', 0) or 0)
        from_pub = to_public_uid(from_uid)
        c = conn.cursor()
        c.execute('SELECT id FROM friends WHERE from_uid=? AND to_uid=? AND status="pending"', (from_uid, uid))
        row = c.fetchone()
        if not row:
            return jsonify({'success': False, 'message': 'Friend request not found.'})
        if action == 'accept':
            c.execute('UPDATE friends SET status="accepted" WHERE id=?', (row['id'],))
            msg = f'🎉 Accepted! UID {from_pub} is now your Friend.'
        else:
            c.execute('DELETE FROM friends WHERE id=?', (row['id'],))
            msg = 'Friend request declined.'
        conn.commit()
    return jsonify({'success': True, 'message': msg})

@app.route('/api/friends/chat/<int:friend_uid>', methods=['GET'])
def api_friends_chat_get(friend_uid):
    user = get_current_user(request)
    if not user:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 401
    me = user['id']
    with get_db() as conn:
        real_f = resolve_user_id(conn, friend_uid) or friend_uid
        pair_key = f"{min(me, real_f)}_{max(me, real_f)}"
        c = conn.cursor()
        c.execute('SELECT * FROM friend_messages WHERE pair_key = ? ORDER BY created_at ASC LIMIT 60', (pair_key,))
        rows = []
        for r in c.fetchall():
            d = dict(r)
            d['from_uid'] = to_public_uid(d['from_uid'])
            d['to_uid'] = to_public_uid(d['to_uid'])
            rows.append(d)
    return jsonify({'success': True, 'my_uid': to_public_uid(me), 'friend_uid': to_public_uid(real_f), 'messages': rows})

@app.route('/api/friends/chat/send', methods=['POST'])
def api_friends_chat_send():
    user = get_current_user(request)
    if not user:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 401
    me = user['id']
    data = request.get_json(silent=True) or {}
    text = str(data.get('message', '')).strip()[:500]
    room_code = str(data.get('room_code', '')).strip().upper()[:12]
    if not text:
        return jsonify({'success': False, 'message': 'Message required.'}), 400
    msg_id = f"FM{int(time.time()*1000)}{random.randint(10,99)}"
    with get_db() as conn:
        real_f = resolve_user_id(conn, data.get('friend_uid', 0)) or int(data.get('friend_uid', 0) or 0)
        if not real_f:
            return jsonify({'success': False, 'message': 'Friend UID required.'}), 400
        pair_key = f"{min(me, real_f)}_{max(me, real_f)}"
        c = conn.cursor()
        c.execute(
            'INSERT INTO friend_messages (id, pair_key, from_uid, to_uid, text, room_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            (msg_id, pair_key, me, real_f, text, room_code, datetime.now().isoformat())
        )
        conn.commit()
        c.execute('SELECT * FROM friend_messages WHERE pair_key = ? ORDER BY created_at ASC LIMIT 60', (pair_key,))
        rows = []
        for r in c.fetchall():
            d = dict(r)
            d['from_uid'] = to_public_uid(d['from_uid'])
            d['to_uid'] = to_public_uid(d['to_uid'])
            rows.append(d)
    return jsonify({'success': True, 'my_uid': to_public_uid(me), 'messages': rows})

@app.route('/api/ludo/room/create', methods=['POST'])
def api_ludo_room_create():
    user = get_current_user(request)
    if not user:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 401
    data = request.get_json(silent=True) or {}
    max_players = 2 if int(data.get('max_players', 4)) == 2 else 4
    entry_fee = max(0.0, float(data.get('entry_fee', 0) or 0))
    now_ms = int(time.time() * 1000)
    code = f"LD{random.randint(1000, 9999)}"
    with get_db() as conn:
        c = conn.cursor()
        c.execute('SELECT balance FROM users WHERE id=?', (user['id'],))
        cur_bal = float(c.fetchone()['balance'])
        if entry_fee > 0 and cur_bal < entry_fee:
            return jsonify({'success': False, 'message': f'Insufficient balance! Need ₹{entry_fee:.0f} to create this room.'})
        if entry_fee > 0:
            cur_bal, _, _ = apply_user_wallet_delta(conn, user['id'], -entry_fee, 'bet')
        room = {
            'code': code,
            'host_uid': user['id'],
            'max_players': max_players,
            'entry_fee': entry_fee,
            'status': 'waiting',
            'phase': 'waiting',
            'players': [{'uid': user['id'], 'phone': _mask_phone_short(user['phone']), 'color': 'red'}],
            'invited_uids': [],
            'tokens': {},
            'scores': {},
            'turn_idx': 0,
            'turns_left': 18 if max_players == 4 else 24,
            'dice': 6,
            'winner_color': None,
            'winner_uid': None,
            'prize': 0,
            'paid_out': False,
            'last_event': f'Room {code} created! Invite friends by UID or share code.',
            'created_at': now_ms,
            'updated_at': now_ms
        }
        c.execute('INSERT OR REPLACE INTO ludo_rooms (code, state_json, updated_at) VALUES (?, ?, ?)', (code, json.dumps(room), now_ms))
        conn.commit()
    return jsonify({'success': True, 'room': room, 'balance': cur_bal})

@app.route('/api/ludo/room/invite', methods=['POST'])
def api_ludo_room_invite():
    user = get_current_user(request)
    if not user:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 401
    data = request.get_json(silent=True) or {}
    code = str(data.get('room_code', '')).strip().upper()
    friend_uid = int(data.get('friend_uid', 0) or 0)
    with get_db() as conn:
        friend_uid = resolve_user_id(conn, data.get('friend_uid', 0)) or int(data.get('friend_uid', 0) or 0)
        c = conn.cursor()
        c.execute('SELECT state_json FROM ludo_rooms WHERE code=?', (code,))
        r = c.fetchone()
        if not r:
            return jsonify({'success': False, 'message': 'Room not found.'})
        room = json.loads(r['state_json'])
        if room.get('status') != 'waiting':
            return jsonify({'success': False, 'message': 'Room already started.'})
        if friend_uid not in room.setdefault('invited_uids', []):
            room['invited_uids'].append(friend_uid)
        room['updated_at'] = int(time.time() * 1000)
        c.execute('UPDATE ludo_rooms SET state_json=?, updated_at=? WHERE code=?', (json.dumps(room), room['updated_at'], code))
        conn.commit()
    return jsonify({'success': True, 'message': f'📩 Ludo invite sent to UID {to_public_uid(friend_uid)}!'})

@app.route('/api/ludo/room/join', methods=['POST'])
def api_ludo_room_join():
    user = get_current_user(request)
    if not user:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 401
    data = request.get_json(silent=True) or {}
    code = str(data.get('room_code', '')).strip().upper()
    with get_db() as conn:
        c = conn.cursor()
        c.execute('SELECT state_json FROM ludo_rooms WHERE code=?', (code,))
        r = c.fetchone()
        if not r:
            return jsonify({'success': False, 'message': f'Room {code} not found!'})
        room = json.loads(r['state_json'])
        c.execute('SELECT balance FROM users WHERE id=?', (user['id'],))
        cur_bal = float(c.fetchone()['balance'])
        if any(p['uid'] == user['id'] for p in room['players']):
            return jsonify({'success': True, 'room': room, 'balance': cur_bal})
        if room['status'] != 'waiting':
            return jsonify({'success': False, 'message': 'This Ludo match has already started!'})
        if len(room['players']) >= room['max_players']:
            return jsonify({'success': False, 'message': 'Room is already full!'})
        fee = float(room.get('entry_fee', 0))
        if fee > 0 and cur_bal < fee:
            return jsonify({'success': False, 'message': f'Need ₹{fee:.0f} balance to join this room!'})
        if fee > 0:
            cur_bal, _, _ = apply_user_wallet_delta(conn, user['id'], -fee, 'bet')
        palette = ['red', 'yellow'] if room['max_players'] == 2 else ['red', 'green', 'yellow', 'blue']
        color = palette[len(room['players'])]
        room['players'].append({'uid': user['id'], 'phone': _mask_phone_short(user['phone']), 'color': color})
        room['last_event'] = f"UID {user['id']} joined as {color.upper()}!"
        room['updated_at'] = int(time.time() * 1000)
        c.execute('UPDATE ludo_rooms SET state_json=?, updated_at=? WHERE code=?', (json.dumps(room), room['updated_at'], code))
        conn.commit()
    return jsonify({'success': True, 'room': room, 'balance': cur_bal})

@app.route('/api/ludo/room/start', methods=['POST'])
def api_ludo_room_start():
    user = get_current_user(request)
    if not user:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 401
    data = request.get_json(silent=True) or {}
    code = str(data.get('room_code', '')).strip().upper()
    with get_db() as conn:
        c = conn.cursor()
        c.execute('SELECT state_json FROM ludo_rooms WHERE code=?', (code,))
        r = c.fetchone()
        if not r:
            return jsonify({'success': False, 'message': 'Room not found.'})
        room = json.loads(r['state_json'])
        if room['host_uid'] != user['id']:
            return jsonify({'success': False, 'message': 'Only the Room Host can start the match.'})
        if len(room['players']) < 2:
            return jsonify({'success': False, 'message': 'Wait for at least 1 friend to join before starting!'})
        room['status'] = 'playing'
        room['phase'] = 'roll'
        room['turn_idx'] = 0
        room['tokens'] = {p['color']: [{'id': 0, 'progress': 0}, {'id': 1, 'progress': 0}, {'id': 2, 'progress': -1}, {'id': 3, 'progress': -1}] for p in room['players']}
        room['scores'] = {p['color']: 0 for p in room['players']}
        room['last_event'] = f"🎲 Match Started! UID {room['players'][0]['uid']} (RED) rolls first!"
        room['updated_at'] = int(time.time() * 1000)
        c.execute('UPDATE ludo_rooms SET state_json=?, updated_at=? WHERE code=?', (json.dumps(room), room['updated_at'], code))
        conn.commit()
    return jsonify({'success': True, 'room': room})

@app.route('/api/ludo/room/<code>', methods=['GET'])
def api_ludo_room_state(code):
    user = get_current_user(request)
    if not user:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 401
    code = str(code or '').strip().upper()
    with get_db() as conn:
        c = conn.cursor()
        c.execute('SELECT state_json FROM ludo_rooms WHERE code=?', (code,))
        r = c.fetchone()
        if not r:
            return jsonify({'success': False, 'message': 'Room not found.'})
        room = json.loads(r['state_json'])
    return jsonify({'success': True, 'room': room, 'my_uid': user['id']})

@app.route('/api/ludo/room/roll', methods=['POST'])
def api_ludo_room_roll():
    user = get_current_user(request)
    if not user:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 401
    data = request.get_json(silent=True) or {}
    code = str(data.get('room_code', '')).strip().upper()
    with get_db() as conn:
        c = conn.cursor()
        c.execute('SELECT state_json FROM ludo_rooms WHERE code=?', (code,))
        r = c.fetchone()
        if not r:
            return jsonify({'success': False, 'message': 'Active room not found.'})
        room = json.loads(r['state_json'])
        if room.get('status') != 'playing':
            return jsonify({'success': False, 'message': 'Match is not active.'})
        cur = room['players'][room['turn_idx']]
        if cur['uid'] != user['id']:
            return jsonify({'success': False, 'message': 'Not your turn!'})
        if room.get('phase') != 'roll':
            return jsonify({'success': False, 'message': 'Tap a glowing pawn to move first!'})
        roll = random.randint(1, 6)
        room['dice'] = roll
        valid = _ludo_valid_tokens(room['tokens'][cur['color']], roll)
        if not valid:
            room['last_event'] = f"UID {cur['uid']} rolled {roll} — No valid moves!"
            next_idx = (room['turn_idx'] + 1) % len(room['players'])
            if next_idx == 0:
                room['turns_left'] = max(0, int(room.get('turns_left', 1)) - 1)
            room['turn_idx'] = next_idx
            if room['turns_left'] <= 0:
                ranked = sorted(room['players'], key=lambda p: room['scores'].get(p['color'], 0), reverse=True)
                _ludo_finish_room(conn, room, ranked[0]['color'])
        elif len(valid) == 1:
            _ludo_apply_move(conn, room, cur['color'], valid[0]['id'], roll)
        else:
            room['phase'] = 'move'
            room['last_event'] = f"UID {cur['uid']} rolled {roll}! Tap a glowing {cur['color'].upper()} pawn."
        room['updated_at'] = int(time.time() * 1000)
        c.execute('UPDATE ludo_rooms SET state_json=?, updated_at=? WHERE code=?', (json.dumps(room), room['updated_at'], code))
        conn.commit()
    return jsonify({'success': True, 'room': room})

@app.route('/api/ludo/room/move', methods=['POST'])
def api_ludo_room_move():
    user = get_current_user(request)
    if not user:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 401
    data = request.get_json(silent=True) or {}
    code = str(data.get('room_code', '')).strip().upper()
    token_id = int(data.get('token_id', -1))
    with get_db() as conn:
        c = conn.cursor()
        c.execute('SELECT state_json FROM ludo_rooms WHERE code=?', (code,))
        r = c.fetchone()
        if not r:
            return jsonify({'success': False, 'message': 'Active room not found.'})
        room = json.loads(r['state_json'])
        if room.get('status') != 'playing':
            return jsonify({'success': False, 'message': 'Match is not active.'})
        cur = room['players'][room['turn_idx']]
        if cur['uid'] != user['id']:
            return jsonify({'success': False, 'message': 'Not your turn!'})
        if room.get('phase') != 'move':
            return jsonify({'success': False, 'message': 'Roll the dice first!'})
        valid = _ludo_valid_tokens(room['tokens'][cur['color']], room['dice'])
        if not any(t['id'] == token_id for t in valid):
            return jsonify({'success': False, 'message': 'Invalid pawn selected!'})
        _ludo_apply_move(conn, room, cur['color'], token_id, room['dice'])
        c.execute('UPDATE ludo_rooms SET state_json=?, updated_at=? WHERE code=?', (json.dumps(room), room['updated_at'], code))
        conn.commit()
    return jsonify({'success': True, 'room': room})


# ========================================================
# 24/7 VIP SUPPORT CHATBOT & LIVE ADMIN SUPPORT INBOX
# ========================================================

def _generate_support_bot_reply(msg_text):
    t = str(msg_text or '').lower()
    if any(k in t for k in ('deposit', 'recharge', 'utr', 'upi', 'pay')):
        return '💳 Deposit Help: Deposit page par amount select karke UPI QR/ID par pay karein aur 12-digit UTR submit karein. Admin 2–5 min me approve kar denge! Agar UTR already submit kar diya hai toh yahan apna UTR likh dein — Admin directly check kar lenge.'
    if any(k in t for k in ('withdraw', 'nikal', 'bank', 'payout')):
        return '💸 Withdrawal Help: Minimum withdrawal ₹110 hai (24/7 active). Withdraw page me apna Bank Card / UPI / USDT add karke request submit karein — Admin verify karke 1–24 hours me payout kar dete hain!'
    if any(k in t for k in ('gift', 'code', 'bonus')):
        return '🎁 Gift & Bonus Help: Account → 🎁 Gifts me welcome code "ASG50" daal kar ₹50 instant bonus paayein! Saath hi First Deposit par extra ₹10,000 tak bonus aur Invite Wheel par ₹500 tak jeet sakte hain.'
    if any(k in t for k in ('ludo', 'friend', 'uid')):
        return '🎲 Ludo Friends Help: Ludo Cash → "🌐 Friends UID" tab me apna UID share karein, dost ka UID daal kar "+ Add Friend" karein, aur 2P ya 4P Online Room bana kar saath khelein!'
    if any(k in t for k in ('otp', 'password', 'login', 'forgot')):
        return '🔐 Account & OTP Help: Login screen par "Forgot password" se apne registered Gmail par OTP mangwa kar password reset kar sakte hain. Kisi issue par Admin yahan aapki help karenge!'
    return '🤖 Namaste! Aapka message ASGames Admin Support team ko bhej diya gaya hai. Humare Admin jaldi hi yahin par aapko live reply karenge! (Quick help ke liye Deposit, Withdraw, Gift Code ya Ludo likhein)'

@app.route('/api/chat/messages', methods=['GET'])
def api_chat_messages():
    user = get_current_user(request)
    session_id = str(request.args.get('session_id', '')).strip()
    thread_id = f"u_{user['id']}" if user else (f"g_{session_id}" if session_id else '')
    if not thread_id:
        return jsonify({'success': True, 'messages': []})
    with get_db() as conn:
        c = conn.cursor()
        c.execute('SELECT * FROM support_messages WHERE thread_id = ? ORDER BY created_at ASC LIMIT 60', (thread_id,))
        rows = [dict(r) for r in c.fetchall()]
    return jsonify({'success': True, 'thread_id': thread_id, 'messages': rows})

@app.route('/api/chat/send', methods=['POST'])
def api_chat_send():
    user = get_current_user(request)
    data = request.get_json(silent=True) or {}
    session_id = str(data.get('session_id', '')).strip()
    text = str(data.get('message', '')).strip()[:600]
    if not text:
        return jsonify({'success': False, 'message': 'Message cannot be empty.'}), 400
    thread_id = f"u_{user['id']}" if user else f"g_{session_id or int(time.time()*1000)}"
    label = f"UID {user['id']} ({user['phone']})" if user else f"Guest ({session_id[-6:] if session_id else 'Web'})"
    now_iso = datetime.now().isoformat()
    with get_db() as conn:
        c = conn.cursor()
        c.execute(
            'INSERT INTO support_messages (id, thread_id, user_id, phone, label, sender, text, read_by_admin, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)',
            (f"MSG{int(time.time()*1000)}{random.randint(10,99)}", thread_id, user['id'] if user else None, user['phone'] if user else 'Guest', label, 'user', text, now_iso)
        )
        # Check if admin replied in last 60s
        c.execute('SELECT created_at FROM support_messages WHERE thread_id = ? AND sender = "admin" ORDER BY created_at DESC LIMIT 1', (thread_id,))
        last_adm = c.fetchone()
        admin_recent = False
        if last_adm:
            try:
                admin_recent = (datetime.now() - datetime.fromisoformat(last_adm['created_at'])).total_seconds() < 60
            except Exception:
                admin_recent = False
        if not admin_recent:
            bot_iso = datetime.now().isoformat()
            c.execute(
                'INSERT INTO support_messages (id, thread_id, user_id, phone, label, sender, text, read_by_admin, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)',
                (f"BOT{int(time.time()*1000)}{random.randint(10,99)}", thread_id, user['id'] if user else None, user['phone'] if user else 'Guest', label, 'bot', _generate_support_bot_reply(text), bot_iso)
            )
        conn.commit()
        c.execute('SELECT * FROM support_messages WHERE thread_id = ? ORDER BY created_at ASC LIMIT 60', (thread_id,))
        rows = [dict(r) for r in c.fetchall()]
    return jsonify({'success': True, 'thread_id': thread_id, 'messages': rows})

@app.route('/api/admin/chats', methods=['GET'])
def api_admin_chats():
    ok, _ = verify_admin(request)
    if not ok:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 403
    threads_map = {}
    with get_db() as conn:
        c = conn.cursor()
        c.execute('SELECT * FROM support_messages ORDER BY created_at ASC')
        for r in c.fetchall():
            m = dict(r)
            tid = m['thread_id']
            if tid not in threads_map:
                threads_map[tid] = {
                    'thread_id': tid,
                    'user_id': m['user_id'],
                    'phone': m['phone'] or 'Guest',
                    'label': m['label'] or tid,
                    'unread_count': 0,
                    'last_message': '',
                    'last_time': m['created_at'],
                    'messages': []
                }
            th = threads_map[tid]
            th['messages'].append(m)
            th['last_message'] = m['text']
            th['last_time'] = m['created_at']
            if m['sender'] == 'user' and not m['read_by_admin']:
                th['unread_count'] += 1
    threads = sorted(threads_map.values(), key=lambda x: str(x['last_time']), reverse=True)
    total_unread = sum(t['unread_count'] for t in threads)
    return jsonify({'success': True, 'total_unread': total_unread, 'threads': threads})

@app.route('/api/admin/chats/reply', methods=['POST'])
def api_admin_chats_reply():
    ok, _ = verify_admin(request)
    if not ok:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 403
    data = request.get_json(silent=True) or {}
    thread_id = str(data.get('thread_id', '')).strip()
    text = str(data.get('message', '')).strip()[:800]
    if not thread_id or not text:
        return jsonify({'success': False, 'message': 'Thread & reply message required.'}), 400
    with get_db() as conn:
        c = conn.cursor()
        c.execute('SELECT user_id, phone, label FROM support_messages WHERE thread_id = ? LIMIT 1', (thread_id,))
        meta = c.fetchone()
        c.execute('UPDATE support_messages SET read_by_admin = 1 WHERE thread_id = ?', (thread_id,))
        c.execute(
            'INSERT INTO support_messages (id, thread_id, user_id, phone, label, sender, text, read_by_admin, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)',
            (f"ADM{int(time.time()*1000)}{random.randint(10,99)}", thread_id, meta['user_id'] if meta else None, meta['phone'] if meta else 'Guest', meta['label'] if meta else thread_id, 'admin', text, datetime.now().isoformat())
        )
        conn.commit()
        c.execute('SELECT * FROM support_messages WHERE thread_id = ? ORDER BY created_at ASC LIMIT 80', (thread_id,))
        rows = [dict(r) for r in c.fetchall()]
    return jsonify({'success': True, 'message': 'Reply sent to player!', 'messages': rows})


# ========================================================
# UNIFIED PLAYER GAME HISTORY (ALL 5 GAMES)
# ========================================================

@app.route('/api/game/log-history', methods=['POST'])
def api_game_log_history():
    user = get_current_user(request)
    if not user:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 401
    data = request.get_json(silent=True) or {}
    rec_id = str(data.get('id') or f"GH{int(time.time()*1000)}{random.randint(10,99)}")
    game = str(data.get('game', 'Game'))[:40]
    detail = str(data.get('detail', ''))[:140]
    bet_amount = float(data.get('bet_amount', 0) or 0)
    win_amount = float(data.get('win_amount', 0) or 0)
    status = str(data.get('status', 'Pending'))
    created_at = str(data.get('created_at') or datetime.now().isoformat())
    with get_db() as conn:
        c = conn.cursor()
        c.execute('SELECT id FROM game_history WHERE id = ? AND user_id = ?', (rec_id, user['id']))
        if c.fetchone():
            c.execute('UPDATE game_history SET status = ?, win_amount = ?, detail = COALESCE(NULLIF(?, ""), detail) WHERE id = ? AND user_id = ?',
                      (status, win_amount, detail, rec_id, user['id']))
        else:
            c.execute('INSERT INTO game_history (id, user_id, game, detail, bet_amount, win_amount, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                      (rec_id, user['id'], game, detail, bet_amount, win_amount, status, created_at))
        conn.commit()
    return jsonify({'success': True})

@app.route('/api/game/my-history', methods=['GET'])
def api_game_my_history():
    user = get_current_user(request)
    if not user:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 401
    uid = int(user['id'])
    alt_uid = uid + 100000 if uid < 100000 else uid - 100000
    with get_db() as conn:
        c = conn.cursor()
        c.execute('SELECT * FROM game_history WHERE user_id IN (?, ?) ORDER BY created_at DESC LIMIT 80', (uid, alt_uid))
        unified = [dict(r) for r in c.fetchall()]
        seen = {str(h['id']) for h in unified}

        c.execute('SELECT * FROM bets WHERE user_id IN (?, ?) ORDER BY created_at DESC LIMIT 40', (uid, alt_uid))
        bets = [dict(r) for r in c.fetchall()]
        bets_map = {str(b['id']): b for b in bets}

        for h in unified:
            hid = str(h['id'])
            if str(h.get('status', '')).lower() == 'pending' and hid in bets_map:
                b = bets_map[hid]
                b_st = str(b.get('status') or '').lower()
                if b_st in ('won', 'lost'):
                    h['status'] = 'Won' if b_st == 'won' else 'Lost'
                    h['win_amount'] = float(b.get('win_amount') or 0)

        for b in bets:
            bid = str(b['id'])
            if bid not in seen:
                st = 'Won' if str(b['status']).lower() == 'won' else ('Lost' if str(b['status']).lower() == 'lost' else 'Pending')
                unified.append({
                    'id': b['id'],
                    'user_id': user['id'],
                    'game': 'Win Go',
                    'detail': f"#{b['period']} • {str(b['select_val']).upper()}",
                    'bet_amount': float(b['amount'] or 0),
                    'win_amount': float(b['win_amount'] or 0),
                    'status': st,
                    'created_at': b['created_at'] or ''
                })
    unified.sort(key=lambda x: str(x.get('created_at', '')), reverse=True)
    return jsonify({'success': True, 'history': unified[:80]})


# ========================================================
# AS KING / MATKA NUMBER GAME (FARIDABAD, GAZIABAD, GALI, DISAWAR + LOCAL AS GAMES)
# ========================================================

import re as _re
_LAST_KING_FETCH = 0.0

def _settle_king_market_bets(conn, market_key, num2):
    c = conn.cursor()
    num2 = str(num2).zfill(2)[-2:]
    andar_d, bahar_d = num2[0], num2[1]
    c.execute('SELECT * FROM king_bets WHERE market = ? AND status = "pending"', (market_key,))
    rows = c.fetchall()
    settled, total_pay = 0, 0.0
    for b in rows:
        bt = b['bet_type']
        num = str(b['number'])
        is_win, mult = False, 9
        if bt == 'andar':
            is_win = (num == andar_d)
            mult = 9
        elif bt == 'bahar':
            is_win = (num == bahar_d)
            mult = 9
        elif bt == 'jodi':
            is_win = (num.zfill(2) == num2)
            mult = 90
        settled += 1
        win_amt = round(float(b['amount']) * mult, 2) if is_win else 0.0
        st = 'won' if is_win else 'lost'
        c.execute('UPDATE king_bets SET status=?, win_amount=?, result_num=? WHERE id=?', (st, win_amt, num2, b['id']))
        c.execute('UPDATE game_history SET status=?, win_amount=?, detail=? WHERE id=? AND user_id=?',
                  ('Won' if is_win else 'Lost', win_amt, f"{market_key.upper()} • {bt.upper()} {num} (Result: {num2})", b['id'], b['user_id']))
        if is_win:
            total_pay += win_amt
            apply_user_wallet_delta(conn, b['user_id'], win_amt, 'win')
            c.execute('INSERT INTO transactions (id, user_id, type, amount, status, details, created_at) VALUES (?, ?, "win", ?, "approved", ?, ?)',
                      (f"KNG{int(time.time()*1000)}{random.randint(10,99)}", b['user_id'], win_amt, f"AS King ({market_key.upper()} #{num2}) Win", datetime.now().isoformat()))
    return settled, total_pay

def _fetch_king_net(force=False):
    global _LAST_KING_FETCH
    if not force and (time.time() - _LAST_KING_FETCH < 600):
        return False, []
    _LAST_KING_FETCH = time.time()
    updated = []
    for url in ('https://satta-king-fast.com/', 'https://sattaking-up.com/'):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=4) as resp:
                html = resp.read().decode('utf-8', errors='ignore')
            txt = _re.sub(r'<script[\s\S]*?</script>', ' ', html, flags=_re.I)
            txt = _re.sub(r'<style[\s\S]*?</style>', ' ', txt, flags=_re.I)
            txt = _re.sub(r'<[^>]+>', ' ', txt)
            txt = _re.sub(r'\s+', ' ', txt)
            pats = [
                ('faridabad', r'FARIDABAD[\s\S]{0,120}?(\b\d{2}\b)[\s\S]{0,40}?(\b\d{2}\b|--|XX)'),
                ('gaziabad',  r'GHA?ZIABAD[\s\S]{0,120}?(\b\d{2}\b)[\s\S]{0,40}?(\b\d{2}\b|--|XX)'),
                ('gali',      r'\bGALI\b[\s\S]{0,120}?(\b\d{2}\b)[\s\S]{0,40}?(\b\d{2}\b|--|XX)'),
                ('disawar',   r'D[EI]SAWAR[\s\S]{0,120}?(\b\d{2}\b)[\s\S]{0,40}?(\b\d{2}\b|--|XX)'),
            ]
            with get_db() as conn:
                c = conn.cursor()
                for key, pat in pats:
                    m = _re.search(pat, txt, flags=_re.I)
                    if m:
                        old_n, raw_new = m.group(1), m.group(2)
                        new_n = raw_new if _re.fullmatch(r'\d{2}', raw_new) else '--'
                        c.execute('SELECT new_num FROM king_markets WHERE key=?', (key,))
                        row = c.fetchone()
                        prev_new = row['new_num'] if row else '--'
                        c.execute('UPDATE king_markets SET old_num=?, new_num=?, updated_at=? WHERE key=?',
                                  (old_n, new_n, datetime.now().isoformat(), key))
                        updated.append(f"{key.upper()}:{old_n}->{new_n}")
                        if _re.fullmatch(r'\d{2}', new_n) and new_n != prev_new:
                            _settle_king_market_bets(conn, key, new_n)
                conn.commit()
            if updated:
                return True, updated
        except Exception:
            pass
    return False, updated

@app.route('/api/king/markets', methods=['GET'])
def api_king_markets():
    user = get_current_user(request)
    with get_db() as conn:
        c = conn.cursor()
        c.execute('SELECT * FROM king_markets')
        markets = [dict(r) for r in c.fetchall()]
        order = {'asgames': 0, 'faridabad': 1, 'gaziabad': 2, 'gali': 3, 'disawar': 4}
        markets.sort(key=lambda m: order.get(m['key'], 9))
        my_bets = []
        if user:
            c.execute('SELECT * FROM king_bets WHERE user_id = ? ORDER BY created_at DESC LIMIT 40', (user['id'],))
            my_bets = [dict(r) for r in c.fetchall()]
    return jsonify({'success': True, 'markets': markets, 'my_bets': my_bets})

@app.route('/api/king/bet', methods=['POST'])
def api_king_bet():
    user = get_current_user(request)
    if not user:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 401
    data = request.get_json(silent=True) or {}
    market = str(data.get('market', 'asgames')).lower().strip()
    bet_type = str(data.get('bet_type', 'bahar')).lower().strip()
    raw_num = str(data.get('number', '')).strip()
    amount = float(data.get('amount', 0) or 0)
    if market not in ('asgames', 'faridabad', 'gaziabad', 'gali', 'disawar'):
        return jsonify({'success': False, 'message': 'Invalid market.'}), 400
    if bet_type not in ('andar', 'bahar', 'jodi'):
        return jsonify({'success': False, 'message': 'Invalid bet type.'}), 400
    if amount < 10:
        return jsonify({'success': False, 'message': 'Minimum bet amount is ₹10.'}), 400
    clean_num = raw_num.zfill(2) if bet_type == 'jodi' else raw_num
    if bet_type == 'jodi' and not _re.fullmatch(r'\d{2}', clean_num):
        return jsonify({'success': False, 'message': 'Enter a valid 2-digit Jodi (00-99).'}), 400
    if bet_type in ('andar', 'bahar') and not _re.fullmatch(r'\d', clean_num):
        return jsonify({'success': False, 'message': 'Select a valid single digit (0-9).'}), 400
    mult = 90 if bet_type == 'jodi' else 9
    bet_id = f"KB{int(time.time()*1000)}{random.randint(10,99)}"
    now_iso = datetime.now().isoformat()
    with get_db() as conn:
        c = conn.cursor()
        c.execute('SELECT balance FROM users WHERE id=?', (user['id'],))
        cur_bal = float(c.fetchone()['balance'])
        if cur_bal < amount:
            return jsonify({'success': False, 'message': 'Insufficient balance! Please deposit.'}), 400
        new_bal, _, _ = apply_user_wallet_delta(conn, user['id'], -amount, 'bet')
        c.execute('''INSERT INTO king_bets (id, user_id, phone, market, bet_type, number, amount, multiplier, win_amount, result_num, status, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, "", "pending", ?)''',
                  (bet_id, user['id'], user['phone'], market, bet_type, clean_num, amount, mult, now_iso))
        c.execute('''INSERT INTO game_history (id, user_id, game, detail, bet_amount, win_amount, status, created_at)
                     VALUES (?, ?, "AS King", ?, ?, 0, "Pending", ?)''',
                  (bet_id, user['id'], f"{market.upper()} • {bet_type.upper()} {clean_num} ({mult}x)", amount, now_iso))
        c.execute('''INSERT INTO transactions (id, user_id, type, amount, status, details, created_at)
                     VALUES (?, ?, "bet", ?, "approved", ?, ?)''',
                  (bet_id, user['id'], amount, f"AS King • {market.upper()} ({bet_type.upper()} {clean_num})", now_iso))
        conn.commit()
    return jsonify({
        'success': True,
        'balance': new_bal,
        'message': f"🎯 Bet ₹{amount:.0f} placed on {market.upper()} ({bet_type.upper()} {clean_num}) — Win ₹{amount*mult:.0f}!"
    })

@app.route('/api/admin/king/declare', methods=['POST'])
def api_admin_king_declare():
    ok, _ = verify_admin(request)
    if not ok:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 403
    data = request.get_json(silent=True) or {}
    market = str(data.get('market', 'asgames')).lower().strip()
    raw = str(data.get('result_num', '')).strip()
    if market not in ('asgames', 'faridabad', 'gaziabad', 'gali', 'disawar') or not _re.fullmatch(r'\d{1,2}', raw):
        return jsonify({'success': False, 'message': 'Valid market & 2-digit number (00-99) required.'}), 400
    num2 = raw.zfill(2)
    with get_db() as conn:
        c = conn.cursor()
        c.execute('SELECT name, new_num FROM king_markets WHERE key=?', (market,))
        row = c.fetchone()
        prev_new = row['new_num'] if row else '--'
        if _re.fullmatch(r'\d{2}', str(prev_new)):
            c.execute('UPDATE king_markets SET old_num=?, new_num=?, updated_at=? WHERE key=?', (prev_new, num2, datetime.now().isoformat(), market))
        else:
            c.execute('UPDATE king_markets SET new_num=?, updated_at=? WHERE key=?', (num2, datetime.now().isoformat(), market))
        settled, total_pay = _settle_king_market_bets(conn, market, num2)
        conn.commit()
        c.execute('SELECT * FROM king_markets')
        markets = [dict(r) for r in c.fetchall()]
    return jsonify({'success': True, 'markets': markets, 'message': f"👑 {market.upper()} Result Declared: {num2}! Settled {settled} bets (Payout: ₹{total_pay:.2f})."})

@app.route('/api/admin/king/fetch-net', methods=['POST'])
def api_admin_king_fetch_net():
    ok, _ = verify_admin(request)
    if not ok:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 403
    fetched, upd = _fetch_king_net(True)
    with get_db() as conn:
        c = conn.cursor()
        c.execute('SELECT * FROM king_markets')
        markets = [dict(r) for r in c.fetchall()]
    return jsonify({
        'success': True,
        'fetched': fetched,
        'markets': markets,
        'message': f"🌐 Live Net Results Synced: {', '.join(upd)}" if fetched else 'Live net feed busy — showing latest cached results. You can also declare any number manually!'
    })


# ========================================================
# CENTRAL DATA SYNC APIS (Both Sites Save & Pull Data Here)
# ========================================================

@app.route('/api/sync/pull', methods=['GET'])
def api_sync_pull():
    """Returns entire persistent database so Render can restore everything instantly."""
    ok, _ = verify_admin(request)
    if not ok:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 403
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM users')
        users = [dict(r) for r in cursor.fetchall()]

        cursor.execute('SELECT * FROM game_rounds ORDER BY period DESC LIMIT 100')
        rounds = [dict(r) for r in cursor.fetchall()]

        cursor.execute('SELECT * FROM bets ORDER BY created_at DESC LIMIT 200')
        bets = [dict(r) for r in cursor.fetchall()]

        cursor.execute('SELECT * FROM transactions ORDER BY created_at DESC LIMIT 200')
        txs = [dict(r) for r in cursor.fetchall()]

        cursor.execute('SELECT * FROM settings')
        settings = {r['key']: r['value'] for r in cursor.fetchall()}

        cursor.execute('SELECT * FROM gift_codes ORDER BY created_at DESC')
        gifts = []
        for r in cursor.fetchall():
            d = dict(r)
            d['claimed_by'] = json.loads(d.get('claimed_by') or '[]')
            gifts.append(d)

        cursor.execute('SELECT * FROM game_history ORDER BY created_at DESC LIMIT 300')
        gh_rows = [dict(r) for r in cursor.fetchall()]

        cursor.execute('SELECT * FROM macrodroid_payments ORDER BY created_at DESC LIMIT 100')
        md_rows = [dict(r) for r in cursor.fetchall()]

        cursor.execute('SELECT * FROM commissions ORDER BY id DESC LIMIT 500')
        comm_rows = [dict(r) for r in cursor.fetchall()]

    return jsonify({
        'success': True,
        'users': users,
        'game_rounds': rounds,
        'bets': bets,
        'transactions': txs,
        'settings': settings,
        'gift_codes': gifts,
        'game_history': gh_rows,
        'macrodroid_payments': md_rows,
        'commissions': comm_rows
    })

@app.route('/api/sync/push', methods=['POST'])
def api_sync_push():
    """Receives data updates from Render and stores them permanently in SQLite on PythonAnywhere."""
    ok, _ = verify_admin(request)
    if not ok:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 403
    data = request.get_json(silent=True) or {}
    users = data.get('users', [])
    transactions = data.get('transactions', [])
    bets = data.get('bets', [])
    rounds = data.get('game_rounds', [])
    settings = data.get('settings', {})
    gift_codes = data.get('gift_codes', [])
    game_history_rows = data.get('game_history', [])
    macrodroid_payments_rows = data.get('macrodroid_payments', [])

    with get_db() as conn:
        cursor = conn.cursor()

        # Sync non-empty Gmail SMTP settings if configured on Render
        if isinstance(settings, dict):
            if settings.get('gmail_user'):
                cursor.execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ('gmail_user', str(settings['gmail_user']).strip()))
            if settings.get('gmail_app_password'):
                cursor.execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ('gmail_app_password', str(settings['gmail_app_password']).replace(' ', '')))
            if settings.get('email_webhook_url'):
                cursor.execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ('email_webhook_url', str(settings['email_webhook_url']).strip()))
            for pk in ('deposit_upi_id', 'deposit_upi_name', 'deposit_arpay_upi', 'deposit_usdt_address', 'deposit_usdt_bep20', 'deposit_usdt_polygon', 'deposit_usdt_arbitrum', 'deposit_usdt_erc20', 'deposit_usdt_solana', 'deposit_usdt_rate', 'deposit_qr_url'):
                if pk in settings and settings[pk] is not None:
                    cursor.execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', (pk, str(settings[pk]).strip()))

        # Ensure columns exist before upserting
        for col_sql in [
            'ALTER TABLE users ADD COLUMN deposit_balance REAL DEFAULT 0.0',
            'ALTER TABLE users ADD COLUMN winning_balance REAL DEFAULT 0.0',
            'ALTER TABLE transactions ADD COLUMN tds_amount REAL DEFAULT 0.0',
            'ALTER TABLE transactions ADD COLUMN net_amount REAL DEFAULT 0.0'
        ]:
            try:
                cursor.execute(col_sql)
            except Exception:
                pass

        # Upsert Users
        for u in users:
            phone = str(u.get('phone', '')).strip()
            if not phone:
                continue
            cursor.execute('SELECT id FROM users WHERE phone = ?', (phone,))
            existing = cursor.fetchone()
            try:
                if existing:
                    cursor.execute(
                        'UPDATE users SET email = COALESCE(NULLIF(?, ""), email), password = ?, balance = ?, deposit_balance = ?, winning_balance = ?, invite_code = ?, referred_by = ?, vip_level = ?, is_banned = ? WHERE phone = ?',
                        (u.get('email', ''), u.get('password'), u.get('balance', 0), u.get('deposit_balance', 0), u.get('winning_balance', 0), u.get('invite_code'), u.get('referred_by'), u.get('vip_level', 1), u.get('is_banned', 0), phone)
                    )
                else:
                    cursor.execute(
                        'INSERT INTO users (phone, email, email_verified, password, balance, deposit_balance, winning_balance, invite_code, referred_by, vip_level, is_banned, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                        (phone, u.get('email', ''), 1, u.get('password'), u.get('balance', 0), u.get('deposit_balance', 0), u.get('winning_balance', 0), u.get('invite_code'), u.get('referred_by'), u.get('vip_level', 1), u.get('is_banned', 0), u.get('created_at', datetime.now().isoformat()))
                    )
            except Exception:
                if existing:
                    cursor.execute(
                        'UPDATE users SET email = COALESCE(NULLIF(?, ""), email), password = ?, balance = ?, invite_code = ?, referred_by = ?, vip_level = ?, is_banned = ? WHERE phone = ?',
                        (u.get('email', ''), u.get('password'), u.get('balance', 0), u.get('invite_code'), u.get('referred_by'), u.get('vip_level', 1), u.get('is_banned', 0), phone)
                    )
                else:
                    cursor.execute(
                        'INSERT INTO users (phone, email, email_verified, password, balance, invite_code, referred_by, vip_level, is_banned, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                        (phone, u.get('email', ''), 1, u.get('password'), u.get('balance', 0), u.get('invite_code'), u.get('referred_by'), u.get('vip_level', 1), u.get('is_banned', 0), u.get('created_at', datetime.now().isoformat()))
                    )

        # Upsert Transactions
        for t in transactions:
            tx_id = t.get('id')
            if not tx_id:
                continue
            cursor.execute('SELECT id FROM transactions WHERE id = ?', (tx_id,))
            if cursor.fetchone():
                cursor.execute('UPDATE transactions SET status = ?, details = ?, tds_amount = ?, net_amount = ? WHERE id = ?', (t.get('status'), t.get('details'), t.get('tds_amount', 0), t.get('net_amount', 0), tx_id))
            else:
                cursor.execute(
                    'INSERT INTO transactions (id, user_id, type, amount, status, details, tds_amount, net_amount, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    (tx_id, t.get('user_id'), t.get('type'), t.get('amount'), t.get('status'), t.get('details'), t.get('tds_amount', 0), t.get('net_amount', 0), t.get('created_at', datetime.now().isoformat()))
                )

        # Upsert Bets
        for b in bets:
            b_id = b.get('id')
            if not b_id:
                continue
            cursor.execute('SELECT id FROM bets WHERE id = ?', (b_id,))
            if cursor.fetchone():
                cursor.execute('UPDATE bets SET status = ?, win_amount = ? WHERE id = ?', (b.get('status'), b.get('win_amount', 0), b_id))
            else:
                cursor.execute(
                    'INSERT INTO bets (id, user_id, period, select_type, select_val, amount, win_amount, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    (b_id, b.get('user_id'), b.get('period'), b.get('select_type'), b.get('select_val'), b.get('amount'), b.get('win_amount', 0), b.get('status'), b.get('created_at', datetime.now().isoformat()))
                )

        # Upsert Gift Codes
        for g in gift_codes:
            g_code = str(g.get('code', '')).strip().upper()
            if not g_code:
                continue
            remote_claimed = g.get('claimed_by', [])
            if isinstance(remote_claimed, str):
                try:
                    remote_claimed = json.loads(remote_claimed)
                except Exception:
                    remote_claimed = []
            cursor.execute('SELECT claimed_by FROM gift_codes WHERE UPPER(code) = ?', (g_code,))
            ex_g = cursor.fetchone()
            if ex_g:
                local_claimed = json.loads(ex_g['claimed_by'] or '[]')
                merged = list(dict.fromkeys(local_claimed + list(remote_claimed)))
                cursor.execute('UPDATE gift_codes SET claimed_by = ?, amount = ?, max_uses = ? WHERE UPPER(code) = ?',
                               (json.dumps(merged), float(g.get('amount', 50)), int(g.get('max_uses', 100)), g_code))
            else:
                cursor.execute(
                    'INSERT INTO gift_codes (code, amount, max_uses, claimed_by, created_at) VALUES (?, ?, ?, ?, ?)',
                    (g_code, float(g.get('amount', 50)), int(g.get('max_uses', 100)), json.dumps(list(remote_claimed)), g.get('created_at', datetime.now().isoformat()))
                )

        # Upsert Game History (All Games)
        for gh in game_history_rows:
            gh_id = str(gh.get('id', '')).strip()
            if not gh_id:
                continue
            cursor.execute('SELECT id FROM game_history WHERE id = ?', (gh_id,))
            if cursor.fetchone():
                cursor.execute(
                    'UPDATE game_history SET status = ?, win_amount = ?, detail = COALESCE(NULLIF(?, ""), detail) WHERE id = ?',
                    (gh.get('status', 'Pending'), float(gh.get('win_amount', 0) or 0), gh.get('detail', ''), gh_id)
                )
            else:
                cursor.execute(
                    'INSERT INTO game_history (id, user_id, game, detail, bet_amount, win_amount, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                    (gh_id, gh.get('user_id'), gh.get('game', 'Game'), gh.get('detail', ''), float(gh.get('bet_amount', 0) or 0), float(gh.get('win_amount', 0) or 0), gh.get('status', 'Pending'), gh.get('created_at', datetime.now().isoformat()))
                )

        # Upsert MacroDroid Payments
        for mp in macrodroid_payments_rows:
            mp_id = str(mp.get('id', '')).strip()
            mp_utr = str(mp.get('utr', '')).strip()
            if not mp_id or not mp_utr:
                continue
            cursor.execute('SELECT id FROM macrodroid_payments WHERE id = ? OR utr = ?', (mp_id, mp_utr))
            ex_mp = cursor.fetchone()
            if ex_mp:
                cursor.execute(
                    'UPDATE macrodroid_payments SET status = ?, matched_user_id = ?, matched_tx_id = ? WHERE id = ?',
                    (mp.get('status', 'unclaimed'), mp.get('matched_user_id'), mp.get('matched_tx_id'), ex_mp['id'])
                )
            else:
                cursor.execute(
                    'INSERT INTO macrodroid_payments (id, utr, amount, sender, raw_message, status, matched_user_id, matched_tx_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    (mp_id, mp_utr, float(mp.get('amount', 0) or 0), mp.get('sender', ''), mp.get('raw_message', ''), mp.get('status', 'unclaimed'), mp.get('matched_user_id'), mp.get('matched_tx_id'), mp.get('created_at', datetime.now().isoformat()))
                )

        # Upsert Commissions
        commissions_rows = data.get('commissions', [])
        for c_row in commissions_rows:
            c_id = c_row.get('id')
            if not c_id:
                continue
            cursor.execute('SELECT id FROM commissions WHERE id = ?', (c_id,))
            if cursor.fetchone():
                cursor.execute(
                    'UPDATE commissions SET claimed = ? WHERE id = ?',
                    (int(c_row.get('claimed', 0)), c_id)
                )
            else:
                cursor.execute(
                    'INSERT INTO commissions (id, user_id, downline_id, tier, bet_amount, commission, type, claimed, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    (c_id, c_row.get('user_id'), c_row.get('downline_id'), c_row.get('tier', 1), float(c_row.get('bet_amount', 0)), float(c_row.get('commission', 0)), c_row.get('type', 'deposit'), int(c_row.get('claimed', 0)), c_row.get('created_at', datetime.now().isoformat()))
                )

        conn.commit()

    return jsonify({
        'success': True,
        'message': f'PythonAnywhere saved {len(users)} users, {len(transactions)} transactions successfully!'
    })


# ========================================================
# STATIC SITE ROUTES (Serves Full Frontend on PythonAnywhere)
# ========================================================

@app.route('/')
def serve_index():
    return send_from_directory(BASE_DIR, 'index.html')

@app.route('/admin')
def serve_admin():
    return send_from_directory(BASE_DIR, 'admin.html')

@app.route('/<path:filename>')
def serve_static(filename):
    file_path = os.path.join(BASE_DIR, filename)
    if os.path.exists(file_path):
        return send_from_directory(BASE_DIR, filename)
    return jsonify({'error': 'Not found'}), 404


def start_wingo_daemon():
    def loop():
        time.sleep(2)
        while True:
            try:
                now_ts = time.time()
                for m in ['30s', '1m', '3m', '5m']:
                    cfg = WINGO_MODES[m]
                    if int(now_ts) % cfg['duration'] == 0:
                        prev = get_current_period_info(m, now_ts - cfg['duration'])
                        draw_round_if_needed(prev['period'], m)
            except Exception:
                pass
            time.sleep(1)

    t = threading.Thread(target=loop, daemon=True)
    t.start()

start_wingo_daemon()


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    print(f"ASGames Python Central Server running on http://127.0.0.1:{port}")
    app.run(host='0.0.0.0', port=port, debug=False)
