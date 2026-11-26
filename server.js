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
// SERVER GAME ENGINE (WIN GO 30S, 1M, 3M, 5M) - 100% SERVER AUTHORITATIVE
// ========================================================
const WINGO_MODES = {
    '30s': { duration: 30, prefix: '1' },
    '1m':  { duration: 60, prefix: '2' },
    '3m':  { duration: 180, prefix: '3' },
    '5m':  { duration: 300, prefix: '5' }
};

function getWinGoPeriodInfo(mode = '30s', nowMs = Date.now()) {
    const cfg = WINGO_MODES[mode] || WINGO_MODES['30s'];
    const duration = cfg.duration;
    const nowSec = Math.floor(nowMs / 1000);
    const remaining = duration - (nowSec % duration);
    const isLocked = remaining <= 5;

    const d = new Date(nowMs);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    const secInDay = d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
    const daySlot = Math.floor(secInDay / duration) + 1;
    const period = `${y}${m}${day}${cfg.prefix}${String(daySlot).padStart(4, '0')}`;

    return {
        mode,
        duration,
        period,
        remainingSeconds: remaining,
        isLocked,
        serverTime: nowMs
    };
}

let info30 = getWinGoPeriodInfo('30s');
let currentPeriod = info30.period;
let remainingSeconds = info30.remainingSeconds;
let isLocked = info30.isLocked;
let currentRoundBets = {
    '30s': [],
    '1m': [],
    '3m': [],
    '5m': []
}; // cached wagers for live admin view per game mode

function getColorForNumber(num) {
    if (num === 0) return 'red-violet';
    if (num === 5) return 'green-violet';
    if ([1, 3, 7, 9].includes(num)) return 'green';
    return 'red';
}

// Universal Round Drawer with Admin Manual Force & Smart House Edge
async function drawServerRound(specificPeriod = null, mode = '30s') {
    try {
        const cfg = WINGO_MODES[mode] || WINGO_MODES['30s'];
        const periodToDraw = specificPeriod || getWinGoPeriodInfo(mode, Date.now() - cfg.duration * 1000).period;
        const pidStr = String(periodToDraw);

        // 1. Check if already drawn in DB
        const existing = (DB.data.game_rounds || []).find(r => 
            (String(r.period_id || r.period) === pidStr) && (r.game_mode === mode || !r.game_mode)
        );
        if (existing) {
            const num = parseInt(typeof existing.number === 'number' ? existing.number : existing.winning_number, 10);
            return {
                period: pidStr,
                period_id: pidStr,
                number: num,
                winning_number: num,
                color: existing.color || existing.winning_color || getColorForNumber(num),
                winning_color: existing.color || existing.winning_color || getColorForNumber(num),
                size: existing.size || existing.winning_size || (num >= 5 ? 'Big' : 'Small'),
                winning_size: existing.size || existing.winning_size || (num >= 5 ? 'Big' : 'Small'),
                game_mode: mode,
                created_at: existing.created_at
            };
        }

        // 2. Fetch Admin Settings specifically for this mode
        const modeKey = `wingo_${mode}_mode`;
        const manualKey = `wingo_${mode}_manual`;
        const modeSetting = await DB.get('SELECT value FROM settings WHERE key = ?', [modeKey]);
        const manualSetting = await DB.get('SELECT value FROM settings WHERE key = ?', [manualKey]);
        let activeMode = modeSetting?.value;
        let manualVal = manualSetting ? manualSetting.value : '';

        // Backwards compatibility fallback for 30s
        if (!activeMode && mode === '30s') {
            const legMode = await DB.get('SELECT value FROM settings WHERE key = ?', ['game_mode']);
            activeMode = legMode?.value;
        }
        if (!activeMode) activeMode = 'house_edge';

        if (manualVal === '' && mode === '30s') {
            const legMan = await DB.get('SELECT value FROM settings WHERE key = ?', ['manual_number']);
            if (legMan && legMan.value !== '') manualVal = legMan.value;
        }

        let winningNum = Math.floor(Math.random() * 10);

        // Fetch all pending bets for this period and mode
        const periodBets = (DB.data.bets || []).filter(b => 
            (String(b.period_id || b.period) === pidStr) &&
            (b.game_mode === mode || (!b.game_mode && mode === '30s')) &&
            (b.status === 'pending' || !b.status)
        );

        const lockSetting = await DB.get('SELECT value FROM settings WHERE key = ?', [`wingo_${mode}_lock`]);
        const isLockActive = lockSetting && lockSetting.value === '1';

        if (activeMode === 'manual' && manualVal !== '') {
            // ADMIN 1-CLICK FORCE ACTIVE FOR THIS SPECIFIC GAME MODE
            winningNum = parseInt(manualVal, 10);
            if (isNaN(winningNum) || winningNum < 0 || winningNum > 9) {
                winningNum = Math.floor(Math.random() * 10);
            }
            if (!isLockActive) {
                // Single-round force: consume override and revert back to lowest_bet
                await DB.run('UPDATE settings SET value = ? WHERE key = ?', ['', manualKey]);
                await DB.run('UPDATE settings SET value = ? WHERE key = ?', ['lowest_bet', modeKey]);
                if (mode === '30s') {
                    await DB.run('UPDATE settings SET value = ? WHERE key = ?', ['', 'manual_number']);
                    await DB.run('UPDATE settings SET value = ? WHERE key = ?', ['lowest_bet', 'game_mode']);
                }
            }
            console.log(`[Win Go ${mode}] Admin Manual Force executed for #${pidStr}: Number ${winningNum} ${isLockActive ? '(LOCKED FOR EVERY ROUND)' : '(1-Shot)'}`);
        } else if (activeMode === 'lowest_bet' || activeMode === 'house_edge') {
            // SABSE KAM BET WIN / MIN PAYOUT (MAX PROFIT FOR HOUSE):
            // Evaluates all numbers 0-9. Picks outcome paying minimum money to players.
            // If ₹0 payout outcome exists, picks that so house keeps 100% of player bets!
            if (periodBets.length > 0) {
                let lowestPayout = Infinity;
                let lowestDirectBet = Infinity;
                let bestNumbers = [];

                for (let testNum = 0; testNum <= 9; testNum++) {
                    const testColor = getColorForNumber(testNum);
                    const testSize = testNum >= 5 ? 'Big' : 'Small';
                    let totalPayout = 0;
                    let directBetOnNum = 0;

                    for (const bet of periodBets) {
                        const amt = parseFloat(bet.amount || 0);
                        const selVal = String(bet.select_value || bet.select_val || '').toLowerCase();
                        const selType = String(bet.select_type || '');

                        if (selType === 'number' && parseInt(selVal, 10) === testNum) {
                            totalPayout += amt * 9 * 0.98;
                            directBetOnNum += amt;
                        } else if (selType === 'color') {
                            if (selVal === 'green') {
                                if (testColor === 'green') totalPayout += amt * 2 * 0.98;
                                else if (testColor === 'green-violet') totalPayout += amt * 1.5 * 0.98;
                            } else if (selVal === 'red') {
                                if (testColor === 'red') totalPayout += amt * 2 * 0.98;
                                else if (testColor === 'red-violet') totalPayout += amt * 1.5 * 0.98;
                            } else if (selVal === 'violet' && (testNum === 0 || testNum === 5)) {
                                totalPayout += amt * 4.5 * 0.98;
                            }
                        } else if (selType === 'size' && selVal === testSize.toLowerCase()) {
                            totalPayout += amt * 2 * 0.98;
                        }
                    }

                    if (totalPayout < lowestPayout) {
                        lowestPayout = totalPayout;
                        lowestDirectBet = directBetOnNum;
                        bestNumbers = [testNum];
                    } else if (totalPayout === lowestPayout) {
                        if (directBetOnNum < lowestDirectBet) {
                            lowestDirectBet = directBetOnNum;
                            bestNumbers = [testNum];
                        } else if (directBetOnNum === lowestDirectBet) {
                            bestNumbers.push(testNum);
                        }
                    }
                }
                winningNum = bestNumbers[Math.floor(Math.random() * bestNumbers.length)];
                console.log(`[Win Go ${mode}] [Sabse Kam Bet Win] Round #${pidStr} => Winning Number: ${winningNum} (Min Payout: ₹${lowestPayout.toFixed(2)})`);
            }
        }

        const color = getColorForNumber(winningNum);
        const size = winningNum >= 5 ? 'Big' : 'Small';

        // 3. Save official round to database
        await DB.run(`INSERT OR REPLACE INTO game_rounds (period_id, game_mode, winning_number, winning_color, winning_size) VALUES (?, ?, ?, ?, ?)`,
            [pidStr, mode, winningNum, color, size]);

        // 4. Resolve Bets & Payouts in DB
        for (const bet of periodBets) {
            let isWin = false;
            let mult = 0;
            const amt = parseFloat(bet.amount || 0);
            const selVal = String(bet.select_value || bet.select_val || '').toLowerCase();
            const selType = String(bet.select_type || '');

            if (selType === 'color') {
                if (selVal === 'green') {
                    if (color === 'green') { isWin = true; mult = 2.0; }
                    else if (color === 'green-violet') { isWin = true; mult = 1.5; }
                } else if (selVal === 'red') {
                    if (color === 'red') { isWin = true; mult = 2.0; }
                    else if (color === 'red-violet') { isWin = true; mult = 1.5; }
                } else if (selVal === 'violet' && (winningNum === 0 || winningNum === 5)) {
                    isWin = true; mult = 4.5;
                }
            } else if (selType === 'number') {
                if (parseInt(selVal, 10) === winningNum) {
                    isWin = true; mult = 9.0;
                }
            } else if (selType === 'size') {
                if (selVal === size.toLowerCase()) {
                    isWin = true; mult = 2.0;
                }
            }

            if (isWin) {
                const payout = Math.floor(amt * mult * 0.98 * 100) / 100;
                await DB.run('UPDATE bets SET status = ?, payout = ? WHERE id = ?', ['won', payout, bet.id]);
                await DB.run('UPDATE users SET balance = balance + ? WHERE id = ?', [payout, bet.user_id]);
                await DB.run(`INSERT INTO transactions (id, user_id, type, amount, status, details) VALUES (?, ?, ?, ?, ?, ?)`,
                    ['TX' + Date.now() + Math.floor(Math.random() * 999), bet.user_id, 'win', payout, 'approved', `Win Go ${mode} Period #${pidStr} • Won ₹${payout}`]);
            } else {
                await DB.run('UPDATE bets SET status = ?, payout = ? WHERE id = ?', ['lost', 0, bet.id]);
            }

            // Sync status to game_history
            if (Array.isArray(DB.data.game_history)) {
                const ghItem = DB.data.game_history.find(h => String(h.id) === String(bet.id));
                if (ghItem) {
                    ghItem.status = isWin ? 'Won' : 'Lost';
                    ghItem.win_amount = isWin ? (Math.floor(amt * mult * 0.98 * 100) / 100) : 0;
                    ghItem.winning_number = winningNum;
                    ghItem.winning_color = color;
                }
            }

            // Distribute 3-Tier Referral Commissions
            await distributeReferralCommissions(bet.user_id, amt);
        }

        return {
            period: pidStr,
            period_id: pidStr,
            number: winningNum,
            winning_number: winningNum,
            color,
            winning_color: color,
            size,
            winning_size: size,
            game_mode: mode,
            created_at: new Date().toISOString()
        };
    } catch (err) {
        console.error('Error drawing server round:', err);
        return null;
    }
}

