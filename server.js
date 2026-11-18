// ASGames Full-Stack Server - Real Auth, Gmail OTP, Referral System & Super Admin Control Center
const express = require('express');
const path = require('path');
const crypto = require('crypto');
let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch (e) {}
const DB = require('./db.js');

const otpStore = new Map(); // email -> { code, purpose, expiresAt }

function maskEmail(email) {
    if (!email || !email.includes('@')) return email;
    const [u, d] = email.split('@');
    return (u.slice(0, 2) + '***@' + d);
}

async function sendGmailOTP(toEmail, otpCode, purpose) {
    const title = purpose === 'forgot' ? 'Reset Your ASGames Password' : 'Verify Your ASGames Account';
    const subject = `🔐 ${otpCode} is your ASGames ${purpose === 'forgot' ? 'Password Reset' : 'Verification'} OTP`;
    const html = `
        <div style="font-family:Arial,sans-serif;max-width:460px;margin:0 auto;background:#121626;color:#fff;padding:24px;border-radius:14px;border:1px solid #f5c443;">
            <h2 style="color:#f5c443;margin:0 0 10px;text-align:center;">👑 ASGames VIP</h2>
            <p style="color:#cbd5e1;font-size:14px;text-align:center;">${title}</p>
            <div style="background:#1c223c;border:2px dashed #f5c443;border-radius:10px;padding:18px;text-align:center;margin:20px 0;">
                <div style="font-size:32px;font-weight:900;letter-spacing:8px;color:#fde047;">${otpCode}</div>
            </div>
            <p style="color:#94a3b8;font-size:12px;text-align:center;">This OTP is valid for 10 minutes. Do not share it with anyone.</p>
        </div>
    `;

    // 1. PRIORITY 1: Google Apps Script HTTPS Webhook (Port 443 — Works 100% on Render Free Tier!)
    const webhookUrl = (process.env.EMAIL_WEBHOOK_URL || (DB.data.settings && DB.data.settings.email_webhook_url) || '').trim();
    if (webhookUrl && webhookUrl.startsWith('https://')) {
        try {
            const resp = await fetch(webhookUrl, {
                method: 'POST',
                redirect: 'follow',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ secret: 'spp213201pty', to: toEmail, subject, html })
            });
            const txt = await resp.text();
            if (resp.ok && txt.includes('true')) {
                console.log('[Gmail HTTPS Webhook] Sent OTP to:', toEmail);
                return { sent: true, via: 'webhook' };
            }
            console.warn('[Gmail HTTPS Webhook] Non-success response:', txt.slice(0, 120));
        } catch (e) {
            console.error('[Gmail HTTPS Webhook Error]:', e.message);
        }
    }

    // 2. PRIORITY 2: Direct Gmail SMTP (with fast 6s timeout so Render free tier never hangs)
    const gmailUser = (process.env.GMAIL_USER || (DB.data.settings && DB.data.settings.gmail_user) || '').trim();
    const gmailPass = (process.env.GMAIL_PASS || (DB.data.settings && DB.data.settings.gmail_app_password) || '').replace(/\s+/g, '');

    if (!nodemailer || !gmailUser || !gmailPass) {
        return { sent: false, reason: 'not_configured' };
    }

    try {
        const transporter = nodemailer.createTransport({
            host: 'smtp.gmail.com',
            port: 465,
            secure: true,
            connectionTimeout: 6000,
            greetingTimeout: 6000,
            socketTimeout: 8000,
            auth: { user: gmailUser, pass: gmailPass }
        });

        await transporter.sendMail({
            from: `"ASGames VIP" <${gmailUser}>`,
            to: toEmail,
            subject,
            html
        });
        return { sent: true, via: 'smtp' };
    } catch (e) {
        console.error('[Gmail SMTP Error]:', e.message);
        return { sent: false, reason: e.message };
    }
}

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(express.text({ type: ['text/plain', 'text/*'], limit: '5mb' }));
app.use(express.static(path.join(__dirname)));

// ========================================================
// AUTH HELPERS
// ========================================================
function generateToken(userId, phone) {
    const payload = `${userId}:${phone}:${Date.now()}`;
    return Buffer.from(payload).toString('base64');
}

async function getUserFromToken(req) {
    const authHeader = req.headers['authorization'] || req.query.token;
    if (!authHeader) return null;
    const token = authHeader.replace('Bearer ', '');
    try {
        const decoded = Buffer.from(token, 'base64').toString('ascii');
        const [userId] = decoded.split(':');
        const user = await DB.get('SELECT * FROM users WHERE id = ?', [userId]);
        return user || null;
    } catch (e) {
        return null;
    }
}

async function requireAuth(req, res, next) {
    const user = await getUserFromToken(req);
    if (!user) return res.status(401).json({ success: false, message: 'Unauthorized. Please login.' });
    if (user.is_banned) return res.status(403).json({ success: false, message: 'Account suspended.' });
    req.user = user;
    next();
}

async function requireAdmin(req, res, next) {
    const adminKey = req.headers['x-admin-key'] || req.query.adminKey;
    const setting = await DB.get('SELECT value FROM settings WHERE key = ?', ['admin_password']);
    const expected = setting ? setting.value : 'spp213201pty';
    if (adminKey !== expected) {
        return res.status(403).json({ success: false, message: 'Invalid admin credentials' });
    }
    next();
}

// ========================================================
// SERVER GAME ENGINE (WIN GO 30S)
// ========================================================
let currentPeriod = generatePeriodNumber();
let remainingSeconds = 30;
let isLocked = false;
let currentRoundBets = []; // cached wagers for live admin view

function generatePeriodNumber() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const sec = Math.floor((now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()) / 30);
    return `${y}${m}${d}100${String(sec).padStart(4, '0')}`;
}

function getColorForNumber(num) {
    if (num === 0) return 'red-violet';
    if (num === 5) return 'green-violet';
    if ([1, 3, 7, 9].includes(num)) return 'green';
    return 'red';
}

// Game countdown timer loop
setInterval(async () => {
    remainingSeconds--;

    if (remainingSeconds <= 5 && !isLocked) {
        isLocked = true;
    }

    if (remainingSeconds <= 0) {
        // Draw Result
        await drawServerRound();
        remainingSeconds = 30;
        currentPeriod = String(parseInt(currentPeriod) + 1);
        isLocked = false;
        currentRoundBets = [];
    }
}, 1000);

async function drawServerRound() {
    try {
        const periodToDraw = currentPeriod;

        // 1. Fetch Admin Mode
        const modeSetting = await DB.get('SELECT value FROM settings WHERE key = ?', ['game_mode']);
        const manualSetting = await DB.get('SELECT value FROM settings WHERE key = ?', ['manual_number']);

        const mode = modeSetting ? modeSetting.value : 'random';
        let winningNum = Math.floor(Math.random() * 10);

        // Fetch all bets on this period
        const periodBets = await DB.all('SELECT * FROM bets WHERE period_id = ? AND status = ?', [periodToDraw, 'pending']);

        if (mode === 'manual' && manualSetting && manualSetting.value !== '') {
            winningNum = parseInt(manualSetting.value);
            // Reset manual after drawing
            await DB.run('UPDATE settings SET value = ? WHERE key = ?', ['', 'manual_number']);
        } else if (mode === 'house_edge' && periodBets.length > 0) {
            // Smart House Edge: Find the number 0-9 that pays out the minimum
            let lowestPayout = Infinity;
            let bestNumber = 0;

            for (let testNum = 0; testNum <= 9; testNum++) {
                const testColor = getColorForNumber(testNum);
                const testSize = testNum >= 5 ? 'Big' : 'Small';
                let totalPayout = 0;

                for (const bet of periodBets) {
                    if (bet.select_type === 'number' && parseInt(bet.select_value) === testNum) {
                        totalPayout += bet.amount * 9;
                    } else if (bet.select_type === 'color') {
                        if (bet.select_value === 'green') {
                            if (testColor === 'green') totalPayout += bet.amount * 2;
                            else if (testColor === 'green-violet') totalPayout += bet.amount * 1.5;
                        } else if (bet.select_value === 'red') {
                            if (testColor === 'red') totalPayout += bet.amount * 2;
                            else if (testColor === 'red-violet') totalPayout += bet.amount * 1.5;
                        } else if (bet.select_value === 'violet' && (testNum === 0 || testNum === 5)) {
                            totalPayout += bet.amount * 4.5;
                        }
                    } else if (bet.select_type === 'size' && bet.select_value.toLowerCase() === testSize.toLowerCase()) {
                        totalPayout += bet.amount * 2;
                    }
                }

                if (totalPayout < lowestPayout) {
                    lowestPayout = totalPayout;
                    bestNumber = testNum;
                }
            }
            winningNum = bestNumber;
        }

        const color = getColorForNumber(winningNum);
        const size = winningNum >= 5 ? 'Big' : 'Small';

        // 2. Save round in DB
        await DB.run(`INSERT OR REPLACE INTO game_rounds (period_id, game_mode, winning_number, winning_color, winning_size) VALUES (?, ?, ?, ?, ?)`,
            [periodToDraw, '30s', winningNum, color, size]);

        // 3. Resolve Bets & Payouts
        for (const bet of periodBets) {
            let isWin = false;
            let mult = 0;

            if (bet.select_type === 'color') {
                if (bet.select_value === 'green') {
                    if (color === 'green') { isWin = true; mult = 2.0; }
                    else if (color === 'green-violet') { isWin = true; mult = 1.5; }
                } else if (bet.select_value === 'red') {
                    if (color === 'red') { isWin = true; mult = 2.0; }
                    else if (color === 'red-violet') { isWin = true; mult = 1.5; }
                } else if (bet.select_value === 'violet' && (winningNum === 0 || winningNum === 5)) {
                    isWin = true; mult = 4.5;
                }
            } else if (bet.select_type === 'number') {
                if (parseInt(bet.select_value) === winningNum) {
                    isWin = true; mult = 9.0;
                }
            } else if (bet.select_type === 'size') {
                if (bet.select_value.toLowerCase() === size.toLowerCase()) {
                    isWin = true; mult = 2.0;
                }
            }

            if (isWin) {
                const payout = Math.floor(bet.amount * mult * 0.98 * 100) / 100;
                await DB.run('UPDATE bets SET status = ?, payout = ? WHERE id = ?', ['won', payout, bet.id]);
                await DB.run('UPDATE users SET balance = balance + ? WHERE id = ?', [payout, bet.user_id]);
                await DB.run(`INSERT INTO transactions (id, user_id, type, amount, status, details) VALUES (?, ?, ?, ?, ?, ?)`,
                    ['TX' + Date.now() + Math.floor(Math.random() * 999), bet.user_id, 'win', payout, 'approved', `Win Go Period #${periodToDraw}`]);
            } else {
                await DB.run('UPDATE bets SET status = ?, payout = 0 WHERE id = ?', ['lost', bet.id]);
            }

            // 4. Distribute 3-Tier Referral Commissions
            await distributeReferralCommissions(bet.user_id, bet.amount);
        }

    } catch (err) {
        console.error('Error drawing round:', err);
    }
}

async function distributeReferralCommissions(userId, betAmount) {
    try {
        const user = await DB.get('SELECT referred_by FROM users WHERE id = ?', [userId]);
        if (!user || !user.referred_by) return;

        // Tier 1 (0.6%)
        const tier1User = await DB.get('SELECT id, referred_by FROM users WHERE invite_code = ?', [user.referred_by]);
        if (!tier1User) return;
        const comm1 = Math.floor(betAmount * 0.006 * 100) / 100;
        if (comm1 > 0) {
            await DB.run(`INSERT INTO commissions (user_id, downline_id, tier, bet_amount, commission) VALUES (?, ?, 1, ?, ?)`,
                [tier1User.id, userId, betAmount, comm1]);
        }

        // Tier 2 (0.18%)
        if (!tier1User.referred_by) return;
        const tier2User = await DB.get('SELECT id, referred_by FROM users WHERE invite_code = ?', [tier1User.referred_by]);
        if (!tier2User) return;
        const comm2 = Math.floor(betAmount * 0.0018 * 100) / 100;
        if (comm2 > 0) {
            await DB.run(`INSERT INTO commissions (user_id, downline_id, tier, bet_amount, commission) VALUES (?, ?, 2, ?, ?)`,
                [tier2User.id, userId, betAmount, comm2]);
        }

        // Tier 3 (0.05%)
        if (!tier2User.referred_by) return;
        const tier3User = await DB.get('SELECT id FROM users WHERE invite_code = ?', [tier2User.referred_by]);
        if (!tier3User) return;
        const comm3 = Math.floor(betAmount * 0.0005 * 100) / 100;
        if (comm3 > 0) {
            await DB.run(`INSERT INTO commissions (user_id, downline_id, tier, bet_amount, commission) VALUES (?, ?, 3, ?, ?)`,
                [tier3User.id, userId, betAmount, comm3]);
        }
    } catch (e) {
        console.error('Referral commission error:', e);
    }
}

