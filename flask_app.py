"""
ASGames - PythonAnywhere Flask Web Application & Central Database
Runs seamlessly on PythonAnywhere (www.pythonanywhere.com) and acts as the central
permanent database for both the PythonAnywhere site and Render!
"""

import os
import sys
import time
import json
import sqlite3
import random
import threading
from datetime import datetime
from flask import Flask, request, jsonify, send_from_directory

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

        # Default Settings
        defaults = {
            'admin_password': 'spp213201pty',
            'game_mode': 'random',
            'manual_number': '',
            'upi_id': 'asgames@upi',
            'upi_name': 'ASGames Official',
            'min_deposit': '100',
            'min_withdraw': '110'
        }
        for k, v in defaults.items():
            cursor.execute('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', (k, v))
            # Always ensure admin password matches spp213201pty
            if k == 'admin_password':
                cursor.execute('UPDATE settings SET value = ? WHERE key = ?', (v, k))

        # Auto-repair any legacy deposit/withdraw rows where amount slipped into type column
        cursor.execute("UPDATE transactions SET amount = CAST(type AS REAL), type = 'deposit', details = COALESCE(NULLIF(details, ''), 'UPI Deposit') WHERE id LIKE 'DEP%' AND type NOT IN ('deposit', 'withdraw', 'win', 'commission')")
        cursor.execute("UPDATE transactions SET amount = CAST(type AS REAL), type = 'withdraw', details = COALESCE(NULLIF(details, ''), 'Withdrawal Request') WHERE id LIKE 'WTH%' AND type NOT IN ('deposit', 'withdraw', 'win', 'commission')")
        conn.commit()

init_db()


# ========================================================
# GAME STATE & WIN-GO ENGINE
# ========================================================

def determine_color(num):
    if num == 0:
        return 'violet_red'
    elif num == 5:
        return 'violet_green'
    elif num in [1, 3, 7, 9]:
        return 'green'
    else:
        return 'red'

# Current period synchronized using wall-clock 30-second slots
def get_current_period_info():
    now = time.time()
    slot = int(now // 30)
    remaining = 30 - int(now % 30)
    is_locked = remaining <= 5
    # Base period format: YYYYMMDD + slot
    today_str = datetime.now().strftime('%Y%m%d')
    period = f"{today_str}{str(slot)[-5:]}"
    return period, remaining, is_locked

def draw_round_if_needed(period):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT period FROM game_rounds WHERE period = ?', (period,))
        if cursor.fetchone():
            return  # Already drawn

        # Check admin settings
        cursor.execute('SELECT value FROM settings WHERE key = ?', ('game_mode',))
        row = cursor.fetchone()
        mode = row['value'] if row else 'random'

        cursor.execute('SELECT value FROM settings WHERE key = ?', ('manual_number',))
        row = cursor.fetchone()
        manual_num = row['value'] if row else ''

        winning_num = random.randint(0, 9)
        if mode == 'manual' and manual_num != '':
            try:
                winning_num = int(manual_num)
            except:
                winning_num = random.randint(0, 9)

        color = determine_color(winning_num)
        premium_sum = random.randint(1000, 9999)
        now_iso = datetime.now().isoformat()

        cursor.execute(
            'INSERT INTO game_rounds (period, number, color, premium_sum, created_at) VALUES (?, ?, ?, ?, ?)',
            (period, winning_num, color, premium_sum, now_iso)
        )

        # Settle bets for this period
        cursor.execute('SELECT * FROM bets WHERE period = ? AND status = "pending"', (period,))
        bets = cursor.fetchall()
        for b in bets:
            b_id = b['id']
            u_id = b['user_id']
            stype = b['select_type']
            sval = str(b['select_val']).lower()
            amt = float(b['amount'])
            won = False
            win_amt = 0.0

            if stype == 'number' and str(winning_num) == sval:
                won = True
                win_amt = amt * 9.0
            elif stype == 'color':
                if sval == 'green' and color in ['green', 'violet_green']:
                    won = True
                    win_amt = amt * (1.5 if color == 'violet_green' else 2.0)
                elif sval == 'red' and color in ['red', 'violet_red']:
                    won = True
                    win_amt = amt * (1.5 if color == 'violet_red' else 2.0)
                elif sval == 'violet' and color in ['violet_red', 'violet_green']:
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
            if won and win_amt > 0:
                cursor.execute('UPDATE users SET balance = balance + ? WHERE id = ?', (win_amt, u_id))
                cursor.execute(
                    'INSERT INTO transactions (id, user_id, type, amount, status, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    (f"WIN_{int(time.time()*1000)}_{random.randint(100,999)}", u_id, 'win', win_amt, 'completed', f'Win Go Prize #{period}', now_iso)
                )
        conn.commit()


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
# USER AUTHENTICATION APIS
# ========================================================

@app.route('/api/auth/register', methods=['POST'])
def api_register():
    data = request.get_json(silent=True) or {}
    phone = str(data.get('phone', '')).strip()
    password = str(data.get('password', '')).strip()
    invite_code = str(data.get('invite_code', '')).strip()

    if not phone or len(phone) < 10 or not password:
        return jsonify({'success': False, 'message': 'Valid 10-digit mobile number and password required.'}), 400

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT id FROM users WHERE phone = ?', (phone,))
        if cursor.fetchone():
            return jsonify({'success': False, 'message': 'Mobile number already registered. Please login.'}), 400

        user_invite = f"ASG{random.randint(10000, 99999)}"
        created_at = datetime.now().isoformat()
        cursor.execute(
            'INSERT INTO users (phone, password, balance, invite_code, referred_by, vip_level, is_banned, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            (phone, password, 100.0, user_invite, invite_code, 1, 0, created_at)
        )
        user_id = cursor.lastrowid
        conn.commit()

    token = f"asg_user_{user_id}"
    return jsonify({
        'success': True,
        'message': 'Registration successful! ₹100 Welcome Bonus credited.',
        'token': token,
        'user': {'id': user_id, 'phone': phone, 'balance': 100.0, 'invite_code': user_invite}
    })

@app.route('/api/auth/login', methods=['POST'])
def api_login():
    data = request.get_json(silent=True) or {}
    phone = str(data.get('phone', '')).strip()
    password = str(data.get('password', '')).strip()

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM users WHERE phone = ?', (phone,))
        user = cursor.fetchone()
        if not user or user['password'] != password:
            return jsonify({'success': False, 'message': 'Invalid phone or password.'}), 400
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
                'balance': user['balance'],
                'invite_code': user['invite_code'],
                'vip_level': user['vip_level']
            }
        })

