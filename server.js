// ASGames Full-Stack Server - Real Auth, Referral System & Super Admin Control Center
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const DB = require('./db.js');

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
// USER AUTHENTICATION APIS
// ========================================================
app.post('/api/auth/register', async (req, res) => {
    try {
        const { phone, password, invite_code } = req.body;
        if (!phone || !password || phone.length < 10) {
            return res.json({ success: false, message: 'Please provide valid phone number and password' });
        }

        const existing = await DB.get('SELECT id FROM users WHERE phone = ?', [phone]);
        if (existing) {
            return res.json({ success: false, message: 'Phone number already registered. Please login.' });
        }

        // Generate unique invitation code
        const myInviteCode = 'ASG' + Math.floor(100000 + Math.random() * 900000);

        // Verify referrer
        let referrerCode = null;
        if (invite_code) {
            const refUser = await DB.get('SELECT invite_code FROM users WHERE invite_code = ?', [invite_code.trim()]);
            if (refUser) referrerCode = refUser.invite_code;
        }

        const result = await DB.run(`INSERT INTO users (phone, password, balance, invite_code, referred_by) VALUES (?, ?, 100.0, ?, ?)`,
            [phone, password, myInviteCode, referrerCode]);

        const newUser = await DB.get('SELECT * FROM users WHERE id = ?', [result.id]);
        const token = generateToken(newUser.id, newUser.phone);

        res.json({
            success: true,
            message: 'Registered successfully! ₹100 Welcome Bonus credited.',
            token,
            user: {
                id: newUser.id,
                phone: newUser.phone,
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
        const user = await DB.get('SELECT * FROM users WHERE phone = ?', [phone]);
        if (!user || user.password !== password) {
            return res.json({ success: false, message: 'Incorrect mobile number or password.' });
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
            balance: req.user.balance,
            invite_code: req.user.invite_code,
            referred_by: req.user.referred_by,
            vip_level: req.user.vip_level
        }
    });
});

app.post('/api/auth/forgot-password', async (req, res) => {
    try {
        const { phone, new_password } = req.body;
        if (!phone || !new_password || phone.length < 10) {
            return res.json({ success: false, message: 'Please provide valid 10-digit mobile number and new password.' });
        }
        const user = await DB.get('SELECT id FROM users WHERE phone = ?', [phone.trim()]);
        if (!user) {
            return res.json({ success: false, message: 'Mobile number not found! Please check or register.' });
        }
        await DB.run('UPDATE users SET password = ? WHERE phone = ?', [new_password.trim(), phone.trim()]);
        res.json({ success: true, message: 'Password reset successfully! You can now log in.' });
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
        await DB.run(`INSERT INTO transactions (id, user_id, type, amount, status, details) VALUES (?, ?, 'commission', ?, 'approved', 'Referral Commission Claim')`,
            ['TX' + Date.now(), req.user.id, cleanTotal]);

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
        await DB.run(`INSERT INTO transactions (id, user_id, type, amount, status, details) VALUES (?, ?, 'deposit', ?, 'pending', ?)`,
            [txId, req.user.id, depositAmt, `Channel: ${channel || 'UPI'} | UTR: ${utr}`]);

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
        await DB.run(`INSERT INTO transactions (id, user_id, type, amount, status, details) VALUES (?, ?, 'withdraw', ?, 'pending', ?)`,
            [txId, req.user.id, withdrawAmt, bank_info || 'UPI / Bank Transfer']);

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

app.post('/api/admin/control', requireAdmin, async (req, res) => {
    try {
        const { mode, manual_number } = req.body;
        if (mode) {
            await DB.run('UPDATE settings SET value = ? WHERE key = ?', [mode, 'game_mode']);
        }
        if (manual_number !== undefined) {
            await DB.run('UPDATE settings SET value = ? WHERE key = ?', [String(manual_number), 'manual_number']);
        }
        res.json({ success: true, message: 'Game outcome settings updated successfully!' });
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
});