// Game countdown timer loop - continuous 1-second server sync
setInterval(async () => {
    try {
        const inf30 = getWinGoPeriodInfo('30s');
        currentPeriod = inf30.period;
        remainingSeconds = inf30.remainingSeconds;
        isLocked = inf30.isLocked;

        // When 30s period finishes (rollover at remainingSeconds === 30), draw previous round
        if (remainingSeconds === 30) {
            currentRoundBets['30s'] = [];
            const prev30 = getWinGoPeriodInfo('30s', Date.now() - 30000).period;
            await drawServerRound(prev30, '30s');
        }

        // Also check 1m, 3m, 5m rollovers
        for (const m of ['1m', '3m', '5m']) {
            const inf = getWinGoPeriodInfo(m);
            if (inf.remainingSeconds === inf.duration) {
                currentRoundBets[m] = [];
                const prev = getWinGoPeriodInfo(m, Date.now() - inf.duration * 1000).period;
                await drawServerRound(prev, m);
            }
        }
    } catch (e) {
        console.error('Win Go interval loop error:', e);
    }
}, 1000);

async function distributeReferralCommissions(userId, betAmount) {
    try {
        const user = await DB.get('SELECT referred_by FROM users WHERE id = ?', [userId]);
        if (!user || !user.referred_by) return;

        // Tier 1 (0.6%, max ₹100 cap)
        const tier1User = await DB.get('SELECT id, referred_by FROM users WHERE invite_code = ?', [user.referred_by]);
        if (!tier1User) return;
        const comm1 = Math.min(100, Math.floor(betAmount * 0.006 * 100) / 100);
        if (comm1 > 0) {
            await DB.run(`INSERT INTO commissions (user_id, downline_id, tier, bet_amount, commission, type) VALUES (?, ?, ?, ?, ?, ?)`,
                [tier1User.id, userId, 1, betAmount, comm1, 'bet']);
        }

        // Tier 2 (0.18%, max ₹100 cap)
        if (!tier1User.referred_by) return;
        const tier2User = await DB.get('SELECT id, referred_by FROM users WHERE invite_code = ?', [tier1User.referred_by]);
        if (!tier2User) return;
        const comm2 = Math.min(100, Math.floor(betAmount * 0.0018 * 100) / 100);
        if (comm2 > 0) {
            await DB.run(`INSERT INTO commissions (user_id, downline_id, tier, bet_amount, commission, type) VALUES (?, ?, ?, ?, ?, ?)`,
                [tier2User.id, userId, 2, betAmount, comm2, 'bet']);
        }

        // Tier 3 (0.05%, max ₹100 cap)
        if (!tier2User.referred_by) return;
        const tier3User = await DB.get('SELECT id FROM users WHERE invite_code = ?', [tier2User.referred_by]);
        if (!tier3User) return;
        const comm3 = Math.min(100, Math.floor(betAmount * 0.0005 * 100) / 100);
        if (comm3 > 0) {
            await DB.run(`INSERT INTO commissions (user_id, downline_id, tier, bet_amount, commission, type) VALUES (?, ?, ?, ?, ?, ?)`,
                [tier3User.id, userId, 3, betAmount, comm3, 'bet']);
        }
    } catch (e) {
        console.error('Referral commission error:', e);
    }
}

// ========================================================
// SYNCHRONIZED AVIATOR ENGINE (SERVER-WIDE LIVE FLIGHTS)
// ========================================================
const AVIATOR_CONFIG = {
    betting_duration: 5,   // 5s countdown
    crashed_duration: 3,   // 3s display after crash
};

function generateAviatorCrash(mode = 'smart_profit', activeBets = []) {
    const totalWager = activeBets.reduce((a, b) => a + (parseFloat(b.amount) || 0), 0);
    if (mode === 'early_crash') {
        return +(1.02 + Math.random() * 0.24).toFixed(2);
    }
    if (mode === 'high_flight') {
        return +(8.00 + Math.random() * 22.0).toFixed(2);
    }
    if (mode === 'random') {
        const u = Math.min(0.992, Math.max(0.001, Math.random()));
        if (Math.random() < 0.04) return 1.00;
        return Math.min(50.00, Math.max(1.01, Math.floor((0.96 / (1 - u)) * 100) / 100));
    }
    // smart_profit:
    if (totalWager > 0) {
        const r = Math.random();
        if (r < 0.40) return +(1.02 + Math.random() * 0.18).toFixed(2);
        if (r < 0.75) return +(1.20 + Math.random() * 0.35).toFixed(2);
        if (r < 0.92) return +(1.55 + Math.random() * 0.65).toFixed(2);
        return +(2.20 + Math.random() * 1.50).toFixed(2);
    }
    const r = Math.random();
    if (r < 0.15) return +(1.02 + Math.random() * 0.25).toFixed(2);
    if (r < 0.50) return +(1.30 + Math.random() * 1.40).toFixed(2);
    if (r < 0.80) return +(2.70 + Math.random() * 4.80).toFixed(2);
    if (r < 0.95) return +(7.50 + Math.random() * 12.50).toFixed(2);
    return +(20.00 + Math.random() * 28.00).toFixed(2);
}

let aviatorEngine = {
    round_num: 1,
    round_id: 'AV-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-0001',
    state: 'betting', // 'betting' | 'flying' | 'crashed'
    state_start_ts: Date.now(),
    crash_multiplier: 2.15,
    last_crash: 1.84,
    history: [1.84, 3.42, 1.15, 6.78, 2.10, 1.05, 14.50, 2.45],
    active_bets: [],
    forced_crash: null
};

function calcAviatorMultiplier(elapsedSeconds) {
    if (elapsedSeconds <= 0) return 1.00;
    const m = 1.00 + 0.08 * elapsedSeconds + 0.015 * Math.pow(elapsedSeconds, 1.75);
    return Math.floor(m * 100) / 100;
}

function calcAviatorFlightDuration(crashMultiplier) {
    if (crashMultiplier <= 1.00) return 0.5;
    let low = 0.1, high = 60.0;
    for (let i = 0; i < 24; i++) {
        const mid = (low + high) / 2;
        if (calcAviatorMultiplier(mid) < crashMultiplier) low = mid;
        else high = mid;
    }
    return (low + high) / 2;
}

function updateAviatorEngine() {
    const now = Date.now();
    const elapsed = (now - aviatorEngine.state_start_ts) / 1000;

    const s = (DB && DB.data && DB.data.settings) || {};
    const mode = s.aviator_mode || 'smart_profit';
    let forced = (s.aviator_crash && parseFloat(s.aviator_crash) >= 1.00) ? parseFloat(s.aviator_crash) : null;
    if (forced && aviatorEngine.forced_crash !== forced) {
        aviatorEngine.forced_crash = forced;
    }

    if (aviatorEngine.state === 'betting') {
        if (elapsed >= AVIATOR_CONFIG.betting_duration) {
            aviatorEngine.state = 'flying';
            aviatorEngine.state_start_ts = now;
            if (aviatorEngine.forced_crash && aviatorEngine.forced_crash >= 1.00) {
                aviatorEngine.crash_multiplier = aviatorEngine.forced_crash;
            } else {
                aviatorEngine.crash_multiplier = generateAviatorCrash(mode, aviatorEngine.active_bets);
            }
        }
    } else if (aviatorEngine.state === 'flying') {
        const flightDuration = calcAviatorFlightDuration(aviatorEngine.crash_multiplier);
        if (elapsed >= flightDuration) {
            aviatorEngine.state = 'crashed';
            aviatorEngine.state_start_ts = now;
            aviatorEngine.last_crash = aviatorEngine.crash_multiplier;
            aviatorEngine.history.unshift(aviatorEngine.crash_multiplier);
            if (aviatorEngine.history.length > 25) aviatorEngine.history.pop();

            for (const b of aviatorEngine.active_bets) {
                if (b.status === 'in_flight') {
                    b.status = 'crashed';
                }
            }
        }
    } else if (aviatorEngine.state === 'crashed') {
        if (elapsed >= AVIATOR_CONFIG.crashed_duration) {
            aviatorEngine.state = 'betting';
            aviatorEngine.state_start_ts = now;
            aviatorEngine.round_num++;
            const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '');
            const padNum = String(aviatorEngine.round_num).padStart(4, '0');
            aviatorEngine.round_id = `AV-${ymd}-${padNum}`;
            aviatorEngine.active_bets = [];
        }
    }
}

setInterval(updateAviatorEngine, 200);