@app.route('/api/auth/me', methods=['GET'])
def api_me():
    user = get_current_user(request)
    if not user:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 401
    return jsonify({'success': True, 'user': user})

@app.route('/api/auth/forgot-password', methods=['POST'])
def api_forgot_password():
    data = request.get_json(silent=True) or {}
    phone = str(data.get('phone', '')).strip()
    new_pass = str(data.get('new_password', '')).strip()

    if not phone or len(phone) < 10 or not new_pass or len(new_pass) < 4:
        return jsonify({'success': False, 'message': 'Valid 10-digit mobile number and new password required.'}), 400

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT id FROM users WHERE phone = ?', (phone,))
        user = cursor.fetchone()
        if not user:
            return jsonify({'success': False, 'message': 'Mobile number not found! Please check or register.'}), 404

        cursor.execute('UPDATE users SET password = ? WHERE phone = ?', (new_pass, phone))
        conn.commit()

    return jsonify({'success': True, 'message': 'Password reset successfully! You can now log in.'})


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

    if not details and utr:
        details = f"Channel: {channel} | UTR: {utr}"
    elif not details:
        details = f"Channel: {channel} | UPI Deposit Request"

    if amount < 100:
        return jsonify({'success': False, 'message': 'Minimum deposit is ₹100'}), 400
    if utr and len(utr) < 6:
        return jsonify({'success': False, 'message': 'Please enter a valid 12-digit UTR / Transaction ID'}), 400

    tx_id = f"DEP{int(time.time()*1000)}"
    now_iso = datetime.now().isoformat()

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            'INSERT INTO transactions (id, user_id, type, amount, status, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            (tx_id, user['id'], 'deposit', amount, 'pending', details, now_iso)
        )
        conn.commit()

    return jsonify({'success': True, 'message': 'Deposit submitted! Balance will update after admin approval.', 'tx_id': tx_id})

@app.route('/api/wallet/withdraw', methods=['POST'])
def api_withdraw():
    user = get_current_user(request)
    if not user:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 401

    data = request.get_json(silent=True) or {}
    amount = float(data.get('amount', 0))
    details = str(data.get('bank_info') or data.get('details') or 'Bank / UPI Withdrawal').strip()

    if amount < 110:
        return jsonify({'success': False, 'message': 'Minimum withdrawal is ₹110'}), 400

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT balance FROM users WHERE id = ?', (user['id'],))
        row = cursor.fetchone()
        current_bal = float(row['balance']) if row else 0.0

        if current_bal < amount:
            return jsonify({'success': False, 'message': f'Insufficient balance! You have ₹{current_bal:.2f}'}), 400

        # Deduct balance immediately upon request
        cursor.execute('UPDATE users SET balance = balance - ? WHERE id = ?', (amount, user['id']))
        tx_id = f"WTH{int(time.time()*1000)}"
        now_iso = datetime.now().isoformat()
        cursor.execute(
            'INSERT INTO transactions (id, user_id, type, amount, status, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            (tx_id, user['id'], 'withdraw', amount, 'pending', details, now_iso)
        )
        conn.commit()

    return jsonify({'success': True, 'message': 'Withdrawal submitted! Admin will approve & payout.', 'tx_id': tx_id})

