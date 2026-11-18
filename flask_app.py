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
import smtplib
import threading
from email.mime.text import MIMEText
from datetime import datetime
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
        cursor.execute(
            'INSERT OR IGNORE INTO gift_codes (code, amount, max_uses, claimed_by, created_at) VALUES (?, ?, ?, ?, ?)',
            ('ASG50', 50.0, 100, '[]', datetime.now().isoformat())
        )

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
            CREATE TABLE IF NOT EXISTS ludo_rooms (
                code TEXT PRIMARY KEY,
                state_json TEXT NOT NULL,
                updated_at REAL DEFAULT 0
            )
        ''')
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
    phone = str(data.get('phone', '')).strip()
    email = str(data.get('email', '')).strip().lower()
    otp = str(data.get('otp', '')).strip()
    password = str(data.get('password', '')).strip()
    invite_code = str(data.get('invite_code', '')).strip()

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
        cursor.execute(
            'INSERT INTO users (phone, email, email_verified, password, balance, invite_code, referred_by, vip_level, is_banned, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            (phone, email, 1, password, 100.0, user_invite, invite_code, 1, 0, created_at)
        )
        user_id = cursor.lastrowid
        conn.commit()

    token = f"asg_user_{user_id}"
    return jsonify({
        'success': True,
        'message': 'Gmail verified & Registration successful! ₹100 Welcome Bonus credited.',
        'token': token,
        'user': {'id': user_id, 'phone': phone, 'email': email, 'balance': 100.0, 'invite_code': user_invite}
    })

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
        cursor.execute('UPDATE users SET balance = MAX(0, balance - ?) WHERE id = ?', (amount, user['id']))
        tx_id = f"WTH{int(time.time()*1000)}"
        now_iso = datetime.now().isoformat()
        cursor.execute(
            'INSERT INTO transactions (id, user_id, type, amount, status, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            (tx_id, user['id'], 'withdraw', amount, 'pending', details, now_iso)
        )
        cursor.execute('SELECT balance FROM users WHERE id = ?', (user['id'],))
        new_row = cursor.fetchone()
        new_bal = round(float(new_row['balance']), 2) if new_row else 0.0
        conn.commit()

    return jsonify({'success': True, 'balance': new_bal, 'message': 'Withdrawal submitted! Admin will approve & payout.', 'tx_id': tx_id})

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
        cursor = conn.cursor()
        cursor.execute('UPDATE users SET balance = MAX(0, balance + ?) WHERE id = ?', (delta, user['id']))
        cursor.execute('SELECT balance FROM users WHERE id = ?', (user['id'],))
        row = cursor.fetchone()
        conn.commit()
        new_bal = float(row['balance']) if row else user['balance']

    return jsonify({'success': True, 'balance': new_bal})

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
        new_bal = round(max(0.0, balance - amount), 2)
        conn.commit()

    return jsonify({'success': True, 'message': 'Bet placed successfully!', 'balance': new_bal, 'newBalance': new_bal, 'new_balance': new_bal})

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
        c.execute('SELECT key, value FROM settings WHERE key IN ("deposit_upi_id", "deposit_upi_name", "deposit_arpay_upi", "deposit_usdt_address", "deposit_qr_url")')
        s = {r['key']: r['value'] for r in c.fetchall()}
    upi_id = s.get('deposit_upi_id') or 'asgames@upi'
    return jsonify({
        'success': True,
        'upi_id': upi_id,
        'upi_name': s.get('deposit_upi_name') or 'ASGames',
        'arpay_upi': s.get('deposit_arpay_upi') or upi_id,
        'usdt_address': s.get('deposit_usdt_address') or 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
        'qr_url': s.get('deposit_qr_url') or ''
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
    usdt_address = str(data.get('usdt_address', '')).strip()
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
            ('deposit_qr_url', qr_url),
        ]:
            c.execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', (k, v))
        conn.commit()
    return jsonify({'success': True, 'message': 'Payment details updated! All players will now see your new UPI/QR/USDT details.'})


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
        amt = float(g['amount'])
        c.execute('UPDATE gift_codes SET claimed_by = ? WHERE code = ?', (json.dumps(claimed), g['code']))
        c.execute('UPDATE users SET balance = balance + ? WHERE id = ?', (amt, user['id']))
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
    amount = float(data.get('amount', 50))
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
        c.execute('UPDATE users SET balance = balance + ? WHERE id = ?', (pot, winner['uid']))
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
                    friends.append({'uid': u['id'], 'phone': _mask_phone_short(u['phone']), 'status': 'accepted'})
            elif f['status'] == 'pending' and f['to_uid'] == uid:
                c.execute('SELECT id, phone FROM users WHERE id = ?', (f['from_uid'],))
                u = c.fetchone()
                if u:
                    reqs.append({'uid': u['id'], 'phone': _mask_phone_short(u['phone'])})
        cutoff = (time.time() - 1800) * 1000
        c.execute('SELECT state_json FROM ludo_rooms WHERE updated_at > ? ORDER BY updated_at DESC LIMIT 40', (cutoff,))
        for r in c.fetchall():
            rm = json.loads(r['state_json'])
            if rm.get('status') == 'waiting' and uid in (rm.get('invited_uids') or []) and not any(p['uid'] == uid for p in rm.get('players', [])):
                invites.append({
                    'room_code': rm['code'],
                    'host_uid': rm['host_uid'],
                    'host_phone': rm['players'][0]['phone'] if rm.get('players') else '',
                    'max_players': rm['max_players'],
                    'joined_count': len(rm.get('players', [])),
                    'entry_fee': rm.get('entry_fee', 0)
                })
    return jsonify({'success': True, 'my_uid': uid, 'friends': friends, 'requests': reqs, 'invites': invites})

@app.route('/api/friends/add', methods=['POST'])
def api_friends_add():
    user = get_current_user(request)
    if not user:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 401
    uid = user['id']
    data = request.get_json(silent=True) or {}
    try:
        target_uid = int(data.get('friend_uid', 0))
    except Exception:
        target_uid = 0
    if not target_uid or target_uid == uid:
        return jsonify({'success': False, 'message': 'Please enter a valid friend User ID (UID) other than your own.'})
    with get_db() as conn:
        c = conn.cursor()
        c.execute('SELECT id FROM users WHERE id = ?', (target_uid,))
        if not c.fetchone():
            return jsonify({'success': False, 'message': f'User ID {target_uid} not found! Ask your friend for their UID from Account tab.'})
        c.execute('SELECT * FROM friends WHERE (from_uid=? AND to_uid=?) OR (from_uid=? AND to_uid=?)', (uid, target_uid, target_uid, uid))
        ex = c.fetchone()
        if ex:
            if ex['status'] == 'accepted':
                return jsonify({'success': False, 'message': f'UID {target_uid} is already in your Friends list!'})
            if ex['from_uid'] == target_uid:
                c.execute('UPDATE friends SET status = "accepted" WHERE id = ?', (ex['id'],))
                conn.commit()
                return jsonify({'success': True, 'message': f'🎉 You and UID {target_uid} are now Friends!'})
            return jsonify({'success': False, 'message': f'Friend request already sent to UID {target_uid}.'})
        c.execute('INSERT INTO friends (from_uid, to_uid, status, created_at) VALUES (?, ?, "pending", ?)', (uid, target_uid, datetime.now().isoformat()))
        conn.commit()
    return jsonify({'success': True, 'message': f'Friend request sent to UID {target_uid}!'})

@app.route('/api/friends/respond', methods=['POST'])
def api_friends_respond():
    user = get_current_user(request)
    if not user:
        return jsonify({'success': False, 'message': 'Unauthorized'}), 401
    uid = user['id']
    data = request.get_json(silent=True) or {}
    from_uid = int(data.get('friend_uid', 0) or 0)
    action = 'accept' if data.get('action') == 'accept' else 'reject'
    with get_db() as conn:
        c = conn.cursor()
        c.execute('SELECT id FROM friends WHERE from_uid=? AND to_uid=? AND status="pending"', (from_uid, uid))
        row = c.fetchone()
        if not row:
            return jsonify({'success': False, 'message': 'Friend request not found.'})
        if action == 'accept':
            c.execute('UPDATE friends SET status="accepted" WHERE id=?', (row['id'],))
            msg = f'🎉 Accepted! UID {from_uid} is now your Friend.'
        else:
            c.execute('DELETE FROM friends WHERE id=?', (row['id'],))
            msg = 'Friend request declined.'
        conn.commit()
    return jsonify({'success': True, 'message': msg})

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
            c.execute('UPDATE users SET balance = MAX(0, balance - ?) WHERE id=?', (entry_fee, user['id']))
            cur_bal = round(max(0.0, cur_bal - entry_fee), 2)
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
    return jsonify({'success': True, 'message': f'📩 Ludo invite sent to UID {friend_uid}!'})

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
            c.execute('UPDATE users SET balance = MAX(0, balance - ?) WHERE id=?', (fee, user['id']))
            cur_bal = round(max(0.0, cur_bal - fee), 2)
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

    return jsonify({
        'success': True,
        'users': users,
        'game_rounds': rounds,
        'bets': bets,
        'transactions': txs,
        'settings': settings,
        'gift_codes': gifts
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
            for pk in ('deposit_upi_id', 'deposit_upi_name', 'deposit_arpay_upi', 'deposit_usdt_address', 'deposit_qr_url'):
                if pk in settings and settings[pk] is not None:
                    cursor.execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', (pk, str(settings[pk]).strip()))

        # Upsert Users
        for u in users:
            phone = str(u.get('phone', '')).strip()
            if not phone:
                continue
            cursor.execute('SELECT id FROM users WHERE phone = ?', (phone,))
            existing = cursor.fetchone()
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