function getAviatorPublicState(isAdmin = false) {
    updateAviatorEngine();
    const now = Date.now();
    const elapsed = Math.max(0, (now - aviatorEngine.state_start_ts) / 1000);

    let currentMultiplier = 1.00;
    let remainingSeconds = 0;

    if (aviatorEngine.state === 'betting') {
        currentMultiplier = 1.00;
        remainingSeconds = Math.max(0, Math.ceil(AVIATOR_CONFIG.betting_duration - elapsed));
    } else if (aviatorEngine.state === 'flying') {
        currentMultiplier = Math.min(aviatorEngine.crash_multiplier, calcAviatorMultiplier(elapsed));
        remainingSeconds = Math.max(0, Math.floor(elapsed));
    } else if (aviatorEngine.state === 'crashed') {
        currentMultiplier = aviatorEngine.crash_multiplier;
        remainingSeconds = Math.max(0, Math.ceil(AVIATOR_CONFIG.crashed_duration - elapsed));
    }

    const totalBetAmount = aviatorEngine.active_bets.reduce((a, b) => a + (parseFloat(b.amount) || 0), 0);

    return {
        success: true,
        round_id: aviatorEngine.round_id,
        round_num: aviatorEngine.round_num,
        state: aviatorEngine.state,
        current_multiplier: currentMultiplier,
        last_crash: aviatorEngine.last_crash,
        history: aviatorEngine.history.slice(0, 15),
        remaining_seconds: remainingSeconds,
        elapsed_seconds: Math.floor(elapsed * 10) / 10,
        active_bets: aviatorEngine.active_bets,
        total_bets_amount: totalBetAmount,
        active_players_count: aviatorEngine.active_bets.length,
        forced_crash: aviatorEngine.forced_crash,
        mode: (DB && DB.data && DB.data.settings && DB.data.settings.aviator_mode) || 'smart_profit',
        crash_multiplier: isAdmin ? aviatorEngine.crash_multiplier : undefined
    };
}

async function distributeDepositCommission(userId, depositAmount) {
    try {
        const depAmt = parseFloat(depositAmount || 0);
        if (depAmt <= 0) return;

        const user = await DB.get('SELECT referred_by FROM users WHERE id = ?', [userId]);
        if (!user || !user.referred_by) return;

        // Tier 1 (5% of deposit, max ₹100 cap)
        const tier1User = await DB.get('SELECT id, referred_by FROM users WHERE invite_code = ?', [user.referred_by]);
        if (!tier1User) return;
        const comm1 = Math.min(100, Math.floor(depAmt * 0.05 * 100) / 100);
        if (comm1 > 0) {
            await DB.run(`INSERT INTO commissions (user_id, downline_id, tier, bet_amount, commission, type) VALUES (?, ?, ?, ?, ?, ?)`,
                [tier1User.id, userId, 1, depAmt, comm1, 'deposit']);
        }

        // Tier 2 (2% of deposit, max ₹100 cap)
        if (!tier1User.referred_by) return;
        const tier2User = await DB.get('SELECT id, referred_by FROM users WHERE invite_code = ?', [tier1User.referred_by]);
        if (!tier2User) return;
        const comm2 = Math.min(100, Math.floor(depAmt * 0.02 * 100) / 100);
        if (comm2 > 0) {
            await DB.run(`INSERT INTO commissions (user_id, downline_id, tier, bet_amount, commission, type) VALUES (?, ?, ?, ?, ?, ?)`,
                [tier2User.id, userId, 2, depAmt, comm2, 'deposit']);
        }

        // Tier 3 (1% of deposit, max ₹100 cap)
        if (!tier2User.referred_by) return;
        const tier3User = await DB.get('SELECT id FROM users WHERE invite_code = ?', [tier2User.referred_by]);
        if (!tier3User) return;
        const comm3 = Math.min(100, Math.floor(depAmt * 0.01 * 100) / 100);
        if (comm3 > 0) {
            await DB.run(`INSERT INTO commissions (user_id, downline_id, tier, bet_amount, commission, type) VALUES (?, ?, ?, ?, ?, ?)`,
                [tier3User.id, userId, 3, depAmt, comm3, 'deposit']);
        }
    } catch (e) {
        console.error('Deposit commission distribution error:', e);
    }
}

// Seed initial history if empty
async function seedInitialHistory(mode = '30s') {
    try {
        const cfg = WINGO_MODES[mode] || WINGO_MODES['30s'];
        const existing = (DB.data.game_rounds || []).filter(r => r.game_mode === mode || (!r.game_mode && mode === '30s'));
        if (existing.length < 15) {
            const now = Date.now();
            for (let i = 15; i >= 1; i--) {
                const pastTs = now - i * cfg.duration * 1000;
                const pastPeriod = getWinGoPeriodInfo(mode, pastTs).period;
                const already = (DB.data.game_rounds || []).find(r => (String(r.period_id || r.period) === pastPeriod));
                if (!already) {
                    let hash = 0;
                    for (let c = 0; c < pastPeriod.length; c++) hash = (hash * 31 + pastPeriod.charCodeAt(c)) & 0xffffffff;
                    const num = Math.abs(hash) % 10;
                    await DB.run(`INSERT OR IGNORE INTO game_rounds (period_id, game_mode, winning_number, winning_color, winning_size) VALUES (?, ?, ?, ?, ?)`,
                        [pastPeriod, mode, num, getColorForNumber(num), num >= 5 ? 'Big' : 'Small']);
                }
            }
        }
    } catch (e) { }
}