@app.route('/api/wallet/transactions', methods=['GET'])
def api_my_transactions():
    user = get_current_user(request)
    if not user:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 401

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', (user['id'],))
        rows = [dict(r) for r in cursor.fetchall()]

    return jsonify({'success': True, 'transactions': rows})

@app.route('/api/referral/stats', methods=['GET'])
def api_referral_stats():
    user = get_current_user(request)
    if not user:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 401
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT id, phone, created_at FROM users WHERE referred_by = ?', (user['invite_code'],))
        subordinates = [dict(r) for r in cursor.fetchall()]
    return jsonify({
        'success': True,
        'invite_code': user['invite_code'],
        'total_subordinates': len(subordinates),
        'unclaimed_commission': 0.0,
        'total_commission': 0.0,
        'subordinates': subordinates
    })

@app.route('/api/referral/claim', methods=['POST'])
def api_referral_claim():
    user = get_current_user(request)
    if not user:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 401
    return jsonify({'success': False, 'message': 'No commission available to claim yet.'})


# ========================================================
# GAME APIS (Win-Go 1Min / 30s)
# ========================================================

@app.route('/api/game/current', methods=['GET'])
def api_game_current():
    period, remaining, is_locked = get_current_period_info()
    return jsonify({
        'success': True,
        'currentPeriod': period,
        'remainingSeconds': remaining,
        'isLocked': is_locked
    })

@app.route('/api/game/bet', methods=['POST'])
def api_game_bet():
    user = get_current_user(request)
    if not user:
        return jsonify({'success': False, 'message': 'Please login to place bets'}), 401

    period, remaining, is_locked = get_current_period_info()
    if is_locked or remaining <= 5:
        return jsonify({'success': False, 'message': 'Round is locked! Please wait for next round.'}), 400

    data = request.get_json(silent=True) or {}
    select_type = data.get('select_type')
    select_val = str(data.get('select_val', ''))
    amount = float(data.get('amount', 0))

    if amount < 1:
        return jsonify({'success': False, 'message': 'Minimum bet is ₹1'}), 400

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT balance FROM users WHERE id = ?', (user['id'],))
        row = cursor.fetchone()
        balance = float(row['balance']) if row else 0.0

        if balance < amount:
            return jsonify({'success': False, 'message': 'Insufficient balance! Please deposit.'}), 400

        cursor.execute('UPDATE users SET balance = balance - ? WHERE id = ?', (amount, user['id']))
        bet_id = f"BET_{int(time.time()*1000)}_{random.randint(100, 999)}"
        now_iso = datetime.now().isoformat()
        cursor.execute(
            'INSERT INTO bets (id, user_id, period, select_type, select_val, amount, win_amount, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            (bet_id, user['id'], period, select_type, select_val, amount, 0.0, 'pending', now_iso)
        )
        conn.commit()

    return jsonify({'success': True, 'message': 'Bet placed successfully!', 'new_balance': balance - amount})

@app.route('/api/game/history', methods=['GET'])
def api_game_history():
    period, _, _ = get_current_period_info()
    draw_round_if_needed(str(int(period) - 1))

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM game_rounds ORDER BY period DESC LIMIT 50')
        rows = [dict(r) for r in cursor.fetchall()]

    return jsonify({'success': True, 'history': rows})

@app.route('/api/game/my-bets', methods=['GET'])
def api_game_my_bets():
    user = get_current_user(request)
    if not user:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 401

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM bets WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', (user['id'],))
        rows = [dict(r) for r in cursor.fetchall()]

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

    period, remaining, is_locked = get_current_period_info()

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

        # Wagers on current period
        cursor.execute('SELECT select_val, SUM(amount) as amt FROM bets WHERE period = ? GROUP BY select_val', (period,))
        wager_rows = cursor.fetchall()
        wagers = {r['select_val']: r['amt'] for r in wager_rows}

    return jsonify({
        'success': True,
        'currentPeriod': period,
        'remainingSeconds': remaining,
        'isLocked': is_locked,
        'gameMode': all_sets.get('game_mode', 'random'),
        'manualNumber': all_sets.get('manual_number', ''),
        'aviatorMode': all_sets.get('aviator_mode', 'random'),
        'aviatorCrash': all_sets.get('aviator_crash', '2.00'),
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
        },
        'wagers': wagers
    })