// Seed initial history if empty
setTimeout(async () => {
    try {
        const count = await DB.get('SELECT COUNT(*) as cnt FROM game_rounds');
        if (count && count.cnt < 10) {
            let base = parseInt(currentPeriod) - 20;
            for (let i = 0; i < 20; i++) {
                const num = Math.floor(Math.random() * 10);
                await DB.run(`INSERT OR IGNORE INTO game_rounds (period_id, game_mode, winning_number, winning_color, winning_size) VALUES (?, ?, ?, ?, ?)`,
                    [String(base + i), '30s', num, getColorForNumber(num), num >= 5 ? 'Big' : 'Small']);
            }
        }
    } catch (e) { }
}, 1000);

// ========================================================
// USER AUTHENTICATION & GMAIL OTP APIS
// ========================================================
app.post('/api/auth/send-otp', async (req, res) => {
    try {
        const purpose = req.body.purpose === 'forgot' ? 'forgot' : 'register';
        let targetEmail = String(req.body.email || '').trim().toLowerCase();
        const phoneOrEmail = String(req.body.phone || req.body.email || '').trim();

        if (purpose === 'register') {
            if (!targetEmail || !targetEmail.includes('@') || !targetEmail.includes('.')) {
                return res.json({ success: false, message: 'Please enter a valid Gmail address (e.g. name@gmail.com).' });
            }
            const existingEmail = await DB.get('SELECT id FROM users WHERE email = ?', [targetEmail]);
            if (existingEmail) {
                return res.json({ success: false, message: 'This Gmail is already registered! Please login instead.' });
            }
        } else {
            // Forgot password -> find user by phone OR email, then send OTP to their verified Gmail
            if (!phoneOrEmail) {
                return res.json({ success: false, message: 'Please enter your registered mobile number or Gmail.' });
            }
            const user = await DB.get('SELECT * FROM users WHERE phone = ? OR email = ?', [phoneOrEmail, phoneOrEmail.toLowerCase()]);
            if (!user) {
                return res.json({ success: false, message: 'Account not found! Please check your mobile number or Gmail.' });
            }
            if (!user.email || !user.email.includes('@')) {
                return res.json({ success: false, message: 'No Gmail linked to this account! Please contact admin.' });
            }
            targetEmail = user.email.toLowerCase();
        }

        const otpCode = String(Math.floor(100000 + Math.random() * 900000));
        otpStore.set(targetEmail, {
            code: otpCode,
            purpose,
            expiresAt: Date.now() + 10 * 60 * 1000
        });

        const mailResult = await sendGmailOTP(targetEmail, otpCode, purpose);
        if (mailResult.sent) {
            return res.json({
                success: true,
                masked_email: maskEmail(targetEmail),
                message: `OTP sent to ${maskEmail(targetEmail)}! Please check your Gmail inbox.`
            });
        } else {
            // Graceful fallback when Gmail App Password hasn't been added in Admin Panel yet
            return res.json({
                success: true,
                masked_email: maskEmail(targetEmail),
                demo_otp: otpCode,
                smtp_warning: true,
                message: `OTP generated for ${maskEmail(targetEmail)} (Admin: add Gmail App Password in Cloud/Email tab for live inbox delivery). OTP: ${otpCode}`
            });
        }
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/auth/register', async (req, res) => {
    try {
        const { phone, email, otp, password, invite_code } = req.body;
        const cleanPhone = String(phone || '').trim();
        const cleanEmail = String(email || '').trim().toLowerCase();
        const cleanOtp = String(otp || '').trim();

        if (!cleanPhone || !password || cleanPhone.length < 10) {
            return res.json({ success: false, message: 'Please provide valid 10-digit phone number and password.' });
        }
        if (!cleanEmail || !cleanEmail.includes('@')) {
            return res.json({ success: false, message: 'Please enter your valid Gmail address.' });
        }

        // Verify Gmail OTP once at registration!
        const stored = otpStore.get(cleanEmail);
        if (!stored || stored.purpose !== 'register' || stored.code !== cleanOtp || Date.now() > stored.expiresAt) {
            return res.json({ success: false, message: 'Invalid or expired Gmail OTP! Please click Send OTP and enter the 6-digit code.' });
        }

        const existing = await DB.get('SELECT id FROM users WHERE phone = ?', [cleanPhone]);
        if (existing) {
            return res.json({ success: false, message: 'Phone number already registered. Please login.' });
        }
        const existingMail = await DB.get('SELECT id FROM users WHERE email = ?', [cleanEmail]);
        if (existingMail) {
            return res.json({ success: false, message: 'This Gmail is already registered. Please login.' });
        }

        otpStore.delete(cleanEmail); // Verified once! Never needed on login again!

        // Generate unique invitation code
        const myInviteCode = 'ASG' + Math.floor(100000 + Math.random() * 900000);

        // Verify referrer
        let referrerCode = null;
        if (invite_code) {
            const refUser = await DB.get('SELECT invite_code FROM users WHERE invite_code = ?', [invite_code.trim()]);
            if (refUser) referrerCode = refUser.invite_code;
        }

        const result = await DB.run(`INSERT INTO users (phone, password, balance, invite_code, referred_by, email, email_verified) VALUES (?, ?, 100.0, ?, ?, ?, ?)`,
            [cleanPhone, password, myInviteCode, referrerCode, cleanEmail, 1]);

        const newUser = await DB.get('SELECT * FROM users WHERE id = ?', [result.id]);
        const token = generateToken(newUser.id, newUser.phone);

        res.json({
            success: true,
            message: 'Gmail verified & Registered successfully! ₹100 Welcome Bonus credited.',
            token,
            user: {
                id: newUser.id,
                phone: newUser.phone,
                email: newUser.email,
                balance: newUser.balance,
                invite_code: newUser.invite_code,
                vip_level: newUser.vip_level
            }
        });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { phone, password } = req.body;
        const loginId = String(phone || '').trim();
        // Login with Phone OR Gmail — NO OTP asked once verified at registration!
        const user = await DB.get('SELECT * FROM users WHERE phone = ? OR email = ?', [loginId, loginId.toLowerCase()]);
        if (!user || user.password !== password) {
            return res.json({ success: false, message: 'Incorrect mobile/Gmail or password.' });
        }
        if (user.is_banned) {
            return res.json({ success: false, message: 'Account is suspended by administrator.' });
        }

        const token = generateToken(user.id, user.phone);
        res.json({
            success: true,
            message: 'Logged in successfully',
            token,
            user: {
                id: user.id,
                phone: user.phone,
                email: user.email || '',
                balance: user.balance,
                invite_code: user.invite_code,
                vip_level: user.vip_level
            }
        });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

function toPublicUid(id) {
    const n = parseInt(id, 10);
    if (!n || isNaN(n)) return 100001;
    return n < 100000 ? 100000 + n : n;
}

function resolveUserByPublicUid(rawUid) {
    const n = parseInt(rawUid, 10);
    if (!n || isNaN(n)) return null;
    return (DB.data.users || []).find(u => u.id === n || toPublicUid(u.id) === n) || null;
}

app.get('/api/auth/me', requireAuth, async (req, res) => {
    res.json({
        success: true,
        user: {
            id: req.user.id,
            uid: toPublicUid(req.user.id),
            phone: req.user.phone,
            email: req.user.email || '',
            balance: req.user.balance,
            invite_code: req.user.invite_code,
            referred_by: req.user.referred_by,
            vip_level: req.user.vip_level
        }
    });
});

app.post('/api/auth/forgot-password', async (req, res) => {
    try {
        const { phone, otp, new_password } = req.body;
        const loginId = String(phone || '').trim();
        const cleanOtp = String(otp || '').trim();

        if (!loginId || !new_password || new_password.length < 4) {
            return res.json({ success: false, message: 'Please provide your mobile/Gmail, 6-digit Gmail OTP, and new password.' });
        }

        const user = await DB.get('SELECT * FROM users WHERE phone = ? OR email = ?', [loginId, loginId.toLowerCase()]);
        if (!user) {
            return res.json({ success: false, message: 'Account not found! Please check or register.' });
        }

        const userEmail = (user.email || '').toLowerCase();
        const stored = otpStore.get(userEmail);
        if (!stored || stored.purpose !== 'forgot' || stored.code !== cleanOtp || Date.now() > stored.expiresAt) {
            return res.json({ success: false, message: 'Invalid or expired Gmail OTP! Please click Send OTP first.' });
        }

        otpStore.delete(userEmail);
        await DB.run('UPDATE users SET password = ? WHERE id = ?', [new_password.trim(), user.id]);
        res.json({ success: true, message: 'Password reset successfully! You can now log in directly without OTP.' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ========================================================
// GAME APIS
// ========================================================
app.get('/api/game/current', (req, res) => {
    res.json({
        success: true,
        period: currentPeriod,
        remainingSeconds: remainingSeconds,
        isLocked: isLocked
    });
});

app.post('/api/game/bet', requireAuth, async (req, res) => {
    try {
        const { period_id, select_type, select_value, amount, game_mode } = req.body;
        const mode = String(game_mode || '30s');
        const betAmount = parseFloat(amount);

        // Only enforce the 30s server lock on 30s mode; never fail due to client timezone/period drift!
        if (mode === '30s' && isLocked) {
            return res.json({ success: false, message: 'Betting is locked for last 5 seconds! Wait for next round.' });
        }
        if (!betAmount || betAmount < 1) {
            return res.json({ success: false, message: 'Invalid bet amount' });
        }
        if (req.user.balance < betAmount) {
            return res.json({ success: false, message: 'Insufficient balance! Please recharge.' });
        }

        const effectivePeriod = mode === '30s' ? currentPeriod : String(period_id || currentPeriod);

        // Deduct balance ONCE
        await DB.run('UPDATE users SET balance = balance - ? WHERE id = ?', [betAmount, req.user.id]);

        // Record bet
        const betId = 'BET' + Date.now() + Math.floor(Math.random() * 999);
        await DB.run(`INSERT INTO bets (id, user_id, period_id, game_mode, select_type, select_value, amount, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
            [betId, req.user.id, effectivePeriod, mode, select_type, String(select_value), betAmount]);

        // Cache for admin live board (for 30s live round)
        if (mode === '30s') {
            currentRoundBets.push({
                id: betId,
                user_phone: req.user.phone,
                select_type,
                select_value: String(select_value),
                amount: betAmount
            });
        }

        const updatedUser = await DB.get('SELECT balance FROM users WHERE id = ?', [req.user.id]);
        const finalBal = updatedUser ? updatedUser.balance : 0;
        res.json({
            success: true,
            message: `Bet ₹${betAmount} placed successfully!`,
            balance: finalBal,
            newBalance: finalBal,
            period_id: effectivePeriod,
            serverSettled: (mode === '30s')
        });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.get('/api/game/history', async (req, res) => {
    try {
        const history = await DB.all('SELECT * FROM game_rounds ORDER BY created_at DESC LIMIT 30');
        res.json({ success: true, history });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.get('/api/game/my-bets', requireAuth, async (req, res) => {
    try {
        const bets = await DB.all('SELECT * FROM bets WHERE user_id = ? ORDER BY created_at DESC LIMIT 30', [req.user.id]);
        res.json({ success: true, bets });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ========================================================
// REFERRAL & COMMISSION APIS
// ========================================================
app.get('/api/referral/stats', requireAuth, async (req, res) => {
    try {
        const user = req.user;
        const downline = await DB.all('SELECT phone, created_at, balance FROM users WHERE referred_by = ? ORDER BY created_at DESC', [user.invite_code]);
        const commissions = await DB.all('SELECT * FROM commissions WHERE user_id = ?', [user.id]);

        const totalEarned = commissions.reduce((sum, c) => sum + c.commission, 0);
        const unclaimed = commissions.filter(c => c.claimed === 0).reduce((sum, c) => sum + c.commission, 0);
        const totalTurnover = commissions.reduce((sum, c) => sum + c.bet_amount, 0);

        const tier1Count = downline.length;
        const tier2Count = commissions.filter(c => c.tier === 2).length;
        const tier3Count = commissions.filter(c => c.tier === 3).length;

        res.json({
            success: true,
            invite_code: user.invite_code,
            invite_link: `https://akshitkumarsaxena3-cyber.github.io/asgames/?r=${user.invite_code}`,
            tier1Count,
            tier2Count,
            tier3Count,
            totalMembers: tier1Count + tier2Count + tier3Count,
            totalTurnover,
            totalEarned,
            unclaimedCommission: Math.floor(unclaimed * 100) / 100,
            subordinates: downline.slice(0, 15).map(u => ({
                phone: u.phone.replace(/(\d{3})\d{4}(\d{3})/, '$1****$2'),
                date: u.created_at
            }))
        });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/referral/claim', requireAuth, async (req, res) => {
    try {
        const unclaimed = await DB.all('SELECT id, commission FROM commissions WHERE user_id = ? AND claimed = 0', [req.user.id]);
        const total = unclaimed.reduce((sum, c) => sum + c.commission, 0);
        if (total <= 0) {
            return res.json({ success: false, message: 'No commission available to claim.' });
        }

        const cleanTotal = Math.floor(total * 100) / 100;
        await DB.run('UPDATE commissions SET claimed = 1 WHERE user_id = ? AND claimed = 0', [req.user.id]);
        await DB.run('UPDATE users SET balance = balance + ? WHERE id = ?', [cleanTotal, req.user.id]);
        await DB.run(`INSERT INTO transactions (id, user_id, type, amount, status, details) VALUES (?, ?, ?, ?, ?, ?)`,
            ['TX' + Date.now(), req.user.id, 'commission', cleanTotal, 'approved', 'Referral Commission Claim']);

        res.json({ success: true, message: `Successfully claimed ₹${cleanTotal} referral commission!`, claimed: cleanTotal });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ========================================================
// WALLET DEPOSIT & WITHDRAWAL APIS
// ========================================================
app.post('/api/wallet/deposit', requireAuth, async (req, res) => {
    try {
        const { amount, utr, channel } = req.body;
        const depositAmt = parseFloat(amount);
        if (!depositAmt || depositAmt < 100) {
            return res.json({ success: false, message: 'Minimum deposit is ₹100' });
        }
        if (!utr || utr.length < 6) {
            return res.json({ success: false, message: 'Please provide valid 12-digit UTR / Transaction ID' });
        }

        const txId = 'DEP' + Date.now();
        const cleanUtr = String(utr || '').replace(/\D/g, '');

        // Check if this UTR was already captured by MacroDroid!
        if (!Array.isArray(DB.data.macrodroid_payments)) DB.data.macrodroid_payments = [];
        const prePayment = DB.data.macrodroid_payments.find(p => p.status === 'unclaimed' && p.utr && p.utr === cleanUtr);

        if (prePayment) {
            // INSTANT AUTO-CREDIT!
            prePayment.status = 'matched';
            prePayment.matched_user_id = req.user.id;
            prePayment.matched_tx_id = txId;

            const creditAmt = prePayment.amount > 0 ? prePayment.amount : depositAmt;
            await DB.run(`INSERT INTO transactions (id, user_id, type, amount, status, details) VALUES (?, ?, ?, ?, ?, ?)`,
                [txId, req.user.id, 'deposit', creditAmt, 'approved', `Channel: ${channel || 'UPI'} | UTR: ${cleanUtr} | Auto-verified via MacroDroid`]);
            await DB.run('UPDATE users SET balance = balance + ? WHERE id = ?', [creditAmt, req.user.id]);

            if (!Array.isArray(DB.data.macrodroid_logs)) DB.data.macrodroid_logs = [];
            DB.data.macrodroid_logs.unshift({
                time: new Date().toISOString(),
                utr: cleanUtr,
                amount: creditAmt,
                action: 'INSTANT_AUTO_CREDITED',
                user_id: req.user.id,
                details: `Player submitted UTR ${cleanUtr}. Matched existing bank payment! ₹${creditAmt} credited instantly.`,
                raw: `TxID: ${txId}`
            });
            if (DB.data.macrodroid_logs.length > 100) DB.data.macrodroid_logs.length = 100;
            DB.save();

            return res.json({
                success: true,
                instant_credited: true,
                amount: creditAmt,
                message: `🎉 Payment Verified! ₹${creditAmt.toFixed(2)} has been credited to your wallet instantly!`
            });
        }

        await DB.run(`INSERT INTO transactions (id, user_id, type, amount, status, details) VALUES (?, ?, ?, ?, ?, ?)`,
            [txId, req.user.id, 'deposit', depositAmt, 'pending', `Channel: ${channel || 'UPI'} | UTR: ${utr}`]);

        res.json({ success: true, message: 'Deposit submitted! Balance will update after admin approval.' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/wallet/withdraw', requireAuth, async (req, res) => {
    try {
        const { amount, bank_info } = req.body;
        const withdrawAmt = parseFloat(amount);
        if (!withdrawAmt || withdrawAmt < 110) {
            return res.json({ success: false, message: 'Minimum withdrawal amount is ₹110' });
        }
        if (req.user.balance < withdrawAmt) {
            return res.json({ success: false, message: 'Insufficient balance' });
        }

        // Deduct & Hold balance immediately
        await DB.run('UPDATE users SET balance = balance - ? WHERE id = ?', [withdrawAmt, req.user.id]);

        const txId = 'WTH' + Date.now();
        await DB.run(`INSERT INTO transactions (id, user_id, type, amount, status, details) VALUES (?, ?, ?, ?, ?, ?)`,
            [txId, req.user.id, 'withdraw', withdrawAmt, 'pending', bank_info || 'UPI / Bank Transfer']);

        const updatedUser = await DB.get('SELECT balance FROM users WHERE id = ?', [req.user.id]);
        const finalBal = updatedUser ? Math.round(updatedUser.balance * 100) / 100 : 0;

        // Immediately sync deduction to PythonAnywhere so pull cannot revert it
        DB.syncPushToPythonAnywhere().catch(() => {});

        res.json({ success: true, balance: finalBal, tx_id: txId, message: 'Withdrawal requested! Processing within 1-24 hours.' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.get('/api/wallet/transactions', requireAuth, async (req, res) => {
    try {
        const list = await DB.all('SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 40', [req.user.id]);
        res.json({ success: true, transactions: list });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/wallet/sync-game-delta', requireAuth, async (req, res) => {
    try {
        const delta = parseFloat(req.body.delta);
        if (isNaN(delta) || delta === 0) {
            return res.json({ success: true, balance: req.user.balance });
        }
        await DB.run('UPDATE users SET balance = MAX(0, balance + ?) WHERE id = ?', [delta, req.user.id]);
        const updated = await DB.get('SELECT balance FROM users WHERE id = ?', [req.user.id]);
        res.json({ success: true, balance: updated ? updated.balance : req.user.balance });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ========================================================
// SUPER ADMIN CONTROL PANEL APIS
// ========================================================
app.post('/api/admin/login', async (req, res) => {
    try {
        const { password } = req.body;
        const setting = await DB.get('SELECT value FROM settings WHERE key = ?', ['admin_password']);
        const expected = setting ? setting.value : 'spp213201pty';
        if (password === expected) {
            res.json({ success: true, message: 'Admin verified', adminKey: expected });
        } else {
            res.json({ success: false, message: 'Incorrect admin password' });
        }
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.get('/api/admin/overview', requireAdmin, async (req, res) => {
    try {
        const totalUsers = await DB.get('SELECT COUNT(*) as count FROM users');
        const totalBalance = await DB.get('SELECT SUM(balance) as total FROM users');
        const pendingDeposits = await DB.get("SELECT COUNT(*) as count FROM transactions WHERE type='deposit' AND status='pending'");
        const pendingWithdrawals = await DB.get("SELECT COUNT(*) as count FROM transactions WHERE type='withdraw' AND status='pending'");

        const modeSetting = await DB.get('SELECT value FROM settings WHERE key = ?', ['game_mode']);
        const manualSetting = await DB.get('SELECT value FROM settings WHERE key = ?', ['manual_number']);

        // Calculate live wager amounts on current period
        let wagers = { green: 0, red: 0, violet: 0, big: 0, small: 0, numbers: {} };
        for (let i = 0; i <= 9; i++) wagers.numbers[i] = 0;

        for (const b of currentRoundBets) {
            if (b.select_type === 'color') wagers[b.select_value] += b.amount;
            else if (b.select_type === 'size') wagers[b.select_value.toLowerCase()] += b.amount;
            else if (b.select_type === 'number') wagers.numbers[b.select_value] += b.amount;
        }

        res.json({
            success: true,
            currentPeriod,
            remainingSeconds,
            isLocked,
            gameMode: modeSetting ? modeSetting.value : 'random',
            manualNumber: manualSetting ? manualSetting.value : '',
            aviatorMode: (DB.data.settings && DB.data.settings.aviator_mode) || 'smart_profit',
            aviatorCrash: (DB.data.settings && DB.data.settings.aviator_crash) || '2.00',
            minesMode: (DB.data.settings && DB.data.settings.mines_mode) || 'random',
            minesMaxSafe: (DB.data.settings && DB.data.settings.mines_max_safe) || '1',
            k3Mode: (DB.data.settings && DB.data.settings.k3_mode) || 'random',
            k3Dice: (DB.data.settings && DB.data.settings.k3_dice) || '1,2,3',
            ludoMode: (DB.data.settings && DB.data.settings.ludo_mode) || 'fair',
            stats: {
                users: totalUsers.count,
                totalBalance: Math.floor((totalBalance.total || 0) * 100) / 100,
                pendingDeposits: pendingDeposits.count,
                pendingWithdrawals: pendingWithdrawals.count
            },
            wagers,
            activeBets: currentRoundBets
        });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.get('/api/game/all-rigging', async (req, res) => {
    try {
        const s = DB.data.settings || {};
        res.json({
            success: true,
            wingo_mode: s.game_mode || 'random',
            wingo_manual_number: s.manual_number !== undefined ? String(s.manual_number) : '',
            aviator_mode: s.aviator_mode || 'smart_profit',
            aviator_crash: parseFloat(s.aviator_crash || '2.00'),
            aviator_force_ts: parseInt(s.aviator_force_ts || '0'),
            mines_mode: s.mines_mode || 'random',
            mines_max_safe: parseInt(s.mines_max_safe || '1'),
            k3_mode: s.k3_mode || 'random',
            k3_dice: s.k3_dice || '1,2,3',
            ludo_mode: s.ludo_mode || 'fair'
        });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/admin/control', requireAdmin, async (req, res) => {
    try {
        const {
            mode, manual_number,
            aviator_mode, aviator_crash, aviator_force_ts,
            mines_mode, mines_max_safe,
            k3_mode, k3_dice,
            ludo_mode
        } = req.body;

        if (mode) await DB.run('UPDATE settings SET value = ? WHERE key = ?', [mode, 'game_mode']);
        if (manual_number !== undefined) await DB.run('UPDATE settings SET value = ? WHERE key = ?', [String(manual_number), 'manual_number']);
        if (aviator_mode) await DB.run('UPDATE settings SET value = ? WHERE key = ?', [aviator_mode, 'aviator_mode']);
        if (aviator_crash !== undefined) await DB.run('UPDATE settings SET value = ? WHERE key = ?', [String(aviator_crash), 'aviator_crash']);
        if (aviator_force_ts !== undefined) await DB.run('UPDATE settings SET value = ? WHERE key = ?', [String(aviator_force_ts), 'aviator_force_ts']);
        if (mines_mode) await DB.run('UPDATE settings SET value = ? WHERE key = ?', [mines_mode, 'mines_mode']);
        if (mines_max_safe !== undefined) await DB.run('UPDATE settings SET value = ? WHERE key = ?', [String(mines_max_safe), 'mines_max_safe']);
        if (k3_mode) await DB.run('UPDATE settings SET value = ? WHERE key = ?', [k3_mode, 'k3_mode']);
        if (k3_dice) await DB.run('UPDATE settings SET value = ? WHERE key = ?', [String(k3_dice), 'k3_dice']);
        if (ludo_mode) await DB.run('UPDATE settings SET value = ? WHERE key = ?', [ludo_mode, 'ludo_mode']);

        res.json({ success: true, message: 'All Game Rigging & Control settings updated successfully!' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.get('/api/admin/users', requireAdmin, async (req, res) => {
    try {
        const users = await DB.all('SELECT id, phone, password, balance, invite_code, referred_by, vip_level, is_banned, created_at FROM users ORDER BY id DESC LIMIT 100');
        res.json({ success: true, users });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/admin/adjust-balance', requireAdmin, async (req, res) => {
    try {
        const { user_id, amount, reason } = req.body;
        const delta = parseFloat(amount);
        await DB.run('UPDATE users SET balance = MAX(0, balance + ?) WHERE id = ?', [delta, user_id]);
        await DB.run(`INSERT INTO transactions (id, user_id, type, amount, status, details) VALUES (?, ?, ?, ?, 'approved', ?)`,
            ['TX' + Date.now(), user_id, delta >= 0 ? 'deposit' : 'withdraw', Math.abs(delta), reason || 'Admin Balance Adjustment']);
        res.json({ success: true, message: 'User balance updated!' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/admin/toggle-ban', requireAdmin, async (req, res) => {
    try {
        const { user_id, is_banned } = req.body;
        await DB.run('UPDATE users SET is_banned = ? WHERE id = ?', [is_banned ? 1 : 0, user_id]);
        res.json({ success: true, message: is_banned ? 'User banned.' : 'User unbanned.' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.get('/api/admin/deposits', requireAdmin, async (req, res) => {
    try {
        const deposits = await DB.all(`SELECT t.*, u.phone FROM transactions t JOIN users u ON t.user_id = u.id WHERE t.type = 'deposit' AND t.status = 'pending' ORDER BY t.created_at DESC`);
        res.json({ success: true, deposits });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/admin/approve-deposit', requireAdmin, async (req, res) => {
    try {
        const { tx_id } = req.body;
        const tx = await DB.get('SELECT * FROM transactions WHERE id = ?', [tx_id]);
        if (!tx || tx.status !== 'pending') return res.json({ success: false, message: 'Transaction not found or already processed' });

        await DB.run("UPDATE transactions SET status = 'approved' WHERE id = ?", [tx_id]);
        await DB.run('UPDATE users SET balance = balance + ? WHERE id = ?', [tx.amount, tx.user_id]);

        res.json({ success: true, message: `Deposit of ₹${tx.amount} approved! Balance credited.` });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/admin/reject-deposit', requireAdmin, async (req, res) => {
    try {
        const { tx_id } = req.body;
        await DB.run("UPDATE transactions SET status = 'rejected' WHERE id = ?", [tx_id]);
        res.json({ success: true, message: 'Deposit rejected.' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.get('/api/admin/withdrawals', requireAdmin, async (req, res) => {
    try {
        const withdrawals = await DB.all(`SELECT t.*, u.phone FROM transactions t JOIN users u ON t.user_id = u.id WHERE t.type = 'withdraw' AND t.status = 'pending' ORDER BY t.created_at DESC`);
        res.json({ success: true, withdrawals });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/admin/approve-withdrawal', requireAdmin, async (req, res) => {
    try {
        const { tx_id } = req.body;
        await DB.run("UPDATE transactions SET status = 'approved' WHERE id = ?", [tx_id]);
        res.json({ success: true, message: 'Withdrawal marked as approved & paid.' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/admin/reject-withdrawal', requireAdmin, async (req, res) => {
    try {
        const { tx_id } = req.body;
        const tx = await DB.get('SELECT * FROM transactions WHERE id = ?', [tx_id]);
        if (!tx || tx.status !== 'pending') return res.json({ success: false, message: 'Transaction not found or already processed' });

        // Refund held balance
        await DB.run("UPDATE transactions SET status = 'rejected' WHERE id = ?", [tx_id]);
        await DB.run('UPDATE users SET balance = balance + ? WHERE id = ?', [tx.amount, tx.user_id]);

        res.json({ success: true, message: `Withdrawal rejected. ₹${tx.amount} refunded to user balance.` });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.get('/api/admin/all-transactions', requireAdmin, async (req, res) => {
    try {
        const list = await DB.all(`SELECT t.*, u.phone FROM transactions t JOIN users u ON t.user_id = u.id ORDER BY t.created_at DESC LIMIT 100`);
        res.json({ success: true, transactions: list });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// Gmail OTP Settings APIs (HTTPS Google Apps Script Webhook + SMTP)
app.get('/api/admin/gmail-settings', requireAdmin, async (req, res) => {
    const s = DB.data.settings || {};
    res.json({
        success: true,
        gmail_user: process.env.GMAIL_USER || s.gmail_user || '',
        has_password: Boolean(process.env.GMAIL_PASS || s.gmail_app_password),
        email_webhook_url: process.env.EMAIL_WEBHOOK_URL || s.email_webhook_url || ''
    });
});

app.post('/api/admin/gmail-settings', requireAdmin, async (req, res) => {
    try {
        const gmail_user = String(req.body.gmail_user || '').trim();
        const gmail_app_password = String(req.body.gmail_app_password || '').replace(/\s+/g, '');
        const email_webhook_url = String(req.body.email_webhook_url || '').trim();
        if (gmail_user) await DB.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['gmail_user', gmail_user]);
        if (gmail_app_password) await DB.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['gmail_app_password', gmail_app_password]);
        if (req.body.email_webhook_url !== undefined) {
            await DB.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['email_webhook_url', email_webhook_url]);
        }
        res.json({ success: true, message: 'Gmail OTP settings saved! Live inbox OTP delivery is ready.' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ========================================================
// DYNAMIC PAYMENT & DEPOSIT DETAILS APIS (ADMIN -> PLAYERS)
// ========================================================
app.get('/api/payment-details', async (req, res) => {
    const s = DB.data.settings || {};
    res.json({
        success: true,
        upi_id: s.deposit_upi_id || 'akshit9908@barodampay',
        upi_name: s.deposit_upi_name || 'AKSHIT KUMAR SAXENA',
        arpay_upi: s.deposit_arpay_upi || 'manusaxena465267@ikwik',
        usdt_address: s.deposit_usdt_address || 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
        qr_url: s.deposit_qr_url !== undefined && s.deposit_qr_url !== '' ? s.deposit_qr_url : '/assets/deposit-qr.jpg'
    });
});

app.post('/api/admin/payment-details', requireAdmin, async (req, res) => {
    try {
        const upi_id = String(req.body.upi_id || '').trim();
        const upi_name = String(req.body.upi_name || 'ASGames').trim();
        const arpay_upi = String(req.body.arpay_upi || '').trim();
        const usdt_address = String(req.body.usdt_address || '').trim();
        const qr_url = String(req.body.qr_url || '').trim();

        if (!upi_id) return res.json({ success: false, message: 'Official UPI ID is required.' });

        await DB.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['deposit_upi_id', upi_id]);
        await DB.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['deposit_upi_name', upi_name || 'ASGames']);
        await DB.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['deposit_arpay_upi', arpay_upi]);
        await DB.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['deposit_usdt_address', usdt_address]);
        await DB.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['deposit_qr_url', qr_url]);

        res.json({ success: true, message: 'Payment details updated! All players will now see your new UPI/QR/USDT details.' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ========================================================
// MACRODROID MOBILE DEPOSIT AUTOMATION (INSTANT AUTO-CREDIT)
// ========================================================
function parseMacroDroidMessage(input) {
    let rawText = '';
    let utr = '';
    let amount = 0;
    let sender = '';

    if (typeof input === 'string') {
        rawText = input.trim();
        if ((rawText.startsWith('{') && rawText.endsWith('}')) || (rawText.startsWith('[') && rawText.endsWith(']'))) {
            try { input = JSON.parse(rawText); } catch (e) {}
        }
    }

    if (input && typeof input === 'object') {
        const utrCandidates = [
            input.utr, input.rrn, input.ref, input.ref_no, input.refNo, input.txn_id, input.txnId, input.transaction_id,
            input.upi_ref, input.upiref, input.UTR, input.RRN
        ];
        for (const c of utrCandidates) {
            if (c) {
                const digits = String(c).replace(/\D/g, '');
                if (digits.length >= 8 && digits.length <= 16) {
                    utr = digits;
                    break;
                }
            }
        }

        const amtCandidates = [input.amount, input.amt, input.val, input.value, input.Amount];
        for (const a of amtCandidates) {
            if (a !== undefined && a !== null && a !== '') {
                const clean = parseFloat(String(a).replace(/,/g, ''));
                if (!isNaN(clean) && clean > 0) {
                    amount = clean;
                    break;
                }
            }
        }

        if (input.sender || input.from || input.app) sender = String(input.sender || input.from || input.app);

        const textParts = [
            input.message, input.text, input.sms, input.notification,
            input.body, input.content, input.title, input.subText, input.not_text
        ].filter(Boolean);
        if (textParts.length > 0) rawText = textParts.join(' ');
        else if (!rawText) rawText = typeof input === 'string' ? input : JSON.stringify(input);
    }

    if (!utr && rawText) {
        const m1 = rawText.match(/(?:UPI\s*(?:Ref|txn|transaction)(?:\s*(?:no\.?|id))?|Ref\s*(?:no\.?|id)?|UTR(?:\s*no\.?)?|RRN|Txn\s*id|Ref\/|UPI\/)[^\w\d]*([0-9]{10,16})/i);
        if (m1 && m1[1]) {
            utr = m1[1];
        } else {
            const m2 = rawText.match(/\b([0-9]{12})\b/);
            if (m2 && m2[1]) utr = m2[1];
        }
    }

    if (!amount && rawText) {
        const a1 = rawText.match(/(?:Rs\.?|INR|₹)\s*([0-9,]+(?:\.[0-9]{1,2})?)/i) ||
                   rawText.match(/(?:credited|received|deposited|transfer(?:red)?)\s*(?:by|with|for|of)?\s*(?:Rs\.?|INR|₹)?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i);
        if (a1 && a1[1]) {
            amount = parseFloat(a1[1].replace(/,/g, '')) || 0;
        }
    }

    return { utr, amount, sender, rawText };
}

app.all('/api/webhook/macrodroid', async (req, res) => {
    try {
        if (!Array.isArray(DB.data.macrodroid_payments)) DB.data.macrodroid_payments = [];
        if (!Array.isArray(DB.data.macrodroid_logs)) DB.data.macrodroid_logs = [];

        let inputData = req.body;
        if (!inputData || (typeof inputData === 'object' && Object.keys(inputData).length === 0)) {
            inputData = req.query;
        }

        const secret = (req.query && (req.query.secret || req.query.key)) ||
                       (req.body && (req.body.secret || req.body.admin_key || req.body.key)) ||
                       req.headers['x-admin-key'] || '';

        const expectedSecret = (DB.data.settings && DB.data.settings.admin_password) || 'spp213201pty';
        const isAuthorized = (secret === expectedSecret) || (req.headers['x-admin-key'] === expectedSecret);

        const { utr, amount, sender, rawText } = parseMacroDroidMessage(inputData);

        if (!isAuthorized) {
            DB.data.macrodroid_logs.unshift({
                time: new Date().toISOString(),
                utr: utr || 'N/A',
                amount: amount || 0,
                action: 'AUTH_FAILED',
                details: 'Invalid or missing secret key. Expected: spp213201pty',
                raw: (rawText || JSON.stringify(inputData)).slice(0, 200)
            });
            if (DB.data.macrodroid_logs.length > 100) DB.data.macrodroid_logs.length = 100;
            return res.status(401).json({
                success: false,
                message: 'Unauthorized: secret key required. Add {"secret": "spp213201pty"} in MacroDroid HTTP body or ?secret=spp213201pty'
            });
        }

        if (!utr) {
            DB.data.macrodroid_logs.unshift({
                time: new Date().toISOString(),
                utr: 'NOT_FOUND',
                amount: amount || 0,
                action: 'NO_UTR_DETECTED',
                details: 'Could not extract 10-16 digit UTR / Ref No from text.',
                raw: (rawText || JSON.stringify(inputData)).slice(0, 200)
            });
            if (DB.data.macrodroid_logs.length > 100) DB.data.macrodroid_logs.length = 100;
            return res.json({
                success: false,
                message: 'Webhook received but no valid UTR / Ref No detected in message.',
                raw: rawText
            });
        }

        // 1. Check if already approved
        const alreadyApproved = (DB.data.transactions || []).some(t =>
            t.type === 'deposit' && (t.status === 'approved' || t.status === 'completed') &&
            t.details && t.details.includes(utr)
        );
        if (alreadyApproved) {
            DB.data.macrodroid_logs.unshift({
                time: new Date().toISOString(),
                utr,
                amount,
                action: 'ALREADY_PROCESSED',
                details: `UTR ${utr} was already approved earlier.`,
                raw: rawText.slice(0, 200)
            });
            if (DB.data.macrodroid_logs.length > 100) DB.data.macrodroid_logs.length = 100;
            return res.json({
                success: true,
                message: `UTR ${utr} was already approved earlier.`,
                action: 'already_approved',
                utr
            });
        }

        // 2. Check if there is an existing pending deposit by this UTR
        const pendingTx = (DB.data.transactions || []).find(t =>
            t.type === 'deposit' && (t.status === 'pending' || t.status === 'Pending') &&
            t.details && t.details.includes(utr)
        );

        if (pendingTx) {
            pendingTx.status = 'approved';
            pendingTx.details = (pendingTx.details || '') + ' | Auto-approved by MacroDroid Webhook';
            const user = (DB.data.users || []).find(u => u.id === pendingTx.user_id);
            const creditedAmt = pendingTx.amount || amount;
            if (user) {
                user.balance = Math.round((Number(user.balance || 0) + Number(creditedAmt)) * 100) / 100;
            }

            DB.data.macrodroid_payments.push({
                id: 'MD' + Date.now(),
                utr,
                amount: creditedAmt,
                sender,
                raw_message: rawText,
                status: 'matched',
                matched_user_id: pendingTx.user_id,
                matched_tx_id: pendingTx.id,
                created_at: new Date().toISOString()
            });

            DB.data.macrodroid_logs.unshift({
                time: new Date().toISOString(),
                utr,
                amount: creditedAmt,
                action: 'AUTO_APPROVED',
                user_id: pendingTx.user_id,
                details: `Matched pending deposit ${pendingTx.id} for User #${pendingTx.user_id}. ₹${creditedAmt} credited!`,
                raw: rawText.slice(0, 200)
            });

            if (DB.data.macrodroid_logs.length > 100) DB.data.macrodroid_logs.length = 100;
            if (DB.data.macrodroid_payments.length > 300) DB.data.macrodroid_payments = DB.data.macrodroid_payments.slice(-300);
            DB.save();

            return res.json({
                success: true,
                action: 'approved_pending',
                tx_id: pendingTx.id,
                user_id: pendingTx.user_id,
                amount: creditedAmt,
                utr,
                message: `Pending deposit ${pendingTx.id} approved automatically!`
            });
        }

        // 3. Store as unclaimed for instant credit when player enters UTR
        const existingPayment = DB.data.macrodroid_payments.find(p => p.utr === utr);
        if (!existingPayment) {
            DB.data.macrodroid_payments.push({
                id: 'MD' + Date.now(),
                utr,
                amount: amount || 0,
                sender,
                raw_message: rawText,
                status: 'unclaimed',
                matched_user_id: null,
                matched_tx_id: null,
                created_at: new Date().toISOString()
            });
        }

        DB.data.macrodroid_logs.unshift({
            time: new Date().toISOString(),
            utr,
            amount: amount || 0,
            action: 'STORED_FOR_INSTANT_CREDIT',
            details: `Payment recorded in queue. When player enters UTR ${utr}, ₹${amount || 0} will be credited instantly!`,
            raw: rawText.slice(0, 200)
        });

        if (DB.data.macrodroid_logs.length > 100) DB.data.macrodroid_logs.length = 100;
        if (DB.data.macrodroid_payments.length > 300) DB.data.macrodroid_payments = DB.data.macrodroid_payments.slice(-300);
        DB.save();

        return res.json({
            success: true,
            action: 'stored_unclaimed',
            utr,
            amount,
            message: `Payment with UTR ${utr} recorded! Will auto-credit player the moment they submit.`
        });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.get('/api/admin/macrodroid-logs', requireAdmin, async (req, res) => {
    res.json({
        success: true,
        logs: (DB.data.macrodroid_logs || []).slice(0, 50),
        unclaimed: (DB.data.macrodroid_payments || []).filter(p => p.status === 'unclaimed')
    });
});

app.post('/api/admin/macrodroid-test', requireAdmin, async (req, res) => {
    const { utr, amount, message } = req.body;
    const testMsg = message || `A/c *1234 credited with INR ${amount || 500}.00 on 18-Nov-26 by UPI Ref no ${utr || '432109876543'} -Bank of Baroda`;
    const parsed = parseMacroDroidMessage(testMsg);
    res.json({
        success: true,
        test_message: testMsg,
        parsed
    });
});

// ========================================================
// GIFT CODE REDEMPTION & ADMIN GENERATOR APIS
// ========================================================
app.post('/api/gift/redeem', requireAuth, async (req, res) => {
    try {
        const code = String(req.body.code || '').trim().toUpperCase();
        if (!code) return res.json({ success: false, message: 'Please enter a gift code.' });

        if (!Array.isArray(DB.data.gift_codes)) DB.data.gift_codes = [];
        const gift = DB.data.gift_codes.find(g => g.code.toUpperCase() === code);
        if (!gift) return res.json({ success: false, message: 'Invalid or expired gift code!' });

        if (!Array.isArray(gift.claimed_by)) gift.claimed_by = [];
        if (gift.claimed_by.includes(req.user.id)) {
            return res.json({ success: false, message: 'You have already redeemed this gift code!' });
        }
        if (gift.claimed_by.length >= (gift.max_uses || 100)) {
            return res.json({ success: false, message: 'This gift code has reached its maximum claim limit!' });
        }

        gift.claimed_by.push(req.user.id);
        await DB.run('UPDATE users SET balance = balance + ? WHERE id = ?', [gift.amount, req.user.id]);
        await DB.run('INSERT INTO transactions (id, user_id, type, amount, status, details) VALUES (?, ?, ?, ?, ?, ?)',
            ['GFT' + Date.now(), req.user.id, 'deposit', gift.amount, 'approved', `Gift Code: ${gift.code}`]);
        DB.save();

        res.json({ success: true, amount: gift.amount, message: `🎉 Gift code ${gift.code} redeemed! ₹${gift.amount} added to wallet.` });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.get('/api/gift/history', requireAuth, async (req, res) => {
    const list = (DB.data.transactions || [])
        .filter(t => t.user_id === req.user.id && String(t.id || '').startsWith('GFT'))
        .reverse()
        .slice(0, 30);
    res.json({ success: true, history: list });
});

app.get('/api/admin/gifts', requireAdmin, async (req, res) => {
    if (!Array.isArray(DB.data.gift_codes)) DB.data.gift_codes = [];
    res.json({ success: true, gifts: [...DB.data.gift_codes].reverse() });
});

app.post('/api/admin/create-gift', requireAdmin, async (req, res) => {
    try {
        const code = String(req.body.code || ('ASG' + Math.floor(10000 + Math.random() * 90000))).trim().toUpperCase();
        const amount = parseFloat(req.body.amount || 50);
        const max_uses = parseInt(req.body.max_uses || 100);
        if (!code || amount <= 0) return res.json({ success: false, message: 'Valid gift code & amount required.' });
        if (!Array.isArray(DB.data.gift_codes)) DB.data.gift_codes = [];
        if (DB.data.gift_codes.some(g => g.code.toUpperCase() === code)) {
            return res.json({ success: false, message: 'Gift code already exists!' });
        }
        DB.data.gift_codes.push({ code, amount, max_uses, claimed_by: [], created_at: new Date().toISOString() });
        DB.save();
        res.json({ success: true, code, message: `Gift code ${code} (₹${amount}, ${max_uses} uses) created!` });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ========================================================
// FRIENDS BY UID & ONLINE 2P/4P LUDO MULTIPLAYER ROOMS
// ========================================================
const LUDO_SAFE_TRACK = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
const LUDO_START_IDX = { red: 39, green: 0, yellow: 13, blue: 26 };

function maskPhoneShort(p) {
    const s = String(p || '');
    return s.length >= 6 ? s.slice(0, 3) + '****' + s.slice(-3) : s;
}

function ludoGetValidTokens(tokens, roll) {
    return (tokens || []).filter(t => {
        if (t.progress >= 56) return false;
        if (t.progress === -1) return roll === 6;
        return t.progress + roll <= 56;
    });
}

function ludoApplyMove(room, color, tokenId, roll) {
    const tokens = room.tokens[color] || [];
    const token = tokens.find(t => t.id === tokenId);
    if (!token) return false;

    let extraTurn = (roll === 6);
    if (token.progress === -1 && roll === 6) {
        token.progress = 0;
        room.scores[color] = (room.scores[color] || 0) + 6;
    } else {
        token.progress += roll;
        room.scores[color] = (room.scores[color] || 0) + roll;
    }

    const mover = room.players.find(p => p.color === color);
    const moverName = mover ? `UID ${mover.uid}` : color.toUpperCase();

    if (token.progress === 56) {
        room.scores[color] += 56;
        extraTurn = true;
        room.last_event = `🎉 ${moverName} (${color.toUpperCase()}) reached HOME! +56 pts`;
    } else if (token.progress >= 0 && token.progress <= 50) {
        const trackIdx = (LUDO_START_IDX[color] + token.progress) % 52;
        if (!LUDO_SAFE_TRACK.has(trackIdx)) {
            let captured = false;
            for (const opp of room.players) {
                if (opp.color === color) continue;
                for (const ot of (room.tokens[opp.color] || [])) {
                    if (ot.progress >= 0 && ot.progress <= 50) {
                        const oTrack = (LUDO_START_IDX[opp.color] + ot.progress) % 52;
                        if (oTrack === trackIdx) {
                            ot.progress = -1;
                            extraTurn = true;
                            captured = true;
                            room.scores[color] += 25;
                            room.last_event = `⚔️ ${moverName} captured ${opp.color.toUpperCase()}! +25 pts`;
                        }
                    }
                }
            }
            if (!captured) room.last_event = `${moverName} moved ${roll} steps.`;
        } else {
            room.last_event = `${moverName} landed on safe star ★`;
        }
    } else {
        room.last_event = `${moverName} moved into Home Stretch!`;
    }

    const allHome = tokens.every(t => t.progress >= 56);
    if (allHome) {
        ludoFinishOnlineRoom(room, color);
        return true;
    }

    if (!extraTurn) {
        const nextIdx = (room.turn_idx + 1) % room.players.length;
        if (nextIdx === 0) room.turns_left = Math.max(0, (room.turns_left || 1) - 1);
        room.turn_idx = nextIdx;
    }

    if (room.turns_left <= 0) {
        const ranked = [...room.players].sort((a, b) => (room.scores[b.color] || 0) - (room.scores[a.color] || 0));
        ludoFinishOnlineRoom(room, ranked[0].color);
        return true;
    }

    room.phase = 'roll';
    room.updated_at = Date.now();
    return true;
}

function ludoFinishOnlineRoom(room, winnerColor) {
    room.status = 'finished';
    room.phase = 'finished';
    room.winner_color = winnerColor;
    const winner = room.players.find(p => p.color === winnerColor);
    room.winner_uid = winner ? winner.uid : null;
    const pot = Math.floor((room.entry_fee || 0) * room.players.length * 0.92);
    room.prize = pot;
    room.last_event = `🏆 UID ${room.winner_uid} (${winnerColor.toUpperCase()}) WON${pot > 0 ? ` ₹${pot}` : ''}!`;
    if (winner && pot > 0 && !room.paid_out) {
        room.paid_out = true;
        const u = DB.data.users.find(x => x.id === winner.uid);
        if (u) {
            u.balance = Math.round((u.balance + pot) * 100) / 100;
            DB.data.transactions.push({
                id: 'LDO' + Date.now(),
                user_id: winner.uid,
                type: 'win',
                amount: pot,
                status: 'approved',
                details: `Ludo Online Room #${room.code} Win`,
                created_at: new Date().toISOString()
            });
        }
    }
    room.updated_at = Date.now();
}

app.get('/api/friends/list', requireAuth, async (req, res) => {
    if (!Array.isArray(DB.data.friends)) DB.data.friends = [];
    if (!Array.isArray(DB.data.ludo_rooms)) DB.data.ludo_rooms = [];
    const uid = req.user.id;

    const friends = [];
    const requests = [];
    for (const f of DB.data.friends) {
        if (f.status === 'accepted' && (f.from_uid === uid || f.to_uid === uid)) {
            const otherId = f.from_uid === uid ? f.to_uid : f.from_uid;
            const u = DB.data.users.find(x => x.id === otherId);
            if (u) friends.push({ uid: toPublicUid(u.id), phone: maskPhoneShort(u.phone), status: 'accepted' });
        } else if (f.status === 'pending' && f.to_uid === uid) {
            const u = DB.data.users.find(x => x.id === f.from_uid);
            if (u) requests.push({ uid: toPublicUid(u.id), phone: maskPhoneShort(u.phone) });
        }
    }

    const cutoff = Date.now() - 30 * 60 * 1000;
    const invites = DB.data.ludo_rooms
        .filter(r => r.status === 'waiting' && (r.created_at || 0) > cutoff && Array.isArray(r.invited_uids) && r.invited_uids.includes(uid) && !r.players.some(p => p.uid === uid))
        .map(r => ({
            room_code: r.code,
            host_uid: toPublicUid(r.host_uid),
            host_phone: r.players[0] ? r.players[0].phone : '',
            max_players: r.max_players,
            joined_count: r.players.length,
            entry_fee: r.entry_fee
        }));

    res.json({ success: true, my_uid: toPublicUid(uid), friends, requests, invites });
});

app.post('/api/friends/add', requireAuth, async (req, res) => {
    if (!Array.isArray(DB.data.friends)) DB.data.friends = [];
    const uid = req.user.id;
    const rawInput = parseInt(req.body.friend_uid, 10);
    const targetUser = resolveUserByPublicUid(rawInput);
    if (!targetUser) {
        return res.json({ success: false, message: `User ID ${rawInput || ''} not found! Ask your friend for their 6-digit UID from Account tab.` });
    }
    const targetUid = targetUser.id;
    const targetPub = toPublicUid(targetUid);
    if (targetUid === uid) {
        return res.json({ success: false, message: 'You cannot add your own UID as a friend.' });
    }

    const existing = DB.data.friends.find(f =>
        (f.from_uid === uid && f.to_uid === targetUid) || (f.from_uid === targetUid && f.to_uid === uid)
    );
    if (existing) {
        if (existing.status === 'accepted') {
            return res.json({ success: false, message: `UID ${targetPub} is already in your Friends list!` });
        }
        if (existing.from_uid === targetUid) {
            existing.status = 'accepted';
            DB.save();
            return res.json({ success: true, message: `🎉 You and UID ${targetPub} are now Friends! You can invite them to Ludo.` });
        }
        return res.json({ success: false, message: `Friend request already sent to UID ${targetPub}. Waiting for them to accept.` });
    }

    DB.data.friends.push({ from_uid: uid, to_uid: targetUid, status: 'pending', created_at: new Date().toISOString() });
    DB.save();
    res.json({ success: true, message: `Friend request sent to UID ${targetPub}! Ask them to accept in Friends & Chat.` });
});

app.post('/api/friends/respond', requireAuth, async (req, res) => {
    if (!Array.isArray(DB.data.friends)) DB.data.friends = [];
    const uid = req.user.id;
    const resolved = resolveUserByPublicUid(req.body.friend_uid);
    const fromUid = resolved ? resolved.id : parseInt(req.body.friend_uid, 10);
    const fromPub = toPublicUid(fromUid);
    const action = req.body.action === 'accept' ? 'accept' : 'reject';
    const idx = DB.data.friends.findIndex(f => f.from_uid === fromUid && f.to_uid === uid && f.status === 'pending');
    if (idx === -1) return res.json({ success: false, message: 'Friend request not found.' });

    if (action === 'accept') {
        DB.data.friends[idx].status = 'accepted';
        DB.save();
        return res.json({ success: true, message: `🎉 Accepted! UID ${fromPub} is now your Friend.` });
    } else {
        DB.data.friends.splice(idx, 1);
        DB.save();
        return res.json({ success: true, message: 'Friend request declined.' });
    }
});

// Direct 1-on-1 Friend Chat (Talk & Invite to Ludo Together!)
app.get('/api/friends/chat/:friendUid', requireAuth, async (req, res) => {
    if (!Array.isArray(DB.data.friend_messages)) DB.data.friend_messages = [];
    const me = req.user.id;
    const resolved = resolveUserByPublicUid(req.params.friendUid);
    const friendUid = resolved ? resolved.id : parseInt(req.params.friendUid, 10);
    if (!friendUid) return res.json({ success: false, message: 'Invalid friend UID.' });
    const pairKey = `${Math.min(me, friendUid)}_${Math.max(me, friendUid)}`;
    const msgs = DB.data.friend_messages
        .filter(m => m.pair_key === pairKey)
        .slice(-60)
        .map(m => Object.assign({}, m, { from_uid: toPublicUid(m.from_uid), to_uid: toPublicUid(m.to_uid) }));
    res.json({ success: true, my_uid: toPublicUid(me), friend_uid: toPublicUid(friendUid), messages: msgs });
});

app.post('/api/friends/chat/send', requireAuth, async (req, res) => {
    if (!Array.isArray(DB.data.friend_messages)) DB.data.friend_messages = [];
    const me = req.user.id;
    const resolved = resolveUserByPublicUid(req.body.friend_uid);
    const friendUid = resolved ? resolved.id : parseInt(req.body.friend_uid, 10);
    const text = String(req.body.message || '').trim().slice(0, 500);
    const roomCode = String(req.body.room_code || '').trim().toUpperCase().slice(0, 12);
    if (!friendUid || !text) return res.json({ success: false, message: 'Friend UID and message required.' });

    const pairKey = `${Math.min(me, friendUid)}_${Math.max(me, friendUid)}`;
    DB.data.friend_messages.push({
        id: 'FM' + Date.now() + Math.floor(Math.random() * 999),
        pair_key: pairKey,
        from_uid: me,
        to_uid: friendUid,
        text,
        room_code: roomCode,
        created_at: new Date().toISOString()
    });
    if (DB.data.friend_messages.length > 1000) {
        DB.data.friend_messages = DB.data.friend_messages.slice(-1000);
    }
    DB.save();

    const msgs = DB.data.friend_messages
        .filter(m => m.pair_key === pairKey)
        .slice(-60)
        .map(m => Object.assign({}, m, { from_uid: toPublicUid(m.from_uid), to_uid: toPublicUid(m.to_uid) }));
    res.json({ success: true, my_uid: toPublicUid(me), messages: msgs });
});

app.post('/api/ludo/room/create', requireAuth, async (req, res) => {
    if (!Array.isArray(DB.data.ludo_rooms)) DB.data.ludo_rooms = [];
    const maxPlayers = parseInt(req.body.max_players, 10) === 2 ? 2 : 4;
    const entryFee = Math.max(0, parseFloat(req.body.entry_fee || 0));

    if (entryFee > 0 && req.user.balance < entryFee) {
        return res.json({ success: false, message: `Insufficient balance! Need ₹${entryFee} to create this room.` });
    }
    if (entryFee > 0) {
        await DB.run('UPDATE users SET balance = balance - ? WHERE id = ?', [entryFee, req.user.id]);
    }

    const code = 'LD' + Math.floor(1000 + Math.random() * 9000);
    const room = {
        code,
        host_uid: req.user.id,
        max_players: maxPlayers,
        entry_fee: entryFee,
        status: 'waiting',
        phase: 'waiting',
        players: [{ uid: req.user.id, phone: maskPhoneShort(req.user.phone), color: 'red' }],
        invited_uids: [],
        tokens: {},
        scores: {},
        turn_idx: 0,
        turns_left: maxPlayers === 4 ? 18 : 24,
        dice: 6,
        winner_color: null,
        winner_uid: null,
        prize: 0,
        paid_out: false,
        last_event: `Room ${code} created! Invite friends by UID or share code.`,
        created_at: Date.now(),
        updated_at: Date.now()
    };

    DB.data.ludo_rooms.push(room);
    if (DB.data.ludo_rooms.length > 60) DB.data.ludo_rooms.shift();
    DB.save();

    const updated = await DB.get('SELECT balance FROM users WHERE id = ?', [req.user.id]);
    res.json({ success: true, room, balance: updated ? updated.balance : req.user.balance });
});

app.post('/api/ludo/room/invite', requireAuth, async (req, res) => {
    const code = String(req.body.room_code || '').trim().toUpperCase();
    const resolved = resolveUserByPublicUid(req.body.friend_uid);
    const friendUid = resolved ? resolved.id : parseInt(req.body.friend_uid, 10);
    const room = (DB.data.ludo_rooms || []).find(r => r.code === code && r.status === 'waiting');
    if (!room) return res.json({ success: false, message: 'Room not found or already started.' });
    if (!Array.isArray(room.invited_uids)) room.invited_uids = [];
    if (!room.invited_uids.includes(friendUid)) room.invited_uids.push(friendUid);
    DB.save();
    res.json({ success: true, message: `📩 Ludo invite sent to UID ${toPublicUid(friendUid)}!` });
});

app.post('/api/ludo/room/join', requireAuth, async (req, res) => {
    const code = String(req.body.room_code || '').trim().toUpperCase();
    const room = (DB.data.ludo_rooms || []).find(r => r.code === code);
    if (!room) return res.json({ success: false, message: `Room ${code} not found!` });

    if (room.players.some(p => p.uid === req.user.id)) {
        return res.json({ success: true, room, balance: req.user.balance });
    }
    if (room.status !== 'waiting') {
        return res.json({ success: false, message: 'This Ludo match has already started!' });
    }
    if (room.players.length >= room.max_players) {
        return res.json({ success: false, message: 'Room is already full!' });
    }
    if (room.entry_fee > 0 && req.user.balance < room.entry_fee) {
        return res.json({ success: false, message: `Need ₹${room.entry_fee} balance to join this room!` });
    }
    if (room.entry_fee > 0) {
        await DB.run('UPDATE users SET balance = balance - ? WHERE id = ?', [room.entry_fee, req.user.id]);
    }

    const palette = room.max_players === 2 ? ['red', 'yellow'] : ['red', 'green', 'yellow', 'blue'];
    const color = palette[room.players.length] || 'blue';
    room.players.push({ uid: req.user.id, phone: maskPhoneShort(req.user.phone), color });
    room.last_event = `UID ${req.user.id} joined as ${color.toUpperCase()}!`;
    room.updated_at = Date.now();
    DB.save();

    const updated = await DB.get('SELECT balance FROM users WHERE id = ?', [req.user.id]);
    res.json({ success: true, room, balance: updated ? updated.balance : req.user.balance });
});

app.post('/api/ludo/room/start', requireAuth, async (req, res) => {
    const code = String(req.body.room_code || '').trim().toUpperCase();
    const room = (DB.data.ludo_rooms || []).find(r => r.code === code);
    if (!room) return res.json({ success: false, message: 'Room not found.' });
    if (room.host_uid !== req.user.id) return res.json({ success: false, message: 'Only the Room Host can start the match.' });
    if (room.players.length < 2) return res.json({ success: false, message: 'Wait for at least 1 friend to join before starting!' });

    room.status = 'playing';
    room.phase = 'roll';
    room.turn_idx = 0;
    room.tokens = {};
    room.scores = {};
    for (const p of room.players) {
        room.tokens[p.color] = [
            { id: 0, progress: 0 },
            { id: 1, progress: 0 },
            { id: 2, progress: -1 },
            { id: 3, progress: -1 }
        ];
        room.scores[p.color] = 0;
    }
    room.last_event = `🎲 Match Started! UID ${room.players[0].uid} (RED) rolls first!`;
    room.updated_at = Date.now();
    DB.save();
    res.json({ success: true, room });
});

app.get('/api/ludo/room/:code', requireAuth, async (req, res) => {
    const code = String(req.params.code || '').trim().toUpperCase();
    const room = (DB.data.ludo_rooms || []).find(r => r.code === code);
    if (!room) return res.json({ success: false, message: 'Room not found.' });
    res.json({ success: true, room, my_uid: req.user.id });
});

app.post('/api/ludo/room/roll', requireAuth, async (req, res) => {
    const code = String(req.body.room_code || '').trim().toUpperCase();
    const room = (DB.data.ludo_rooms || []).find(r => r.code === code && r.status === 'playing');
    if (!room) return res.json({ success: false, message: 'Active room not found.' });
    const cur = room.players[room.turn_idx];
    if (!cur || cur.uid !== req.user.id) return res.json({ success: false, message: 'Not your turn!' });
    if (room.phase !== 'roll') return res.json({ success: false, message: 'Tap a glowing pawn to move first!' });

    const roll = Math.floor(Math.random() * 6) + 1;
    room.dice = roll;
    const valid = ludoGetValidTokens(room.tokens[cur.color], roll);

    if (valid.length === 0) {
        room.last_event = `UID ${cur.uid} rolled ${roll} — No valid moves!`;
        const nextIdx = (room.turn_idx + 1) % room.players.length;
        if (nextIdx === 0) room.turns_left = Math.max(0, (room.turns_left || 1) - 1);
        room.turn_idx = nextIdx;
        if (room.turns_left <= 0) {
            const ranked = [...room.players].sort((a, b) => (room.scores[b.color] || 0) - (room.scores[a.color] || 0));
            ludoFinishOnlineRoom(room, ranked[0].color);
        }
    } else if (valid.length === 1) {
        ludoApplyMove(room, cur.color, valid[0].id, roll);
    } else {
        room.phase = 'move';
        room.last_event = `UID ${cur.uid} rolled ${roll}! Tap a glowing ${cur.color.toUpperCase()} pawn.`;
    }
    room.updated_at = Date.now();
    DB.save();
    res.json({ success: true, room });
});

app.post('/api/ludo/room/move', requireAuth, async (req, res) => {
    const code = String(req.body.room_code || '').trim().toUpperCase();
    const tokenId = parseInt(req.body.token_id, 10);
    const room = (DB.data.ludo_rooms || []).find(r => r.code === code && r.status === 'playing');
    if (!room) return res.json({ success: false, message: 'Active room not found.' });
    const cur = room.players[room.turn_idx];
    if (!cur || cur.uid !== req.user.id) return res.json({ success: false, message: 'Not your turn!' });
    if (room.phase !== 'move') return res.json({ success: false, message: 'Roll the dice first!' });

    const valid = ludoGetValidTokens(room.tokens[cur.color], room.dice);
    if (!valid.some(t => t.id === tokenId)) {
        return res.json({ success: false, message: 'Invalid pawn selected!' });
    }
    ludoApplyMove(room, cur.color, tokenId, room.dice);
    DB.save();
    res.json({ success: true, room });
});

// ========================================================
// 24/7 VIP SUPPORT CHATBOT & LIVE ADMIN SUPPORT INBOX
// ========================================================
function generateSupportBotReply(msgText) {
    const t = String(msgText || '').toLowerCase();
    if (t.includes('deposit') || t.includes('recharge') || t.includes('utr') || t.includes('upi') || t.includes('pay')) {
        return '💳 Deposit Help: Deposit page par amount select karke UPI QR/ID par pay karein aur 12-digit UTR submit karein. Admin 2–5 min me approve kar denge! Agar UTR already submit kar diya hai toh yahan apna UTR likh dein — Admin directly check kar lenge.';
    }
    if (t.includes('withdraw') || t.includes('nikal') || t.includes('bank') || t.includes('payout')) {
        return '💸 Withdrawal Help: Minimum withdrawal ₹110 hai (24/7 active). Withdraw page me apna Bank Card / UPI / USDT add karke request submit karein — Admin verify karke 1–24 hours me payout kar dete hain!';
    }
    if (t.includes('gift') || t.includes('code') || t.includes('bonus')) {
        return '🎁 Gift & Bonus Help: Account → 🎁 Gifts me welcome code "ASG50" daal kar ₹50 instant bonus paayein! Saath hi First Deposit par extra ₹10,000 tak bonus aur Invite Wheel par ₹500 tak jeet sakte hain.';
    }
    if (t.includes('ludo') || t.includes('friend') || t.includes('uid')) {
        return '🎲 Ludo Friends Help: Ludo Cash → "🌐 Friends UID" tab me apna UID share karein, dost ka UID daal kar "+ Add Friend" karein, aur 2P ya 4P Online Room bana kar saath khelein!';
    }
    if (t.includes('otp') || t.includes('password') || t.includes('login') || t.includes('forgot')) {
        return '🔐 Account & OTP Help: Login screen par "Forgot password" se apne registered Gmail par OTP mangwa kar password reset kar sakte hain. Kisi issue par Admin yahan aapki help karenge!';
    }
    return '🤖 Namaste! Aapka message ASGames Admin Support team ko bhej diya gaya hai. Humare Admin jaldi hi yahin par aapko live reply karenge! (Quick help ke liye Deposit, Withdraw, Gift Code ya Ludo likhein)';
}

app.get('/api/chat/messages', async (req, res) => {
    if (!Array.isArray(DB.data.support_messages)) DB.data.support_messages = [];
    const user = await getUserFromToken(req);
    const sessionId = String(req.query.session_id || '').trim();
    const threadId = user ? `u_${user.id}` : (sessionId ? `g_${sessionId}` : '');
    if (!threadId) return res.json({ success: true, messages: [] });

    const msgs = DB.data.support_messages
        .filter(m => m.thread_id === threadId)
        .slice(-60);
    res.json({ success: true, thread_id: threadId, messages: msgs });
});

app.post('/api/chat/send', async (req, res) => {
    try {
        if (!Array.isArray(DB.data.support_messages)) DB.data.support_messages = [];
        const user = await getUserFromToken(req);
        const sessionId = String(req.body.session_id || '').trim();
        const text = String(req.body.message || '').trim().slice(0, 600);
        if (!text) return res.json({ success: false, message: 'Message cannot be empty.' });

        const threadId = user ? `u_${user.id}` : `g_${sessionId || Date.now()}`;
        const label = user ? `UID ${user.id} (${user.phone})` : `Guest (${sessionId.slice(-6) || 'Web'})`;
        const nowIso = new Date().toISOString();

        DB.data.support_messages.push({
            id: 'MSG' + Date.now() + Math.floor(Math.random() * 999),
            thread_id: threadId,
            user_id: user ? user.id : null,
            phone: user ? user.phone : 'Guest',
            label,
            sender: 'user',
            text,
            read_by_admin: false,
            created_at: nowIso
        });

        // Instant Bot Auto-Reply (only if admin hasn't replied in last 60s so bot doesn't interrupt live admin chat)
        const recentAdmin = DB.data.support_messages
            .filter(m => m.thread_id === threadId && m.sender === 'admin')
            .slice(-1)[0];
        const adminActiveRecently = recentAdmin && (Date.now() - new Date(recentAdmin.created_at).getTime() < 60000);

        if (!adminActiveRecently) {
            DB.data.support_messages.push({
                id: 'BOT' + Date.now() + Math.floor(Math.random() * 999),
                thread_id: threadId,
                user_id: user ? user.id : null,
                phone: user ? user.phone : 'Guest',
                label,
                sender: 'bot',
                text: generateSupportBotReply(text),
                read_by_admin: true,
                created_at: new Date(Date.now() + 200).toISOString()
            });
        }

        if (DB.data.support_messages.length > 500) {
            DB.data.support_messages = DB.data.support_messages.slice(-500);
        }
        DB.save();

        const msgs = DB.data.support_messages.filter(m => m.thread_id === threadId).slice(-60);
        res.json({ success: true, thread_id: threadId, messages: msgs });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.get('/api/admin/chats', requireAdmin, async (req, res) => {
    if (!Array.isArray(DB.data.support_messages)) DB.data.support_messages = [];
    const map = new Map();
    for (const m of DB.data.support_messages) {
        if (!map.has(m.thread_id)) {
            map.set(m.thread_id, {
                thread_id: m.thread_id,
                user_id: m.user_id,
                phone: m.phone || 'Guest',
                label: m.label || m.thread_id,
                unread_count: 0,
                last_message: '',
                last_time: m.created_at,
                messages: []
            });
        }
        const th = map.get(m.thread_id);
        th.messages.push(m);
        th.last_message = m.text;
        th.last_time = m.created_at;
        if (m.sender === 'user' && !m.read_by_admin) th.unread_count++;
    }
    const threads = Array.from(map.values()).sort((a, b) => String(b.last_time).localeCompare(String(a.last_time)));
    const totalUnread = threads.reduce((acc, t) => acc + t.unread_count, 0);
    res.json({ success: true, total_unread: totalUnread, threads });
});

app.post('/api/admin/chats/reply', requireAdmin, async (req, res) => {
    try {
        if (!Array.isArray(DB.data.support_messages)) DB.data.support_messages = [];
        const thread_id = String(req.body.thread_id || '').trim();
        const text = String(req.body.message || '').trim().slice(0, 800);
        if (!thread_id || !text) return res.json({ success: false, message: 'Thread & reply message required.' });

        let label = thread_id;
        let user_id = null;
        let phone = 'Guest';
        DB.data.support_messages.forEach(m => {
            if (m.thread_id === thread_id) {
                m.read_by_admin = true;
                label = m.label || label;
                if (m.user_id) user_id = m.user_id;
                if (m.phone) phone = m.phone;
            }
        });

        DB.data.support_messages.push({
            id: 'ADM' + Date.now() + Math.floor(Math.random() * 999),
            thread_id,
            user_id,
            phone,
            label,
            sender: 'admin',
            text,
            read_by_admin: true,
            created_at: new Date().toISOString()
        });
        DB.save();

        const msgs = DB.data.support_messages.filter(m => m.thread_id === thread_id).slice(-80);
        res.json({ success: true, message: 'Reply sent to player!', messages: msgs });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ========================================================
// UNIFIED PLAYER GAME HISTORY (ALL GAMES: WINGO, AVIATOR, MINES, K3, LUDO)
// ========================================================
app.post('/api/game/log-history', requireAuth, async (req, res) => {
    try {
        if (!Array.isArray(DB.data.game_history)) DB.data.game_history = [];
        const id = String(req.body.id || ('GH' + Date.now() + Math.floor(Math.random() * 999)));
        const game = String(req.body.game || 'Game').slice(0, 40);
        const detail = String(req.body.detail || '').slice(0, 140);
        const bet_amount = parseFloat(req.body.bet_amount || 0) || 0;
        const win_amount = parseFloat(req.body.win_amount || 0) || 0;
        const status = String(req.body.status || 'Pending');
        const created_at = req.body.created_at || new Date().toISOString();

        const existing = DB.data.game_history.find(h => h.id === id && h.user_id === req.user.id);
        if (existing) {
            existing.status = status;
            existing.win_amount = win_amount;
            if (detail) existing.detail = detail;
        } else {
            DB.data.game_history.push({
                id,
                user_id: req.user.id,
                game,
                detail,
                bet_amount,
                win_amount,
                status,
                created_at
            });
            if (DB.data.game_history.length > 800) DB.data.game_history = DB.data.game_history.slice(-800);
        }
        DB.save();
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.get('/api/game/my-history', requireAuth, async (req, res) => {
    try {
        if (!Array.isArray(DB.data.game_history)) DB.data.game_history = [];
        const uid = Number(req.user.id);
        const altUid = uid < 100000 ? uid + 100000 : uid - 100000;
        const matchUser = (x) => Number(x.user_id) === uid || Number(x.user_id) === altUid;

        const unified = DB.data.game_history.filter(matchUser);
        const seen = new Set(unified.map(h => String(h.id)));

        // Also include any server-side Win Go bets not already in game_history
        const wingoBets = (DB.data.bets || []).filter(b => matchUser(b) && !seen.has(String(b.id))).map(b => ({
            id: b.id,
            user_id: uid,
            game: 'Win Go',
            detail: `Period #${b.period_id || b.period || ''} • ${String(b.select_value || b.select_val || '').toUpperCase()}`,
            bet_amount: parseFloat(b.amount || 0),
            win_amount: parseFloat(b.payout || b.win_amount || 0),
            status: String(b.status || '').toLowerCase() === 'won' ? 'Won' : (String(b.status || '').toLowerCase() === 'lost' ? 'Lost' : 'Pending'),
            created_at: b.created_at || new Date().toISOString()
        }));

        const combined = [...unified, ...wingoBets]
            .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
            .slice(0, 80);

        res.json({ success: true, history: combined });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ========================================================
// AS KING / MATKA NUMBER GAME (FARIDABAD, GAZIABAD, GALI, DISAWAR + LOCAL AS GAMES)
// Payouts: Single Digit / Haruf (Andar/Bahar) = 1 ka 9 (9x), Jodi (00-99) = 1 ka 90 (90x)
// ========================================================
let _lastKingNetFetchTs = 0;

function ensureKingStore() {
    if (!DB.data.king_markets) {
        DB.data.king_markets = {
            asgames:   { key: 'asgames',   name: 'AS GAMES',  time: 'Live 24/7', is_local: true,  old_num: '47', new_num: '83', updated_at: '' },
            faridabad: { key: 'faridabad', name: 'FARIDABAD', time: '06:15 PM',  is_local: false, old_num: '62', new_num: '--', updated_at: '' },
            gaziabad:  { key: 'gaziabad',  name: 'GAZIABAD',  time: '08:40 PM',  is_local: false, old_num: '19', new_num: '--', updated_at: '' },
            gali:      { key: 'gali',      name: 'GALI',      time: '11:30 PM',  is_local: false, old_num: '74', new_num: '--', updated_at: '' },
            disawar:   { key: 'disawar',   name: 'DISAWAR',   time: '05:10 AM',  is_local: false, old_num: '35', new_num: '--', updated_at: '' }
        };
    }
    if (!Array.isArray(DB.data.king_bets)) DB.data.king_bets = [];
    if (!Array.isArray(DB.data.game_history)) DB.data.game_history = [];
}

function settleKingMarketBets(marketKey, resultNumStr) {
    ensureKingStore();
    const num2 = String(resultNumStr).padStart(2, '0').slice(-2);
    const andarDigit = num2[0];
    const baharDigit = num2[1];

    let settledCount = 0;
    let totalPayout = 0;

    for (const bet of DB.data.king_bets) {
        if (bet.market === marketKey && bet.status === 'pending') {
            let isWin = false;
            let mult = 9;
            if (bet.bet_type === 'andar') {
                isWin = (String(bet.number) === andarDigit);
                mult = 9;
            } else if (bet.bet_type === 'bahar') {
                isWin = (String(bet.number) === baharDigit);
                mult = 9;
            } else if (bet.bet_type === 'jodi') {
                isWin = (String(bet.number).padStart(2, '0') === num2);
                mult = 90;
            }

            settledCount++;
            if (isWin) {
                const winAmt = Math.round(bet.amount * mult * 100) / 100;
                bet.status = 'won';
                bet.win_amount = winAmt;
                bet.result_num = num2;
                totalPayout += winAmt;

                const u = DB.data.users.find(x => x.id === bet.user_id);
                if (u) u.balance = Math.round((u.balance + winAmt) * 100) / 100;

                DB.data.transactions.push({
                    id: 'KNG' + Date.now() + Math.floor(Math.random() * 999),
                    user_id: bet.user_id,
                    type: 'win',
                    amount: winAmt,
                    status: 'approved',
                    details: `AS King (${marketKey.toUpperCase()} #${num2}) Win`,
                    created_at: new Date().toISOString()
                });
            } else {
                bet.status = 'lost';
                bet.win_amount = 0;
                bet.result_num = num2;
            }

            const gh = DB.data.game_history.find(h => h.id === bet.id && h.user_id === bet.user_id);
            if (gh) {
                gh.status = isWin ? 'Won' : 'Lost';
                gh.win_amount = bet.win_amount;
                gh.detail = `${marketKey.toUpperCase()} • ${bet.bet_type.toUpperCase()} ${bet.number} (Result: ${num2})`;
            }
        }
    }
    return { settledCount, totalPayout };
}

async function fetchLiveKingResultsFromNet(force = false) {
    ensureKingStore();
    if (!force && Date.now() - _lastKingNetFetchTs < 10 * 60 * 1000) {
        return { fetched: false, updated: [] };
    }
    _lastKingNetFetchTs = Date.now();
    const sources = [
        'https://satta-king-fast.com/',
        'https://sattaking-up.com/'
    ];
    const updated = [];
    for (const url of sources) {
        try {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 4500);
            const resp = await fetch(url, {
                signal: ctrl.signal,
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
            });
            clearTimeout(timer);
            if (!resp.ok) continue;
            const html = await resp.text();
            const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
                             .replace(/<style[\s\S]*?<\/style>/gi, ' ')
                             .replace(/<[^>]+>/g, ' ')
                             .replace(/\s+/g, ' ');

            const patterns = [
                { key: 'faridabad', re: /FARIDABAD[\s\S]{0,120}?(\b\d{2}\b)[\s\S]{0,40}?(\b\d{2}\b|--|XX)/i },
                { key: 'gaziabad',  re: /GHA?ZIABAD[\s\S]{0,120}?(\b\d{2}\b)[\s\S]{0,40}?(\b\d{2}\b|--|XX)/i },
                { key: 'gali',      re: /\bGALI\b[\s\S]{0,120}?(\b\d{2}\b)[\s\S]{0,40}?(\b\d{2}\b|--|XX)/i },
                { key: 'disawar',   re: /D[EI]SAWAR[\s\S]{0,120}?(\b\d{2}\b)[\s\S]{0,40}?(\b\d{2}\b|--|XX)/i }
            ];

            for (const p of patterns) {
                const m = text.match(p.re);
                if (m) {
                    const oldN = m[1];
                    const newN = /^\d{2}$/.test(m[2]) ? m[2] : '--';
                    const mk = DB.data.king_markets[p.key];
                    if (mk) {
                        const prevNew = mk.new_num;
                        if (/^\d{2}$/.test(oldN)) mk.old_num = oldN;
                        mk.new_num = newN;
                        mk.updated_at = new Date().toISOString();
                        updated.push(`${p.key.toUpperCase()}:${oldN}->${newN}`);
                        if (/^\d{2}$/.test(newN) && newN !== prevNew) {
                            settleKingMarketBets(p.key, newN);
                        }
                    }
                }
            }
            if (updated.length > 0) {
                DB.save();
                return { fetched: true, source: url, updated };
            }
        } catch (e) {}
    }
    return { fetched: false, updated };
}

app.get('/api/king/markets', async (req, res) => {
    ensureKingStore();
    // Non-blocking background refresh if stale
    fetchLiveKingResultsFromNet(false).catch(() => {});
    const user = await getUserFromToken(req);
    const myBets = user
        ? DB.data.king_bets.filter(b => b.user_id === user.id).slice(-40).reverse()
        : [];
    res.json({
        success: true,
        markets: Object.values(DB.data.king_markets),
        my_bets: myBets
    });
});

app.post('/api/king/bet', requireAuth, async (req, res) => {
    try {
        ensureKingStore();
        const market = String(req.body.market || 'asgames').toLowerCase();
        const bet_type = String(req.body.bet_type || 'bahar').toLowerCase(); // 'andar' | 'bahar' | 'jodi'
        const rawNum = String(req.body.number ?? '').trim();
        const amount = parseFloat(req.body.amount || 0);

        if (!DB.data.king_markets[market]) {
            return res.json({ success: false, message: 'Invalid market selected.' });
        }
        if (!['andar', 'bahar', 'jodi'].includes(bet_type)) {
            return res.json({ success: false, message: 'Invalid bet type.' });
        }
        if (!amount || amount < 10) {
            return res.json({ success: false, message: 'Minimum bet amount is ₹10.' });
        }
        const cleanNum = bet_type === 'jodi'
            ? rawNum.padStart(2, '0')
            : rawNum;
        if (bet_type === 'jodi' && !/^\d{2}$/.test(cleanNum)) {
            return res.json({ success: false, message: 'Enter a valid 2-digit Jodi number (00 to 99).' });
        }
        if ((bet_type === 'andar' || bet_type === 'bahar') && !/^\d$/.test(cleanNum)) {
            return res.json({ success: false, message: 'Select a valid single digit (0 to 9).' });
        }
        if (req.user.balance < amount) {
            return res.json({ success: false, message: 'Insufficient balance! Please deposit.' });
        }

        await DB.run('UPDATE users SET balance = balance - ? WHERE id = ?', [amount, req.user.id]);
        const updated = await DB.get('SELECT balance FROM users WHERE id = ?', [req.user.id]);
        const finalBal = updated ? updated.balance : 0;

        const betId = 'KB' + Date.now() + Math.floor(Math.random() * 999);
        const nowIso = new Date().toISOString();
        const mult = bet_type === 'jodi' ? 90 : 9;
        const betObj = {
            id: betId,
            user_id: req.user.id,
            phone: req.user.phone,
            market,
            bet_type,
            number: cleanNum,
            amount,
            multiplier: mult,
            win_amount: 0,
            result_num: '',
            status: 'pending',
            created_at: nowIso
        };
        DB.data.king_bets.push(betObj);
        if (DB.data.king_bets.length > 500) DB.data.king_bets = DB.data.king_bets.slice(-500);

        DB.data.game_history.push({
            id: betId,
            user_id: req.user.id,
            game: 'AS King',
            detail: `${market.toUpperCase()} • ${bet_type.toUpperCase()} ${cleanNum} (${mult}x)`,
            bet_amount: amount,
            win_amount: 0,
            status: 'Pending',
            created_at: nowIso
        });
        DB.save();

        res.json({
            success: true,
            balance: finalBal,
            bet: betObj,
            message: `🎯 Bet ₹${amount} placed on ${market.toUpperCase()} (${bet_type.toUpperCase()} ${cleanNum}) — Win ₹${amount * mult}!`
        });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/admin/king/declare', requireAdmin, async (req, res) => {
    try {
        ensureKingStore();
        const market = String(req.body.market || 'asgames').toLowerCase();
        const raw = String(req.body.result_num ?? '').trim();
        if (!DB.data.king_markets[market]) {
            return res.json({ success: false, message: 'Invalid market.' });
        }
        if (!/^\d{1,2}$/.test(raw)) {
            return res.json({ success: false, message: 'Enter a valid 2-digit result number (00 - 99).' });
        }
        const num2 = raw.padStart(2, '0');
        const mk = DB.data.king_markets[market];
        if (/^\d{2}$/.test(mk.new_num)) mk.old_num = mk.new_num;
        mk.new_num = num2;
        mk.updated_at = new Date().toISOString();

        const { settledCount, totalPayout } = settleKingMarketBets(market, num2);
        DB.save();

        res.json({
            success: true,
            markets: Object.values(DB.data.king_markets),
            message: `👑 ${mk.name} Result Declared: ${num2}! Settled ${settledCount} bets (Total Payout: ₹${totalPayout.toFixed(2)}).`
        });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/admin/king/fetch-net', requireAdmin, async (req, res) => {
    const r = await fetchLiveKingResultsFromNet(true);
    res.json({
        success: true,
        fetched: r.fetched,
        markets: Object.values(DB.data.king_markets),
        message: r.fetched
            ? `🌐 Live Net Results Synced: ${r.updated.join(', ')}`
            : 'Live net feed busy — showing latest cached results. You can also declare any number manually below!'
    });
});

// PythonAnywhere Central Sync Management APIs
app.get('/api/admin/sync-status', requireAdmin, async (req, res) => {
    try {
        const url = DB.getPythonAnywhereUrl();
        res.json({
            success: true,
            pythonanywhere_url: url,
            is_connected: Boolean(url),
            users_count: DB.data.users.length,
            transactions_count: DB.data.transactions.length
        });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/admin/set-pythonanywhere', requireAdmin, async (req, res) => {
    try {
        const { url } = req.body;
        const cleanUrl = String(url || '').trim().replace(/\/+$/, '');
        await DB.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['pythonanywhere_url', cleanUrl]);

        let syncSuccess = false;
        let msg = 'PythonAnywhere URL saved.';
        if (cleanUrl) {
            const pullOk = await DB.syncPullFromPythonAnywhere();
            const pushOk = await DB.syncPushToPythonAnywhere();
            syncSuccess = pullOk || pushOk;
            msg = syncSuccess ? 'Connected & Synced with PythonAnywhere successfully!' : 'URL saved, but could not connect. Please check URL.';
        }
        res.json({ success: true, message: msg, syncSuccess, pythonanywhere_url: cleanUrl });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/admin/sync-now', requireAdmin, async (req, res) => {
    try {
        const pullOk = await DB.syncPullFromPythonAnywhere();
        const pushOk = await DB.syncPushToPythonAnywhere();
        if (pullOk || pushOk) {
            res.json({ success: true, message: 'Data synced with PythonAnywhere successfully!' });
        } else {
            res.json({ success: false, message: 'Sync failed. Please check PythonAnywhere URL & server status.' });
        }
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// Admin Panel Page
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// Root & SPA Fallback
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`ASGames Full-Stack Server running on port ${PORT}`);

    // Auto-sync with PythonAnywhere on boot and periodically
    setTimeout(async () => {
        if (DB.getPythonAnywhereUrl()) {
            console.log('[PythonAnywhere] Initializing startup sync with:', DB.getPythonAnywhereUrl());
            await DB.syncPullFromPythonAnywhere();
            await DB.syncPushToPythonAnywhere();
        }
    }, 2000);

    setInterval(async () => {
        if (DB.getPythonAnywhereUrl()) {
            if (DB._dirty) {
                await DB.syncPushToPythonAnywhere();
            }
            await DB.syncPullFromPythonAnywhere();
        }
    }, 12000);
});
