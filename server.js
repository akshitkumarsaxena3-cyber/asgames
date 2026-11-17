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

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
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

app.get('/api/auth/me', requireAuth, async (req, res) => {
    res.json({
        success: true,
        user: {
            id: req.user.id,
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
        const { period_id, select_type, select_value, amount } = req.body;
        const betAmount = parseFloat(amount);

        if (isLocked || period_id !== currentPeriod) {
            return res.json({ success: false, message: 'Betting is locked for current round!' });
        }
        if (!betAmount || betAmount < 1) {
            return res.json({ success: false, message: 'Invalid bet amount' });
        }
        if (req.user.balance < betAmount) {
            return res.json({ success: false, message: 'Insufficient balance! Please recharge.' });
        }

        // Deduct balance
        await DB.run('UPDATE users SET balance = balance - ? WHERE id = ?', [betAmount, req.user.id]);

        // Record bet
        const betId = 'BET' + Date.now() + Math.floor(Math.random() * 999);
        await DB.run(`INSERT INTO bets (id, user_id, period_id, game_mode, select_type, select_value, amount, status) VALUES (?, ?, ?, '30s', ?, ?, ?, 'pending')`,
            [betId, req.user.id, period_id, select_type, String(select_value), betAmount]);

        // Cache for admin live board
        currentRoundBets.push({
            id: betId,
            user_phone: req.user.phone,
            select_type,
            select_value: String(select_value),
            amount: betAmount
        });

        res.json({ success: true, message: `Bet ₹${betAmount} placed successfully!`, newBalance: req.user.balance - betAmount });
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

        // Deduct & Hold balance
        await DB.run('UPDATE users SET balance = balance - ? WHERE id = ?', [withdrawAmt, req.user.id]);

        const txId = 'WTH' + Date.now();
        await DB.run(`INSERT INTO transactions (id, user_id, type, amount, status, details) VALUES (?, ?, ?, ?, ?, ?)`,
            [txId, req.user.id, 'withdraw', withdrawAmt, 'pending', bank_info || 'UPI / Bank Transfer']);

        res.json({ success: true, message: 'Withdrawal requested! Processing within 1-24 hours.' });
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
            aviatorMode: (DB.data.settings && DB.data.settings.aviator_mode) || 'random',
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
            aviator_mode: s.aviator_mode || 'random',
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
            await DB.syncPullFromPythonAnywhere();
            await DB.syncPushToPythonAnywhere();
        }
    }, 12000);
});