@app.route('/api/game/all-rigging', methods=['GET'])
def api_game_all_rigging():
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT key, value FROM settings')
        s = {r['key']: r['value'] for r in cursor.fetchall()}
    return jsonify({
        'success': True,
        'aviator_mode': s.get('aviator_mode', 'random'),
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
    mapping = {
        'mode': 'game_mode',
        'manual_number': 'manual_number',
        'aviator_mode': 'aviator_mode',
        'aviator_crash': 'aviator_crash',
        'aviator_force_ts': 'aviator_force_ts',
        'mines_mode': 'mines_mode',
        'mines_max_safe': 'mines_max_safe',
        'k3_mode': 'k3_mode',
        'k3_dice': 'k3_dice',
        'ludo_mode': 'ludo_mode'
    }

    with get_db() as conn:
        cursor = conn.cursor()
        for body_key, db_key in mapping.items():
            if body_key in data and data[body_key] is not None:
                cursor.execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', (db_key, str(data[body_key])))
        conn.commit()

    return jsonify({'success': True, 'message': 'All Game Controls updated successfully!'})

@app.route('/api/admin/users', methods=['GET'])
def api_admin_users():
    ok, _ = verify_admin(request)
    if not ok:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 403

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT id, phone, password, balance, invite_code, referred_by, vip_level, is_banned, created_at FROM users ORDER BY id DESC LIMIT 100')
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
        cursor = conn.cursor()
        cursor.execute('UPDATE users SET balance = balance + ? WHERE id = ?', (amt, u_id))
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
            SELECT t.*, u.phone 
            FROM transactions t 
            JOIN users u ON t.user_id = u.id 
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
        cursor.execute('UPDATE users SET balance = balance + ? WHERE id = ?', (amt, u_id))
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
            SELECT t.*, u.phone 
            FROM transactions t 
            JOIN users u ON t.user_id = u.id 
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

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM transactions WHERE id = ? AND status = "pending"', (tx_id,))
        tx = cursor.fetchone()
        if not tx:
            return jsonify({'success': False, 'message': 'Transaction not found or already processed'}), 404

        amt = float(tx['amount'])
        u_id = tx['user_id']
        # Refund back to user balance
        cursor.execute('UPDATE users SET balance = balance + ? WHERE id = ?', (amt, u_id))
        cursor.execute('UPDATE transactions SET status = "rejected" WHERE id = ?', (tx_id,))
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
            SELECT t.*, u.phone 
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


# ========================================================
# CENTRAL DATA SYNC APIS (Both Sites Save & Pull Data Here)
# ========================================================

@app.route('/api/sync/pull', methods=['GET'])
def api_sync_pull():
    """Returns entire persistent database so Render can restore everything instantly."""
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

    return jsonify({
        'success': True,
        'users': users,
        'game_rounds': rounds,
        'bets': bets,
        'transactions': txs,
        'settings': settings
    })

@app.route('/api/sync/push', methods=['POST'])
def api_sync_push():
    """Receives data updates from Render and stores them permanently in SQLite on PythonAnywhere."""
    data = request.get_json(silent=True) or {}
    users = data.get('users', [])
    transactions = data.get('transactions', [])
    bets = data.get('bets', [])
    rounds = data.get('game_rounds', [])
    settings = data.get('settings', {})

    with get_db() as conn:
        cursor = conn.cursor()

        # Upsert Users
        for u in users:
            phone = str(u.get('phone', '')).strip()
            if not phone:
                continue
            cursor.execute('SELECT id FROM users WHERE phone = ?', (phone,))
            existing = cursor.fetchone()
            if existing:
                cursor.execute(
                    'UPDATE users SET password = ?, balance = ?, invite_code = ?, referred_by = ?, vip_level = ?, is_banned = ? WHERE phone = ?',
                    (u.get('password'), u.get('balance', 0), u.get('invite_code'), u.get('referred_by'), u.get('vip_level', 1), u.get('is_banned', 0), phone)
                )
            else:
                cursor.execute(
                    'INSERT INTO users (phone, password, balance, invite_code, referred_by, vip_level, is_banned, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                    (phone, u.get('password'), u.get('balance', 0), u.get('invite_code'), u.get('referred_by'), u.get('vip_level', 1), u.get('is_banned', 0), u.get('created_at', datetime.now().isoformat()))
                )

        # Upsert Transactions
        for t in transactions:
            tx_id = t.get('id')
            if not tx_id:
                continue
            cursor.execute('SELECT id FROM transactions WHERE id = ?', (tx_id,))
            if cursor.fetchone():
                cursor.execute('UPDATE transactions SET status = ?, details = ? WHERE id = ?', (t.get('status'), t.get('details'), tx_id))
            else:
                cursor.execute(
                    'INSERT INTO transactions (id, user_id, type, amount, status, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    (tx_id, t.get('user_id'), t.get('type'), t.get('amount'), t.get('status'), t.get('details'), t.get('created_at', datetime.now().isoformat()))
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


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    print(f"ASGames Python Central Server running on http://127.0.0.1:{port}")
    app.run(host='0.0.0.0', port=port, debug=False)