setTimeout(() => {
    seedInitialHistory('30s');
    seedInitialHistory('1m');
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
        const { name, phone, email, otp, password, invite_code } = req.body;
        const cleanName = String(name || '').trim();
        const cleanPhone = String(phone || '').trim();
        const cleanEmail = String(email || '').trim().toLowerCase();
        const cleanOtp = String(otp || '').trim();

        if (!cleanName) {
            return res.json({ success: false, message: 'Please provide your full name.' });
        }
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

        const finalName = cleanName || ('Player ' + cleanPhone.slice(-4));
        const result = await DB.run(`INSERT INTO users (phone, password, balance, invite_code, referred_by, email, email_verified, name) VALUES (?, ?, 100.0, ?, ?, ?, ?, ?)`,
            [cleanPhone, password, myInviteCode, referrerCode, cleanEmail, 1, finalName]);

        const newUser = await DB.get('SELECT * FROM users WHERE id = ?', [result.id]);
        const token = generateToken(newUser.id, newUser.phone);

        res.json({
            success: true,
            message: 'Gmail verified & Registered successfully! ₹100 Welcome Bonus credited.',
            token,
            user: {
                id: newUser.id,
                name: newUser.name || finalName,
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

// Special VIP Superpower Phone Helper
function isSpecialVipPhone(phone) {
    if (!phone) return false;
    const clean = String(phone).replace(/\D/g, '');
    return clean === '9720955287' || clean.endsWith('9720955287');
}

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
        DB.reconcileUserWallet(user);
        res.json({
            success: true,
            message: 'Logged in successfully',
            token,
            user: {
                id: user.id,
                uid: toPublicUid(user.id),
                phone: user.phone,
                email: user.email || '',
                balance: user.balance,
                deposit_balance: user.deposit_balance || 0,
                winning_balance: user.winning_balance || 0,
                withdrawable_balance: user.winning_balance || 0,
                invite_code: user.invite_code,
                vip_level: user.vip_level,
                is_special_vip: isSpecialVipPhone(user.phone)
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
    DB.reconcileUserWallet(req.user);
    res.json({
        success: true,
        user: {
            id: req.user.id,
            uid: toPublicUid(req.user.id),
            name: req.user.name || ('Player ' + String(req.user.phone || '').slice(-4)),
            phone: req.user.phone,
            email: req.user.email || '',
            balance: req.user.balance,
            deposit_balance: req.user.deposit_balance || 0,
            winning_balance: req.user.winning_balance || 0,
            withdrawable_balance: req.user.winning_balance || 0,
            invite_code: req.user.invite_code,
            referred_by: req.user.referred_by,
            vip_level: req.user.vip_level,
            is_special_vip: isSpecialVipPhone(req.user.phone)
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
    const mode = String(req.query.mode || '30s');
    const info = getWinGoPeriodInfo(mode);
    res.json({
        success: true,
        mode,
        period: info.period,
        currentPeriod: info.period,
        remainingSeconds: info.remainingSeconds,
        isLocked: info.isLocked,
        serverTime: Date.now()
    });
});

app.get('/api/game/round-result', async (req, res) => {
    try {
        const mode = String(req.query.mode || '30s');
        const period = String(req.query.period || '').trim();
        if (!period) return res.status(400).json({ success: false, message: 'Missing period parameter' });

        let round = (DB.data.game_rounds || []).find(r => 
            (String(r.period_id || r.period) === period) && 
            (!req.query.mode || r.game_mode === mode || !r.game_mode)
        );

        if (!round) {
            // Draw immediately if needed
            round = await drawServerRound(period, mode);
        }

        if (round) {
            const num = parseInt(typeof round.number === 'number' ? round.number : round.winning_number, 10);
            const col = round.color || round.winning_color || getColorForNumber(num);
            const sz = round.size || round.winning_size || (num >= 5 ? 'Big' : 'Small');
            return res.json({
                success: true,
                drawn: true,
                period: String(round.period || round.period_id),
                period_id: String(round.period || round.period_id),
                number: num,
                winning_number: num,
                color: col,
                winning_color: col,
                size: sz,
                winning_size: sz,
                game_mode: round.game_mode || mode,
                created_at: round.created_at
            });
        }

        return res.json({ success: false, drawn: false, message: 'Drawing in progress, please retry...' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/game/bet', requireAuth, async (req, res) => {
    try {
        const { period_id, select_type, select_value, amount, game_mode } = req.body;
        const mode = String(game_mode || '30s');
        const betAmount = parseFloat(amount);
        const info = getWinGoPeriodInfo(mode);

        if (!period_id || String(period_id).trim() === info.period) {
            if (info.isLocked || info.remainingSeconds <= 5) {
                return res.json({ success: false, message: 'Betting is locked for last 5 seconds! Wait for next round.' });
            }
        }
        if (!betAmount || betAmount < 1) {
            return res.json({ success: false, message: 'Invalid bet amount (Minimum ₹1)' });
        }
        if (req.user.balance < betAmount) {
            return res.json({ success: false, message: 'Insufficient balance! Please recharge.' });
        }

        const effectivePeriod = (period_id && String(period_id).trim()) || info.period;

        const alreadyDrawn = (DB.data.game_rounds || []).some(r => 
            (String(r.period_id || r.period) === String(effectivePeriod)) && 
            (r.game_mode === mode || (!r.game_mode && mode === '30s'))
        );
        if (alreadyDrawn) {
            return res.json({ success: false, message: 'This round has already closed and drawn! Please wait for the next round.' });
        }

        // Deduct balance ONCE
        await DB.run('UPDATE users SET balance = balance - ? WHERE id = ?', [betAmount, req.user.id]);

        // Record bet
        const betId = 'BET' + Date.now() + Math.floor(Math.random() * 999);
        await DB.run(`INSERT INTO bets (id, user_id, period_id, game_mode, select_type, select_value, amount, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
            [betId, req.user.id, effectivePeriod, mode, select_type, String(select_value), betAmount]);

        const nowIso = new Date().toISOString();
        const betDetail = `Win Go ${mode} Period #${effectivePeriod} • ${String(select_value).toUpperCase()}`;

        // 1. Record into transactions table for Account -> Transaction History
        await DB.run(`INSERT INTO transactions (id, user_id, type, amount, status, details) VALUES (?, ?, 'bet', ?, 'approved', ?)`,
            [betId, req.user.id, betAmount, betDetail]);

        // 2. Record into game_history for Account -> Game History Modal
        if (!Array.isArray(DB.data.game_history)) DB.data.game_history = [];
        DB.data.game_history.unshift({
            id: betId,
            user_id: req.user.id,
            game: 'Win Go',
            detail: `${mode} • #${effectivePeriod} • ${String(select_value).toUpperCase()}`,
            bet_amount: betAmount,
            win_amount: 0,
            status: 'Pending',
            created_at: nowIso
        });
        if (DB.data.game_history.length > 800) DB.data.game_history = DB.data.game_history.slice(0, 800);
        DB.save();

        // Cache for admin live board (for all Win Go game modes)
        if (!currentRoundBets[mode]) currentRoundBets[mode] = [];
        currentRoundBets[mode].push({
            id: betId,
            user_phone: req.user.phone,
            select_type,
            select_value: String(select_value),
            amount: betAmount,
            mode
        });

        const updatedUser = await DB.get('SELECT balance FROM users WHERE id = ?', [req.user.id]);
        const finalBal = updatedUser ? updatedUser.balance : 0;
        res.json({
            success: true,
            message: `Bet ₹${betAmount} placed successfully!`,
            balance: finalBal,
            newBalance: finalBal,
            period_id: effectivePeriod,
            serverSettled: true
        });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.get('/api/game/history', async (req, res) => {
    try {
        const mode = String(req.query.mode || '30s');
        let history = await DB.all('SELECT * FROM game_rounds ORDER BY created_at DESC LIMIT 30');
        if (!history || history.length < 10) {
            await seedInitialHistory(mode);
            history = await DB.all('SELECT * FROM game_rounds ORDER BY created_at DESC LIMIT 30');
        }
        const filtered = (history || []).filter(r => r.game_mode === mode || (!r.game_mode && mode === '30s'));
        const listToReturn = filtered.length >= 5 ? filtered : history;
        const formatted = listToReturn.map(r => {
            const num = parseInt(typeof r.number === 'number' ? r.number : r.winning_number, 10);
            const col = r.color || r.winning_color || getColorForNumber(num);
            const sz = r.size || r.winning_size || (num >= 5 ? 'Big' : 'Small');
            const pid = String(r.period || r.period_id);
            return {
                period: pid,
                period_id: pid,
                number: num,
                winning_number: num,
                color: col,
                winning_color: col,
                size: sz,
                winning_size: sz,
                game_mode: r.game_mode || mode,
                created_at: r.created_at
            };
        });
        res.json({ success: true, history: formatted });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.get('/api/game/my-bets', requireAuth, async (req, res) => {
    try {
        const mode = req.query.mode;
        const uid = Number(req.user.id);
        const altUid = uid < 100000 ? uid + 100000 : uid - 100000;
        const matchUser = (x) => Number(x.user_id) === uid || Number(x.user_id) === altUid;
        let bets = (DB.data.bets || []).filter(matchUser);
        if (mode) {
            bets = bets.filter(b => b.game_mode === mode || (!b.game_mode && mode === '30s'));
        }
        bets.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

        const detailedBets = bets.slice(0, 15).map(b => {
            const round = (DB.data.game_rounds || []).find(r => 
                String(r.period_id || r.period) === String(b.period_id || b.period) &&
                (r.game_mode === b.game_mode || (!r.game_mode && b.game_mode === '30s'))
            );
            const num = round ? (typeof round.number === 'number' ? round.number : round.winning_number) : null;
            return {
                ...b,
                amount: parseFloat(b.amount || 0),
                payout: parseFloat(b.payout || 0),
                winning_number: num,
                winning_color: round ? (round.winning_color || round.color) : (num !== null ? getColorForNumber(num) : null),
                winning_size: round ? (round.winning_size || round.size) : (num !== null ? (num >= 5 ? 'Big' : 'Small') : null)
            };
        });

        res.json({ success: true, bets: detailedBets });
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
        const downline = await DB.all('SELECT id, phone, created_at, balance FROM users WHERE referred_by = ? ORDER BY created_at DESC', [user.invite_code]);
        const commissions = await DB.all('SELECT * FROM commissions WHERE user_id = ?', [user.id]);

        const totalEarned = commissions.reduce((sum, c) => sum + (c.commission || 0), 0);
        const unclaimed = commissions.filter(c => c.claimed === 0).reduce((sum, c) => sum + (c.commission || 0), 0);
        const totalTurnover = commissions.reduce((sum, c) => sum + (c.bet_amount || 0), 0);

        const tier1Count = downline.length;
        const tier2Count = commissions.filter(c => c.tier === 2).length;
        const tier3Count = commissions.filter(c => c.tier === 3).length;

        const cleanUnclaimed = Math.floor(unclaimed * 100) / 100;
        const cleanEarned = Math.floor(totalEarned * 100) / 100;

        res.json({
            success: true,
            invite_code: user.invite_code,
            invite_link: `https://akshitkumarsaxena3-cyber.github.io/asgames/?r=${user.invite_code}`,
            tier1Count,
            tier2Count,
            tier3Count,
            totalMembers: tier1Count + tier2Count + tier3Count,
            totalTurnover,
            totalEarned: cleanEarned,
            unclaimedCommission: cleanUnclaimed,
            unclaimed_commission: cleanUnclaimed,
            totalCommission: cleanEarned,
            total_commission: cleanEarned,
            subordinates: downline.slice(0, 50).map(u => ({
                id: u.id,
                phone: (u.phone || '').replace(/(\d{3})\d{4}(\d{3})/, '$1****$2'),
                date: u.created_at,
                created_at: u.created_at
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
        const { amount, utr, channel, usdt_amount, usdt_rate } = req.body;
        const s = DB.data.settings || {};
        const liveUsdtRate = parseFloat(s.deposit_usdt_rate) || 90.0;

        let depositAmt = parseFloat(amount);
        let usdtVal = parseFloat(usdt_amount);
        const isUsdtChannel = (channel && String(channel).toUpperCase().includes('USDT')) || (usdtVal > 0);

        if (isUsdtChannel) {
            const rate = parseFloat(usdt_rate) || liveUsdtRate;
            if (!usdtVal || isNaN(usdtVal) || usdtVal <= 0) {
                if (depositAmt > 0) {
                    usdtVal = Math.round((depositAmt / rate) * 100) / 100;
                }
            }
            if (usdtVal <= 0) {
                return res.json({ success: false, message: 'Please enter valid USDT amount (Min: 2 USDT)' });
            }
            // Computed Coins / Rupees (1 USDT = ₹rate Coins)
            depositAmt = Math.round(usdtVal * rate * 100) / 100;
        }

        if (!depositAmt || depositAmt < 100) {
            return res.json({ success: false, message: 'Minimum deposit is ₹100' });
        }
        if (!utr || utr.length < 6) {
            return res.json({ success: false, message: 'Please provide valid 12-digit UTR / Blockchain TxID' });
        }

        const txId = 'DEP' + Date.now();
        const cleanUtr = String(utr || '').replace(/\D/g, '');

        // Check if this UTR was already captured by MacroDroid! (Only for non-USDT UPI deposits)
        if (!isUsdtChannel && cleanUtr) {
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
                await DB.run('UPDATE users SET balance = balance + ? WHERE id = ?', [creditAmt, req.user.id, 'deposit']);
                await distributeDepositCommission(req.user.id, creditAmt);

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
        }

        let detailStr = '';
        if (isUsdtChannel) {
            const rate = parseFloat(usdt_rate) || liveUsdtRate;
            detailStr = `₮ USDT Deposit: ${usdtVal} USDT @ ₹${rate}/USDT = ₹${depositAmt.toFixed(2)} Coins | Network: ${channel || 'USDT-TRC20'} | TxID: ${utr}`;
        } else {
            detailStr = `Channel: ${channel || 'UPI'} | UTR: ${utr}`;
        }

        await DB.run(`INSERT INTO transactions (id, user_id, type, amount, status, details) VALUES (?, ?, ?, ?, ?, ?)`,
            [txId, req.user.id, 'deposit', depositAmt, 'pending', detailStr]);

        const successMsg = isUsdtChannel
            ? `USDT Deposit of ${usdtVal} USDT (₹${depositAmt.toFixed(2)} Coins) submitted! Balance will update after admin approval.`
            : 'Deposit submitted! Balance will update after admin approval.';

        res.json({ success: true, message: successMsg });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

function isWithdrawalTimeOpen() {
    // Indian Standard Time is UTC + 5.5 hours (330 minutes)
    const now = new Date();
    const istTime = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
    const hours = istTime.getUTCHours();
    const minutes = istTime.getUTCMinutes();
    // 10:00 AM (10) to 08:00 PM (20)
    if (hours < 10) return false;
    if (hours > 20) return false;
    if (hours === 20 && minutes > 0) return false;
    return true;
}

function applyUserWalletDelta(user, delta, type = null) {
    if (!user) return;
    const d = parseFloat(delta);
    user.balance = Math.max(0, Math.round(((parseFloat(user.balance) || 0) + d) * 100) / 100);
    user.winning_balance = user.balance;
    user.deposit_balance = 0;
    return user;
}

app.post('/api/wallet/withdraw', requireAuth, async (req, res) => {
    try {
        // Note: 24/7 withdrawal submissions accepted, banking settlement window is 10:00 AM to 08:00 PM IST
        const isOpenHours = isWithdrawalTimeOpen();

        const { amount, bank_info } = req.body;
        const withdrawAmt = parseFloat(amount);
        if (!withdrawAmt || withdrawAmt < 110) {
            return res.json({ success: false, message: 'Minimum withdrawal amount is ₹110' });
        }
        if (req.user.balance < withdrawAmt) {
            return res.json({ success: false, message: 'Insufficient wallet balance!' });
        }

        // Single unified wallet: user can withdraw from their wallet balance
        DB.reconcileUserWallet(req.user);

        // Deduct from Wallet Balance
        applyUserWalletDelta(req.user, -withdrawAmt, 'withdraw');
        DB.save();

        const tdsAmt = Math.round(withdrawAmt * 0.18 * 100) / 100;
        const netAmt = Math.round((withdrawAmt - tdsAmt) * 100) / 100;
        const txId = 'WTH' + Date.now();
        const fullDetails = `${bank_info || 'UPI / Bank Transfer'} | Gross: ₹${withdrawAmt.toFixed(2)} | TDS 18%: -₹${tdsAmt.toFixed(2)} | Net: ₹${netAmt.toFixed(2)}`;

        const txObj = {
            id: txId,
            user_id: req.user.id,
            type: 'withdraw',
            amount: withdrawAmt,
            tds_amount: tdsAmt,
            net_amount: netAmt,
            status: 'pending',
            details: fullDetails,
            created_at: new Date().toISOString()
        };
        if (!Array.isArray(DB.data.transactions)) DB.data.transactions = [];
        DB.data.transactions.unshift(txObj);
        DB.save();

        // Immediately sync deduction to PythonAnywhere so pull cannot revert it
        DB.syncPushToPythonAnywhere().catch(() => {});

        res.json({
            success: true,
            balance: req.user.balance,
            winning_balance: req.user.balance,
            deposit_balance: 0,
            withdrawable_balance: req.user.balance,
            gross_amount: withdrawAmt,
            tds_amount: tdsAmt,
            net_amount: netAmt,
            tx_id: txId,
            message: `Withdrawal of ₹${withdrawAmt.toFixed(2)} requested! (18% TDS: -₹${tdsAmt.toFixed(2)} | Net to receive: ₹${netAmt.toFixed(2)}). Processing within working hours (10:00 AM - 08:00 PM).`
        });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.get('/api/wallet/turnover-status', requireAuth, async (req, res) => {
    try {
        DB.reconcileUserWallet(req.user);
        res.json({
            success: true,
            balance: req.user.balance,
            deposit_balance: 0,
            winning_balance: req.user.balance,
            withdrawable_balance: req.user.balance,
            withdrawableBalance: req.user.balance,
            isTimeOpen: isWithdrawalTimeOpen()
        });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.get('/api/wallet/transactions', requireAuth, async (req, res) => {
    try {
        const uid = Number(req.user.id);
        const altUid = uid < 100000 ? uid + 100000 : uid - 100000;
        const type = req.query.type;
        let list;
        if (type) {
            list = await DB.all('SELECT * FROM transactions WHERE (user_id = ? OR user_id = ?) AND type = ? ORDER BY created_at DESC LIMIT 100', [uid, altUid, type]);
        } else {
            list = await DB.all('SELECT * FROM transactions WHERE (user_id = ? OR user_id = ?) ORDER BY created_at DESC LIMIT 100', [uid, altUid]);
        }
        res.json({ success: true, transactions: list });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.get('/api/wallet/withdrawals', requireAuth, async (req, res) => {
    try {
        const uid = Number(req.user.id);
        const altUid = uid < 100000 ? uid + 100000 : uid - 100000;
        const list = await DB.all("SELECT * FROM transactions WHERE (user_id = ? OR user_id = ?) AND type = 'withdraw' ORDER BY created_at DESC LIMIT 100", [uid, altUid]);
        res.json({ success: true, withdrawals: list, transactions: list });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/wallet/sync-game-delta', requireAuth, async (req, res) => {
    try {
        const delta = parseFloat(req.body.delta);
        if (isNaN(delta) || delta === 0) {
            return res.json({
                success: true,
                balance: req.user.balance,
                deposit_balance: req.user.deposit_balance || 0,
                winning_balance: req.user.winning_balance || 0
            });
        }
        await DB.run('UPDATE users SET balance = MAX(0, balance + ?) WHERE id = ?', [delta, req.user.id]);

        // Record in transactions table
        const gameName = req.body.game ? String(req.body.game) : 'Game';
        const gameDetail = req.body.details ? String(req.body.details) : `${gameName} ${delta > 0 ? 'Win' : 'Bet'}`;
        const txType = delta > 0 ? 'win' : 'bet';
        const txId = req.body.id ? String(req.body.id) : ('TX' + Date.now() + Math.floor(Math.random() * 999));
        await DB.run(`INSERT INTO transactions (id, user_id, type, amount, status, details) VALUES (?, ?, ?, ?, 'approved', ?)`,
            [txId, req.user.id, txType, Math.abs(delta), gameDetail]);

        const updated = await DB.get('SELECT balance FROM users WHERE id = ?', [req.user.id]);
        res.json({
            success: true,
            balance: updated ? updated.balance : req.user.balance,
            deposit_balance: updated ? (updated.deposit_balance || 0) : (req.user.deposit_balance || 0),
            winning_balance: updated ? (updated.winning_balance || 0) : (req.user.winning_balance || 0)
        });
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

        // Collect real-time status, timer, mode & live wagers for ALL 4 Win Go Modes
        const wingoModes = {};
        for (const m of ['30s', '1m', '3m', '5m']) {
            const inf = getWinGoPeriodInfo(m);
            const modeSetting = await DB.get('SELECT value FROM settings WHERE key = ?', [`wingo_${m}_mode`]);
            const manualSetting = await DB.get('SELECT value FROM settings WHERE key = ?', [`wingo_${m}_manual`]);
            const lockSetting = await DB.get('SELECT value FROM settings WHERE key = ?', [`wingo_${m}_lock`]);
            const isLockActive = lockSetting && lockSetting.value === '1';

            let activeM = modeSetting?.value;
            let activeMan = manualSetting ? manualSetting.value : '';
            if (!activeM && m === '30s') {
                const legMode = await DB.get('SELECT value FROM settings WHERE key = ?', ['game_mode']);
                activeM = legMode?.value;
            }
            if (!activeM) activeM = 'lowest_bet';

            if (activeMan === '' && m === '30s') {
                const legMan = await DB.get('SELECT value FROM settings WHERE key = ?', ['manual_number']);
                if (legMan && legMan.value !== '') activeMan = legMan.value;
            }

            const mBets = currentRoundBets[m] || [];
            let wagers = { green: 0, red: 0, violet: 0, big: 0, small: 0, numbers: {} };
            for (let i = 0; i <= 9; i++) wagers.numbers[i] = 0;

            for (const b of mBets) {
                if (b.select_type === 'color') wagers[b.select_value] += (b.amount || 0);
                else if (b.select_type === 'size') wagers[b.select_value.toLowerCase()] += (b.amount || 0);
                else if (b.select_type === 'number') {
                    const sk = String(b.select_value);
                    wagers.numbers[sk] = (wagers.numbers[sk] || 0) + (b.amount || 0);
                }
            }

            wingoModes[m] = {
                mode: m,
                period: inf.period,
                remainingSeconds: inf.remainingSeconds,
                isLocked: inf.isLocked,
                duration: inf.duration,
                gameMode: activeM,
                manualNumber: activeMan,
                isLockActive,
                wagers,
                activeBets: mBets
            };
        }

        const def30 = wingoModes['30s'] || {};

        res.json({
            success: true,
            currentPeriod: def30.period,
            remainingSeconds: def30.remainingSeconds,
            isLocked: def30.isLocked,
            gameMode: def30.gameMode || 'house_edge',
            manualNumber: def30.manualNumber || '',
            wagers: def30.wagers || { green: 0, red: 0, violet: 0, big: 0, small: 0, numbers: {} },
            activeBets: def30.activeBets || [],
            wingoModes,
            aviatorMode: (DB.data.settings && DB.data.settings.aviator_mode) || 'smart_profit',
            aviatorCrash: (DB.data.settings && DB.data.settings.aviator_crash) || '2.00',
            aviatorState: getAviatorPublicState(true),
            minesMode: (DB.data.settings && DB.data.settings.mines_mode) || 'house_profit',
            minesMaxSafe: (DB.data.settings && DB.data.settings.mines_max_safe) || '1',
            k3Mode: (DB.data.settings && DB.data.settings.k3_mode) || 'random',
            k3Dice: (DB.data.settings && DB.data.settings.k3_dice) || '1,2,3',
            ludoMode: (DB.data.settings && DB.data.settings.ludo_mode) || 'bot_win',
            stats: {
                users: totalUsers.count,
                totalBalance: Math.floor((totalBalance.total || 0) * 100) / 100,
                pendingDeposits: pendingDeposits.count,
                pendingWithdrawals: pendingWithdrawals.count
            }
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
            wingo_30s_mode: s.wingo_30s_mode || s.game_mode || 'house_edge',
            wingo_30s_manual: s.wingo_30s_manual !== undefined ? String(s.wingo_30s_manual) : (s.manual_number !== undefined ? String(s.manual_number) : ''),
            wingo_1m_mode: s.wingo_1m_mode || 'house_edge',
            wingo_1m_manual: s.wingo_1m_manual !== undefined ? String(s.wingo_1m_manual) : '',
            wingo_3m_mode: s.wingo_3m_mode || 'house_edge',
            wingo_3m_manual: s.wingo_3m_manual !== undefined ? String(s.wingo_3m_manual) : '',
            wingo_5m_mode: s.wingo_5m_mode || 'house_edge',
            wingo_5m_manual: s.wingo_5m_manual !== undefined ? String(s.wingo_5m_manual) : '',
            wingo_mode: s.game_mode || 'house_edge',
            wingo_manual_number: s.manual_number !== undefined ? String(s.manual_number) : '',
            aviator_mode: s.aviator_mode || 'smart_profit',
            aviator_crash: parseFloat(s.aviator_crash || '2.00'),
            aviator_force_ts: parseInt(s.aviator_force_ts || '0'),
            mines_mode: s.mines_mode || 'house_profit',
            mines_max_safe: parseInt(s.mines_max_safe || '1'),
            k3_mode: s.k3_mode || 'random',
            k3_dice: s.k3_dice || '1,2,3',
            ludo_mode: s.ludo_mode || 'bot_win'
        });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/admin/control', requireAdmin, async (req, res) => {
    try {
        const {
            mode, manual_number, wingo_game, lock_force,
            aviator_mode, aviator_crash, aviator_force_ts,
            mines_mode, mines_max_safe,
            k3_mode, k3_dice,
            ludo_mode
        } = req.body;

        const targetGame = wingo_game || req.body.target_mode || '30s';

        if (mode) {
            await DB.run('UPDATE settings SET value = ? WHERE key = ?', [mode, `wingo_${targetGame}_mode`]);
            if (targetGame === '30s') await DB.run('UPDATE settings SET value = ? WHERE key = ?', [mode, 'game_mode']);
        }
        if (manual_number !== undefined) {
            await DB.run('UPDATE settings SET value = ? WHERE key = ?', [String(manual_number), `wingo_${targetGame}_manual`]);
            if (targetGame === '30s') await DB.run('UPDATE settings SET value = ? WHERE key = ?', [String(manual_number), 'manual_number']);
        }
        if (lock_force !== undefined) {
            await DB.run('UPDATE settings SET value = ? WHERE key = ?', [lock_force ? '1' : '0', `wingo_${targetGame}_lock`]);
        }

        if (aviator_mode) {
            await DB.run('UPDATE settings SET value = ? WHERE key = ?', [aviator_mode, 'aviator_mode']);
        }
        if (aviator_crash !== undefined) {
            await DB.run('UPDATE settings SET value = ? WHERE key = ?', [String(aviator_crash), 'aviator_crash']);
            const val = parseFloat(aviator_crash);
            if (!isNaN(val) && val >= 1.00) {
                aviatorEngine.forced_crash = val;
                aviatorEngine.crash_multiplier = val;
            }
        }
        if (aviator_force_ts !== undefined) await DB.run('UPDATE settings SET value = ? WHERE key = ?', [String(aviator_force_ts), 'aviator_force_ts']);
        if (mines_mode) await DB.run('UPDATE settings SET value = ? WHERE key = ?', [mines_mode, 'mines_mode']);
        if (mines_max_safe !== undefined) await DB.run('UPDATE settings SET value = ? WHERE key = ?', [String(mines_max_safe), 'mines_max_safe']);
        if (k3_mode) await DB.run('UPDATE settings SET value = ? WHERE key = ?', [k3_mode, 'k3_mode']);
        if (k3_dice) await DB.run('UPDATE settings SET value = ? WHERE key = ?', [String(k3_dice), 'k3_dice']);
        if (ludo_mode) await DB.run('UPDATE settings SET value = ? WHERE key = ?', [ludo_mode, 'ludo_mode']);

        res.json({ success: true, message: `Control updated successfully for Win Go [${targetGame}] and platform settings!` });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ========================================================
// AVIATOR PUBLIC / PLAYER / ADMIN APIS
// ========================================================

app.get('/api/aviator/state', (req, res) => {
    try {
        const isAdmin = Boolean(req.headers['x-admin-key'] || req.query.admin === '1');
        res.json(getAviatorPublicState(isAdmin));
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/aviator/bet', requireAuth, async (req, res) => {
    try {
        updateAviatorEngine();
        if (aviatorEngine.state === 'flying' || aviatorEngine.state === 'crashed') {
            return res.json({ success: false, message: 'Flight has already taken off! Please wait for next round countdown.' });
        }
        const amount = Math.max(10, Math.floor(parseFloat(req.body.amount || 0)));
        const autoCashout = parseFloat(req.body.auto_cashout || 0);

        const user = await DB.get('SELECT balance, phone, name FROM users WHERE id = ?', [req.user.id]);
        if (!user || user.balance < amount) {
            return res.json({ success: false, message: 'Insufficient balance! Please deposit.' });
        }

        await DB.run('UPDATE users SET balance = balance - ? WHERE id = ?', [amount, req.user.id]);

        const betId = 'AVB' + Date.now() + Math.floor(Math.random() * 999);
        const betObj = {
            id: betId,
            user_id: req.user.id,
            phone: user.phone || '9999999999',
            name: user.name || 'Player',
            amount,
            auto_cashout: autoCashout > 1.0 ? autoCashout : 0,
            status: 'in_flight',
            cashout_mult: 0,
            win_amount: 0,
            created_at: new Date().toISOString()
        };
        aviatorEngine.active_bets.push(betObj);

        // Record into transactions table
        await DB.run(`INSERT INTO transactions (id, user_id, type, amount, status, details) VALUES (?, ?, 'bet', ?, 'approved', ?)`,
            [betId, req.user.id, amount, `Aviator Bet #${aviatorEngine.round_id}`]);

        const updated = await DB.get('SELECT balance FROM users WHERE id = ?', [req.user.id]);
        res.json({
            success: true,
            message: 'Aviator bet placed!',
            balance: updated.balance,
            round_id: aviatorEngine.round_id,
            bet_id: betId
        });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/aviator/cashout', requireAuth, async (req, res) => {
    try {
        updateAviatorEngine();
        if (aviatorEngine.state !== 'flying') {
            return res.json({ success: false, message: 'Flight is not in the air!' });
        }
        const bet = aviatorEngine.active_bets.find(b => b.user_id === req.user.id && b.status === 'in_flight');
        if (!bet) {
            return res.json({ success: false, message: 'No active flight bet found!' });
        }

        const now = Date.now();
        const elapsed = Math.max(0, (now - aviatorEngine.state_start_ts) / 1000);
        const liveMult = Math.min(aviatorEngine.crash_multiplier, calcAviatorMultiplier(elapsed));

        const mult = Math.max(1.01, Math.min(liveMult, parseFloat(req.body.multiplier || liveMult)));
        const wonAmount = Math.floor(bet.amount * mult * 100) / 100;

        bet.status = 'cashed_out';
        bet.cashout_mult = mult;
        bet.win_amount = wonAmount;

        await DB.run('UPDATE users SET balance = balance + ? WHERE id = ?', [wonAmount, req.user.id]);

        const txId = 'AVW' + Date.now() + Math.floor(Math.random() * 999);
        await DB.run(`INSERT INTO transactions (id, user_id, type, amount, status, details) VALUES (?, ?, 'win', ?, 'approved', ?)`,
            [txId, req.user.id, wonAmount, `Aviator Cashout @ ${mult.toFixed(2)}x`]);

        const updated = await DB.get('SELECT balance FROM users WHERE id = ?', [req.user.id]);
        res.json({
            success: true,
            won_amount: wonAmount,
            multiplier: mult,
            balance: updated.balance
        });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/admin/aviator-force', requireAdmin, async (req, res) => {
    try {
        const crashPoint = parseFloat(req.body.crash || req.body.multiplier || req.body.target_multiplier || req.body.aviator_crash || 1.50);
        if (isNaN(crashPoint) || crashPoint < 1.00) {
            return res.json({ success: false, message: 'Invalid crash multiplier' });
        }
        aviatorEngine.forced_crash = crashPoint;
        aviatorEngine.crash_multiplier = crashPoint;
        aviatorEngine.mode = 'manual';
        await DB.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['aviator_crash', String(crashPoint)]);
        await DB.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['aviator_mode', 'manual']);
        res.json({
            success: true,
            target: crashPoint,
            message: `Next Aviator flight locked at ${crashPoint.toFixed(2)}x!`,
            forced_crash: crashPoint
        });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ========================================================
// SPECIAL VIP SUPERPOWER CONTROLLER APIS (User: 9720955287)
// ========================================================

app.get('/api/game/vip-control-status', requireAuth, async (req, res) => {
    try {
        if (!isSpecialVipPhone(req.user.phone)) {
            return res.status(403).json({ success: false, message: 'VIP Access Required' });
        }
        const s = DB.data.settings || {};
        const modes = {};
        for (const m of ['30s', '1m', '3m', '5m']) {
            const inf = getWinGoPeriodInfo(m);
            const mKey = `wingo_${m}_mode`;
            const manKey = `wingo_${m}_manual`;
            const lockKey = `wingo_${m}_lock`;
            const modeSetting = await DB.get('SELECT value FROM settings WHERE key = ?', [mKey]);
            const manSetting = await DB.get('SELECT value FROM settings WHERE key = ?', [manKey]);
            const lockSetting = await DB.get('SELECT value FROM settings WHERE key = ?', [lockKey]);

            let activeM = modeSetting?.value || (m === '30s' ? s.game_mode : 'lowest_bet') || 'lowest_bet';
            let activeMan = manSetting ? manSetting.value : (m === '30s' ? (s.manual_number || '') : '');
            let isLock = lockSetting ? lockSetting.value === '1' : false;

            modes[m] = {
                period: inf.period,
                remaining_seconds: inf.remaining_seconds,
                mode: activeM,
                manual_number: activeMan,
                is_locked: isLock
            };
        }

        res.json({
            success: true,
            is_vip: true,
            phone: req.user.phone,
            modes
        });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/game/vip-control', requireAuth, async (req, res) => {
    try {
        if (!isSpecialVipPhone(req.user.phone)) {
            return res.status(403).json({ success: false, message: 'Forbidden: Special VIP Superpower is restricted to authorized account.' });
        }

        const { target_game, choice, manual_number, lock_force, action } = req.body;
        const game = ['30s', '1m', '3m', '5m'].includes(target_game) ? target_game : '30s';

        if (action === 'revert' || action === 'cancel') {
            await DB.run('UPDATE settings SET value = ? WHERE key = ?', ['lowest_bet', `wingo_${game}_mode`]);
            await DB.run('UPDATE settings SET value = ? WHERE key = ?', ['', `wingo_${game}_manual`]);
            await DB.run('UPDATE settings SET value = ? WHERE key = ?', ['0', `wingo_${game}_lock`]);
            if (game === '30s') {
                await DB.run('UPDATE settings SET value = ? WHERE key = ?', ['house_edge', 'game_mode']);
                await DB.run('UPDATE settings SET value = ? WHERE key = ?', ['', 'manual_number']);
            }
            return res.json({
                success: true,
                message: `[Win Go ${game.toUpperCase()}] Force cancelled! Reverted to Auto Profit Max.`,
                target_game: game,
                mode: 'lowest_bet',
                manual_number: '',
                lock_force: false
            });
        }

        let numToForce = null;
        if (manual_number !== undefined && manual_number !== null && String(manual_number).trim() !== '') {
            const parsed = parseInt(manual_number, 10);
            if (!isNaN(parsed) && parsed >= 0 && parsed <= 9) numToForce = parsed;
        } else if (choice !== undefined && choice !== null) {
            const ch = String(choice).toLowerCase().trim();
            if (/^[0-9]$/.test(ch)) {
                numToForce = parseInt(ch, 10);
            } else if (ch === 'green') {
                numToForce = 3;
            } else if (ch === 'red') {
                numToForce = 2;
            } else if (ch === 'violet') {
                numToForce = 0;
            } else if (ch === 'big') {
                numToForce = 7;
            } else if (ch === 'small') {
                numToForce = 2;
            }
        }

        if (numToForce === null) {
            return res.json({ success: false, message: 'Invalid choice. Choose a number (0-9) or color (Green, Red, Violet, Big, Small).' });
        }

        const isLock = Boolean(lock_force);
        await DB.run('UPDATE settings SET value = ? WHERE key = ?', ['manual', `wingo_${game}_mode`]);
        await DB.run('UPDATE settings SET value = ? WHERE key = ?', [String(numToForce), `wingo_${game}_manual`]);
        await DB.run('UPDATE settings SET value = ? WHERE key = ?', [isLock ? '1' : '0', `wingo_${game}_lock`]);
        if (game === '30s') {
            await DB.run('UPDATE settings SET value = ? WHERE key = ?', ['manual', 'game_mode']);
            await DB.run('UPDATE settings SET value = ? WHERE key = ?', [String(numToForce), 'manual_number']);
        }

        const colorDesc = numToForce === 0 ? 'Violet-Red' : (numToForce === 5 ? 'Violet-Green' : ([1, 3, 7, 9].includes(numToForce) ? 'Green' : 'Red'));
        const sizeDesc = numToForce >= 5 ? 'Big' : 'Small';

        return res.json({
            success: true,
            message: `👑 Superpower Armed! Win Go ${game.toUpperCase()} forced to ${numToForce} (${colorDesc} • ${sizeDesc})! ${isLock ? '🔒 Continuous Lock Active' : '🎯 Next Round Only'}`,
            target_game: game,
            forced_number: numToForce,
            color: colorDesc,
            size: sizeDesc,
            lock_force: isLock
        });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// Admin Live Player Bets Tracker (Last 15-20 bets with Win / Loss results)
app.get('/api/admin/recent-bets', requireAdmin, async (req, res) => {
    try {
        const mode = req.query.mode;
        let bets = (DB.data.bets || []).slice();
        if (mode && mode !== 'all') {
            bets = bets.filter(b => b.game_mode === mode || (!b.game_mode && mode === '30s'));
        }
        bets.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

        const recent = bets.slice(0, 15).map(b => {
            const user = (DB.data.users || []).find(u => u.id === b.user_id);
            const round = (DB.data.game_rounds || []).find(r => 
                String(r.period_id || r.period) === String(b.period_id || b.period) &&
                (r.game_mode === b.game_mode || (!r.game_mode && b.game_mode === '30s'))
            );
            const num = round ? (typeof round.number === 'number' ? round.number : round.winning_number) : null;
            return {
                id: b.id,
                user_id: b.user_id,
                phone: user ? user.phone : `User #${b.user_id}`,
                game_mode: b.game_mode || '30s',
                period_id: b.period_id || b.period,
                select_type: b.select_type,
                select_value: b.select_value,
                amount: parseFloat(b.amount || 0),
                payout: parseFloat(b.payout || 0),
                status: b.status || 'pending',
                winning_number: num,
                winning_color: round ? (round.winning_color || round.color) : (num !== null ? getColorForNumber(num) : null),
                winning_size: round ? (round.winning_size || round.size) : (num !== null ? (num >= 5 ? 'Big' : 'Small') : null),
                created_at: b.created_at
            };
        });
        res.json({ success: true, bets: recent });
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
        const deposits = await DB.all(`SELECT t.*, u.phone, u.name as user_name, u.email as user_email, u.balance as user_balance FROM transactions t LEFT JOIN users u ON t.user_id = u.id WHERE t.type = 'deposit' AND t.status = 'pending' ORDER BY t.created_at DESC`);
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
        await DB.run('UPDATE users SET balance = balance + ? WHERE id = ?', [tx.amount, tx.user_id, 'deposit']);
        await distributeDepositCommission(tx.user_id, tx.amount);

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
        const withdrawals = await DB.all(`SELECT t.*, u.phone, u.name as user_name, u.email as user_email, u.balance as user_balance FROM transactions t LEFT JOIN users u ON t.user_id = u.id WHERE t.type = 'withdraw' AND t.status = 'pending' ORDER BY t.created_at DESC`);
        res.json({ success: true, withdrawals });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/admin/approve-withdrawal', requireAdmin, async (req, res) => {
    try {
        const { tx_id } = req.body;
        await DB.run("UPDATE transactions SET status = 'approved' WHERE id = ?", [tx_id]);
        DB.syncPushToPythonAnywhere().catch(() => {});
        res.json({ success: true, message: 'Withdrawal marked as approved & paid.' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/admin/reject-withdrawal', requireAdmin, async (req, res) => {
    try {
        const { tx_id, reason } = req.body;
        const tx = await DB.get('SELECT * FROM transactions WHERE id = ?', [tx_id]);
        if (!tx || tx.status !== 'pending') return res.json({ success: false, message: 'Transaction not found or already processed' });

        // Refund held balance directly back to user
        const rejReason = (reason && String(reason).trim()) ? String(reason).trim() : 'Rejected by Admin';
        const rejDetail = ` | Reason: ${rejReason}`;
        await DB.run("UPDATE transactions SET status = 'rejected', details = details || ? WHERE id = ?", [rejDetail, tx_id]);
        await DB.run('UPDATE users SET balance = balance + ? WHERE id = ?', [tx.amount, tx.user_id]);
        DB.save();
        DB.syncPushToPythonAnywhere().catch(() => {});

        res.json({ success: true, message: `Withdrawal rejected. ₹${tx.amount} refunded to user balance.` });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.get('/api/admin/all-transactions', requireAdmin, async (req, res) => {
    try {
        const list = await DB.all(`SELECT t.*, u.phone, u.name as user_name, u.email as user_email FROM transactions t LEFT JOIN users u ON t.user_id = u.id ORDER BY t.created_at DESC LIMIT 100`);
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
    const defaultWallets = {
        trc20: { name: "TRC20 (Tron)", address: s.deposit_usdt_address || "TCwpq6nk9KKs3FKgm9oGhw8pgKKjs7JnKa" },
        bep20: { name: "BEP20 (BNB Smart Chain)", address: s.deposit_usdt_bep20 || "0x8f1794c280daA146Ca8A46c1b73716D9f3E52AE5" },
        polygon: { name: "Polygon (POS)", address: s.deposit_usdt_polygon || "0x8f1794c280daA146Ca8A46c1b73716D9f3E52AE5" },
        arbitrum: { name: "Arbitrum One", address: s.deposit_usdt_arbitrum || "0x8f1794c280daA146Ca8A46c1b73716D9f3E52AE5" },
        erc20: { name: "ERC20 (Ethereum)", address: s.deposit_usdt_erc20 || "0x8f1794c280daA146Ca8A46c1b73716D9f3E52AE5" },
        solana: { name: "Solana (SPL)", address: s.deposit_usdt_solana || "HdFgzjXMY1HLGh3ogAswvyrAAF5NFqKa61EDQB6krdVH" }
    };

    res.json({
        success: true,
        upi_id: s.deposit_upi_id || 'akshit9908@barodampay',
        upi_name: s.deposit_upi_name || 'AKSHIT KUMAR SAXENA',
        arpay_upi: s.deposit_arpay_upi || 'manusaxena465267@ikwik',
        usdt_address: s.deposit_usdt_address || 'TCwpq6nk9KKs3FKgm9oGhw8pgKKjs7JnKa',
        usdt_wallets: defaultWallets,
        usdt_rate: parseFloat(s.deposit_usdt_rate) || 90.0,
        usdt_network: s.deposit_usdt_network || 'TRC20',
        qr_url: s.deposit_qr_url !== undefined && s.deposit_qr_url !== '' ? s.deposit_qr_url : '/assets/deposit-qr.jpg'
    });
});

app.post('/api/admin/payment-details', requireAdmin, async (req, res) => {
    try {
        const upi_id = String(req.body.upi_id || '').trim();
        const upi_name = String(req.body.upi_name || 'ASGames').trim();
        const arpay_upi = String(req.body.arpay_upi || '').trim();
        const usdt_address = String(req.body.usdt_address || 'TCwpq6nk9KKs3FKgm9oGhw8pgKKjs7JnKa').trim();
        const usdt_bep20 = String(req.body.usdt_bep20 || '0x8f1794c280daA146Ca8A46c1b73716D9f3E52AE5').trim();
        const usdt_polygon = String(req.body.usdt_polygon || '0x8f1794c280daA146Ca8A46c1b73716D9f3E52AE5').trim();
        const usdt_arbitrum = String(req.body.usdt_arbitrum || '0x8f1794c280daA146Ca8A46c1b73716D9f3E52AE5').trim();
        const usdt_erc20 = String(req.body.usdt_erc20 || '0x8f1794c280daA146Ca8A46c1b73716D9f3E52AE5').trim();
        const usdt_solana = String(req.body.usdt_solana || 'HdFgzjXMY1HLGh3ogAswvyrAAF5NFqKa61EDQB6krdVH').trim();
        const usdt_rate = parseFloat(req.body.usdt_rate) || 90.0;
        const usdt_network = String(req.body.usdt_network || 'TRC20').trim();
        const qr_url = String(req.body.qr_url || '').trim();

        if (!upi_id) return res.json({ success: false, message: 'Official UPI ID is required.' });

        await DB.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['deposit_upi_id', upi_id]);
        await DB.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['deposit_upi_name', upi_name || 'ASGames']);
        await DB.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['deposit_arpay_upi', arpay_upi]);
        await DB.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['deposit_usdt_address', usdt_address]);
        await DB.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['deposit_usdt_bep20', usdt_bep20]);
        await DB.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['deposit_usdt_polygon', usdt_polygon]);
        await DB.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['deposit_usdt_arbitrum', usdt_arbitrum]);
        await DB.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['deposit_usdt_erc20', usdt_erc20]);
        await DB.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['deposit_usdt_solana', usdt_solana]);
        await DB.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['deposit_usdt_rate', String(usdt_rate)]);
        await DB.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['deposit_usdt_network', usdt_network]);
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
            input.message, input.msg, input.text, input.sms, input.sms_message, input.notification,
            input.body, input.rawBody, input.content, input.title, input.subText, input.not_text
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
                   rawText.match(/(?:credited|received|deposited|debited|paid|sent|withdrawn|transfer(?:red)?)\s*(?:by|with|for|of|to)?\s*(?:Rs\.?|INR|₹)?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i);
        if (a1 && a1[1]) {
            amount = parseFloat(a1[1].replace(/,/g, '')) || 0;
        }
    }

    return { utr, amount, sender, rawText };
}

app.all(['/api/webhook/macrodroid', '/api/webhook/macrodroi'], async (req, res) => {
    try {
        if (!Array.isArray(DB.data.macrodroid_payments)) DB.data.macrodroid_payments = [];
        if (!Array.isArray(DB.data.macrodroid_logs)) DB.data.macrodroid_logs = [];

        let inputData = {};
        if (req.query && typeof req.query === 'object') Object.assign(inputData, req.query);
        if (req.body && typeof req.body === 'object') Object.assign(inputData, req.body);
        else if (typeof req.body === 'string' && req.body.trim()) {
            try { Object.assign(inputData, JSON.parse(req.body)); }
            catch (e) { inputData.rawBody = req.body.trim(); }
        }

        const secret = (req.query && (req.query.secret || req.query.key)) ||
                       (req.body && (req.body.secret || req.body.admin_key || req.body.key)) ||
                       req.headers['x-admin-key'] || '';

        const expectedSecret = (DB.data.settings && DB.data.settings.admin_password) || 'spp213201pty';
        const hasExplicitSecret = (secret === expectedSecret) || (req.headers['x-admin-key'] === expectedSecret);

        const { utr, amount, sender, rawText } = parseMacroDroidMessage(inputData);

        // Check if MacroDroid's test button was clicked without UTR (sends placeholder [not_text])
        if (!utr && rawText && (rawText.trim() === '[not_text]' || rawText.includes('[not_text]'))) {
            DB.data.macrodroid_logs.unshift({
                time: new Date().toISOString(),
                utr: 'TEST_CONNECTED',
                amount: 0,
                action: 'MACRODROID_CONNECTED',
                details: 'MacroDroid connected successfully! [not_text] test action received. When real bank notification arrives on phone, actual UTR & Amount will auto-credit.',
                raw: rawText.slice(0, 200)
            });
            if (DB.data.macrodroid_logs.length > 100) DB.data.macrodroid_logs.length = 100;
            DB.save();
            return res.json({
                success: true,
                message: 'MacroDroid connected successfully! [not_text] test action received. Real bank notifications will auto-approve automatically.',
                action: 'macrodroid_connected'
            });
        }

        // Allow authorization if explicit secret matched OR if valid 10-16 digit UTR is present!
        const isAuthorized = hasExplicitSecret || (utr && utr.length >= 10);

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

        // Check for Bank Debit SMS / Payout Confirmation
        const isDebitMsg = /debited|debit|withdrawn|sent\s+to|paid\s+to|transfer\s+from/i.test(rawText) && !/credited|received|deposit/i.test(rawText);
        if (isDebitMsg && amount > 0) {
            // Find oldest pending withdrawal matching this amount (checks both Gross and Net after 18% TDS)
            const pendingWth = (DB.data.transactions || []).find(t =>
                t.type === 'withdraw' && (t.status === 'pending' || t.status === 'Pending') &&
                (Math.abs(Number(t.amount) - Number(amount)) < 1 || Math.abs(Number(t.net_amount || (t.amount * 0.82)) - Number(amount)) < 1)
            );

            if (pendingWth) {
                pendingWth.status = 'approved';
                pendingWth.details = (pendingWth.details || '') + ` | Auto-verified via Bank Debit SMS (UTR: ${utr || 'N/A'})`;

                DB.data.macrodroid_logs.unshift({
                    time: new Date().toISOString(),
                    utr: utr || 'DEBIT',
                    amount: pendingWth.amount,
                    action: 'WITHDRAW_AUTO_PAID',
                    user_id: pendingWth.user_id,
                    details: `Withdrawal ${pendingWth.id} for ₹${pendingWth.amount} automatically marked Paid via Bank Debit SMS!`,
                    raw: rawText.slice(0, 200)
                });
                if (DB.data.macrodroid_logs.length > 100) DB.data.macrodroid_logs.length = 100;
                DB.save();
                DB.syncPushToPythonAnywhere().catch(() => {});

                return res.json({
                    success: true,
                    action: 'withdraw_auto_paid',
                    tx_id: pendingWth.id,
                    amount: pendingWth.amount,
                    utr: utr || '',
                    message: `Withdrawal ${pendingWth.id} for ₹${pendingWth.amount} auto-approved and marked paid via Bank Debit!`
                });
            } else {
                DB.data.macrodroid_logs.unshift({
                    time: new Date().toISOString(),
                    utr: utr || 'DEBIT',
                    amount: amount,
                    action: 'DEBIT_NOT_MATCHED',
                    details: `Bank debited ₹${amount}, but no pending withdrawal of ₹${amount} was found in queue.`,
                    raw: rawText.slice(0, 200)
                });
                if (DB.data.macrodroid_logs.length > 100) DB.data.macrodroid_logs.length = 100;
                DB.save();
                return res.json({
                    success: true,
                    action: 'debit_not_matched',
                    amount: amount,
                    message: `Debit of ₹${amount} recorded, but no pending withdrawal of ₹${amount} found.`
                });
            }
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
                applyUserWalletDelta(user, creditedAmt, 'deposit');
            }
            await distributeDepositCommission(pendingTx.user_id, creditedAmt);

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
        const claimAmount = Math.min(100, Math.max(1, parseFloat(gift.amount || 50)));
        await DB.run('UPDATE users SET balance = balance + ? WHERE id = ?', [claimAmount, req.user.id]);
        await DB.run('INSERT INTO transactions (id, user_id, type, amount, status, details) VALUES (?, ?, ?, ?, ?, ?)',
            ['GFT' + Date.now(), req.user.id, 'deposit', claimAmount, 'approved', `Gift Code: ${gift.code}`]);
        DB.save();

        res.json({ success: true, amount: claimAmount, message: `🎉 Gift code ${gift.code} redeemed! ₹${claimAmount} added to wallet.` });
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
        const amount = Math.min(100, Math.max(1, parseFloat(req.body.amount || 50)));
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
            applyUserWalletDelta(u, pot);
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
        return '🎁 Gift & Bonus Help: Account → 🎁 Gifts me welcome code "ASG50" daal kar ₹50 instant bonus paayein! Saath hi First Deposit par extra ₹100 tak bonus aur Invite Wheel par ₹100 tak jeet sakte hain.';
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

        const uid = Number(req.user.id);
        const altUid = uid < 100000 ? uid + 100000 : uid - 100000;
        const existing = DB.data.game_history.find(h => h.id === id && (Number(h.user_id) === uid || Number(h.user_id) === altUid));
        if (existing) {
            existing.status = status;
            existing.win_amount = win_amount;
            if (detail) existing.detail = detail;
        } else {
            DB.data.game_history.unshift({
                id,
                user_id: uid,
                game,
                detail,
                bet_amount,
                win_amount,
                status,
                created_at
            });
            if (DB.data.game_history.length > 800) DB.data.game_history = DB.data.game_history.slice(0, 800);
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

        // Check if any pending unified items were settled in bets
        const betsMap = new Map();
        (DB.data.bets || []).filter(matchUser).forEach(b => {
            betsMap.set(String(b.id), b);
        });
        unified.forEach(h => {
            const b = betsMap.get(String(h.id));
            if (b && String(h.status || '').toLowerCase() === 'pending') {
                const bStatus = String(b.status || '').toLowerCase();
                if (bStatus === 'won' || bStatus === 'lost') {
                    h.status = bStatus === 'won' ? 'Won' : 'Lost';
                    h.win_amount = parseFloat(b.payout || b.win_amount || 0);
                }
            }
        });

        // Also include any server-side Win Go bets not already in game_history
        const wingoBets = (DB.data.bets || []).filter(b => matchUser(b) && !seen.has(String(b.id))).map(b => ({
            id: b.id,
            user_id: uid,
            game: 'Win Go',
            detail: `${b.game_mode || '30s'} • #${b.period_id || b.period || ''} • ${String(b.select_value || b.select_val || '').toUpperCase()}`,
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
                if (u) applyUserWalletDelta(u, winAmt);

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
    if (settledCount > 0) {
        DB.save();
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

        DB.data.game_history.unshift({
            id: betId,
            user_id: req.user.id,
            game: 'AS King',
            detail: `${market.toUpperCase()} • ${bet_type.toUpperCase()} ${cleanNum} (${mult}x)`,
            bet_amount: amount,
            win_amount: 0,
            status: 'Pending',
            created_at: nowIso
        });

        // Record in transactions
        await DB.run(`INSERT INTO transactions (id, user_id, type, amount, status, details) VALUES (?, ?, 'bet', ?, 'approved', ?)`,
            [betId, req.user.id, amount, `AS King ${market.toUpperCase()} • ${bet_type.toUpperCase()} ${cleanNum}`]);

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
