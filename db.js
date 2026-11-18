// ASGames Production-Ready Embedded Database Engine
// Pure JavaScript, zero native C++ compilation dependencies, 100% resilient on Render & Windows.

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'asgames_data.json');

class DataStore {
    constructor() {
        this.data = {
            users: [],
            game_rounds: [],
            bets: [],
            transactions: [],
            commissions: [],
            gift_codes: [
                { code: 'ASG50', amount: 50, max_uses: 100, claimed_by: [], created_at: new Date().toISOString() }
            ],
            friends: [],
            friend_messages: [],
            ludo_rooms: [],
            support_messages: [],
            game_history: [],
            king_markets: {
                asgames:   { key: 'asgames',   name: 'AS GAMES',  time: 'Live 24/7', is_local: true,  old_num: '47', new_num: '83', updated_at: '' },
                faridabad: { key: 'faridabad', name: 'FARIDABAD', time: '06:15 PM',  is_local: false, old_num: '62', new_num: '--', updated_at: '' },
                gaziabad:  { key: 'gaziabad',  name: 'GAZIABAD',  time: '08:40 PM',  is_local: false, old_num: '19', new_num: '--', updated_at: '' },
                gali:      { key: 'gali',      name: 'GALI',      time: '11:30 PM',  is_local: false, old_num: '74', new_num: '--', updated_at: '' },
                disawar:   { key: 'disawar',   name: 'DISAWAR',   time: '05:10 AM',  is_local: false, old_num: '35', new_num: '--', updated_at: '' }
            },
            king_bets: [],
            macrodroid_payments: [],
            macrodroid_logs: [],
            settings: {
                admin_password: 'spp213201pty',
                game_mode: 'random',
                manual_number: '',
                aviator_mode: 'smart_profit',
                aviator_crash: '2.00',
                aviator_force_ts: '0',
                mines_mode: 'random',
                mines_max_safe: '1',
                k3_mode: 'random',
                k3_dice: '1,2,3',
                ludo_mode: 'fair',
                upi_id: 'akshit9908@barodampay',
                upi_name: 'AKSHIT KUMAR SAXENA',
                deposit_upi_id: 'akshit9908@barodampay',
                deposit_upi_name: 'AKSHIT KUMAR SAXENA',
                deposit_arpay_upi: 'manusaxena465267@ikwik',
                deposit_qr_url: '/assets/deposit-qr.jpg',
                min_deposit: '100',
                min_withdraw: '110',
                pythonanywhere_url: 'https://backandsopport.pythonanywhere.com',
                gmail_user: '',
                gmail_app_password: '',
                email_webhook_url: ''
            },
            nextUserId: 101001,
            nextCommissionId: 1
        };
        this._dirty = false;
        this._lastLocalWriteTs = 0;
        this.load();
    }

    load() {
        if (fs.existsSync(DATA_FILE)) {
            try {
                const content = fs.readFileSync(DATA_FILE, 'utf-8');
                const parsed = JSON.parse(content);
                this.data = Object.assign(this.data, parsed);
                // Ensure updated admin password & permanent PythonAnywhere sync URL
                if (!this.data.settings) this.data.settings = {};
                if (!Array.isArray(this.data.friends)) this.data.friends = [];
                if (!Array.isArray(this.data.friend_messages)) this.data.friend_messages = [];
                if (!Array.isArray(this.data.ludo_rooms)) this.data.ludo_rooms = [];
                if (!Array.isArray(this.data.support_messages)) this.data.support_messages = [];
                if (!Array.isArray(this.data.game_history)) this.data.game_history = [];
                if (!this.data.king_markets || typeof this.data.king_markets !== 'object') {
                    this.data.king_markets = {
                        asgames:   { key: 'asgames',   name: 'AS GAMES',  time: 'Live 24/7', is_local: true,  old_num: '47', new_num: '83', updated_at: '' },
                        faridabad: { key: 'faridabad', name: 'FARIDABAD', time: '06:15 PM',  is_local: false, old_num: '62', new_num: '--', updated_at: '' },
                        gaziabad:  { key: 'gaziabad',  name: 'GAZIABAD',  time: '08:40 PM',  is_local: false, old_num: '19', new_num: '--', updated_at: '' },
                        gali:      { key: 'gali',      name: 'GALI',      time: '11:30 PM',  is_local: false, old_num: '74', new_num: '--', updated_at: '' },
                        disawar:   { key: 'disawar',   name: 'DISAWAR',   time: '05:10 AM',  is_local: false, old_num: '35', new_num: '--', updated_at: '' }
                    };
                }
                if (!Array.isArray(this.data.king_bets)) this.data.king_bets = [];
                if (!Array.isArray(this.data.macrodroid_payments)) this.data.macrodroid_payments = [];
                if (!Array.isArray(this.data.macrodroid_logs)) this.data.macrodroid_logs = [];
                this.data.settings.admin_password = 'spp213201pty';
                if (!this.data.settings.pythonanywhere_url) {
                    this.data.settings.pythonanywhere_url = 'https://backandsopport.pythonanywhere.com';
                }
                if (this.data.users.length > 0) {
                    const maxId = Math.max(...this.data.users.map(u => u.id || 0));
                    this.data.nextUserId = Math.max(101001, this.data.nextUserId || 101001, maxId + 1);
                } else {
                    this.data.nextUserId = Math.max(101001, this.data.nextUserId || 101001);
                }
                if (this.data.commissions.length > 0) {
                    const maxCommId = Math.max(...this.data.commissions.map(c => c.id || 0));
                    this.data.nextCommissionId = Math.max(this.data.nextCommissionId, maxCommId + 1);
                }
                console.log(`Loaded ASGames database: ${this.data.users.length} users, ${this.data.game_rounds.length} rounds.`);
            } catch (e) {
                console.error('Error loading asgames_data.json, starting fresh:', e.message);
            }
        } else {
            this.save();
            console.log('Created fresh ASGames database file: asgames_data.json');
        }
    }

    save() {
        try {
            this._dirty = true;
            this._lastLocalWriteTs = Date.now();
            fs.writeFileSync(DATA_FILE, JSON.stringify(this.data, null, 2), 'utf-8');
            this.triggerCloudSync();
        } catch (e) {
            console.error('Error saving asgames_data.json:', e.message);
        }
    }

    getPythonAnywhereUrl() {
        return (process.env.PYTHONANYWHERE_URL || (this.data.settings && this.data.settings.pythonanywhere_url) || '').trim().replace(/\/+$/, '');
    }

    triggerCloudSync() {
        if (this._syncTimeout) clearTimeout(this._syncTimeout);
        this._syncTimeout = setTimeout(() => {
            this.syncPushToPythonAnywhere();
        }, 600);
    }

    async syncPullFromPythonAnywhere() {
        const url = this.getPythonAnywhereUrl();
        if (!url) return false;
        // CRITICAL: Never overwrite fresh local balance changes (withdrawals/bets/gifts) with stale remote data!
        if (this._dirty) {
            const pushed = await this.syncPushToPythonAnywhere();
            if (!pushed) return false;
        }
        if (Date.now() - (this._lastLocalWriteTs || 0) < 8000) {
            return false;
        }
        try {
            const res = await fetch(`${url}/api/sync/pull`, { headers: { 'x-admin-key': 'spp213201pty' } });
            if (!res.ok) return false;
            const remote = await res.json();
            if (!remote.success) return false;

            // Abort pull if a local write occurred while fetch was in flight
            if (this._dirty || Date.now() - (this._lastLocalWriteTs || 0) < 8000) {
                return false;
            }

            if (Array.isArray(remote.users)) {
                for (const ru of remote.users) {
                    const localUser = this.data.users.find(u => u.phone === ru.phone);
                    if (localUser) {
                        if (ru.email) localUser.email = ru.email;
                        if (ru.password) localUser.password = ru.password;
                        if (typeof ru.balance === 'number') localUser.balance = ru.balance;
                        if (typeof ru.deposit_balance === 'number') localUser.deposit_balance = ru.deposit_balance;
                        if (typeof ru.winning_balance === 'number') localUser.winning_balance = ru.winning_balance;
                        if (ru.is_banned !== undefined) localUser.is_banned = ru.is_banned;
                    } else {
                        const newId = ru.id || this.data.nextUserId++;
                        this.data.users.push(Object.assign({}, ru, { id: newId }));
                        this.data.nextUserId = Math.max(this.data.nextUserId, newId + 1);
                    }
                }
            }

            if (remote.settings && typeof remote.settings === 'object') {
                if (remote.settings.gmail_user) this.data.settings.gmail_user = remote.settings.gmail_user;
                if (remote.settings.gmail_app_password) this.data.settings.gmail_app_password = remote.settings.gmail_app_password;
                if (remote.settings.email_webhook_url) this.data.settings.email_webhook_url = remote.settings.email_webhook_url;
                if (remote.settings.deposit_upi_id) this.data.settings.deposit_upi_id = remote.settings.deposit_upi_id;
                if (remote.settings.deposit_upi_name) this.data.settings.deposit_upi_name = remote.settings.deposit_upi_name;
                if (remote.settings.deposit_arpay_upi !== undefined) this.data.settings.deposit_arpay_upi = remote.settings.deposit_arpay_upi;
                if (remote.settings.deposit_usdt_address) this.data.settings.deposit_usdt_address = remote.settings.deposit_usdt_address;
                if (remote.settings.deposit_qr_url !== undefined) this.data.settings.deposit_qr_url = remote.settings.deposit_qr_url;
            }

            if (Array.isArray(remote.transactions)) {
                for (const rt of remote.transactions) {
                    const localTx = this.data.transactions.find(t => t.id === rt.id);
                    if (localTx) {
                        localTx.status = rt.status;
                        localTx.details = rt.details;
                    } else {
                        this.data.transactions.push(rt);
                    }
                }
            }

            if (Array.isArray(remote.gift_codes)) {
                if (!Array.isArray(this.data.gift_codes)) this.data.gift_codes = [];
                for (const rg of remote.gift_codes) {
                    const code = String(rg.code || '').toUpperCase();
                    if (!code) continue;
                    const claimedRemote = Array.isArray(rg.claimed_by) ? rg.claimed_by : [];
                    const localG = this.data.gift_codes.find(g => String(g.code).toUpperCase() === code);
                    if (localG) {
                        const merged = Array.from(new Set([...(localG.claimed_by || []), ...claimedRemote]));
                        localG.claimed_by = merged;
                        if (rg.amount) localG.amount = rg.amount;
                        if (rg.max_uses) localG.max_uses = rg.max_uses;
                    } else {
                        this.data.gift_codes.push({
                            code,
                            amount: parseFloat(rg.amount || 50),
                            max_uses: parseInt(rg.max_uses || 100),
                            claimed_by: claimedRemote,
                            created_at: rg.created_at || new Date().toISOString()
                        });
                    }
                }
            }

            if (Array.isArray(remote.bets)) {
                if (!Array.isArray(this.data.bets)) this.data.bets = [];
                for (const rb of remote.bets) {
                    const bid = rb.id;
                    if (!bid) continue;
                    const localB = this.data.bets.find(b => b.id === bid);
                    if (localB) {
                        if (rb.status && rb.status !== 'pending') localB.status = rb.status;
                        if (rb.win_amount !== undefined) localB.payout = parseFloat(rb.win_amount || 0);
                    } else {
                        this.data.bets.push({
                            id: bid,
                            user_id: rb.user_id,
                            period_id: rb.period || rb.period_id || '',
                            select_type: rb.select_type || 'color',
                            select_value: rb.select_val || rb.select_value || '',
                            amount: parseFloat(rb.amount || 0),
                            payout: parseFloat(rb.win_amount || rb.payout || 0),
                            status: rb.status || 'pending',
                            created_at: rb.created_at || new Date().toISOString()
                        });
                    }
                }
            }

            if (Array.isArray(remote.game_history)) {
                if (!Array.isArray(this.data.game_history)) this.data.game_history = [];
                for (const rh of remote.game_history) {
                    const hid = String(rh.id || '');
                    if (!hid) continue;
                    const localH = this.data.game_history.find(h => String(h.id) === hid);
                    if (localH) {
                        if (rh.status && rh.status !== 'Pending') {
                            localH.status = rh.status;
                            localH.win_amount = parseFloat(rh.win_amount || 0);
                            if (rh.detail) localH.detail = rh.detail;
                        }
                    } else {
                        this.data.game_history.push({
                            id: hid,
                            user_id: rh.user_id,
                            game: rh.game || 'Game',
                            detail: rh.detail || '',
                            bet_amount: parseFloat(rh.bet_amount || 0),
                            win_amount: parseFloat(rh.win_amount || 0),
                            status: rh.status || 'Pending',
                            created_at: rh.created_at || new Date().toISOString()
                        });
                    }
                }
                if (this.data.game_history.length > 800) {
                    this.data.game_history = this.data.game_history.slice(-800);
                }
            }

            if (Array.isArray(remote.macrodroid_payments)) {
                if (!Array.isArray(this.data.macrodroid_payments)) this.data.macrodroid_payments = [];
                for (const rp of remote.macrodroid_payments) {
                    const pid = String(rp.id || '');
                    if (!pid) continue;
                    const localP = this.data.macrodroid_payments.find(p => String(p.id) === pid || (p.utr && p.utr === rp.utr));
                    if (localP) {
                        if (rp.status && rp.status !== 'unclaimed') {
                            localP.status = rp.status;
                            localP.matched_user_id = rp.matched_user_id;
                            localP.matched_tx_id = rp.matched_tx_id;
                        }
                    } else {
                        this.data.macrodroid_payments.push(rp);
                    }
                }
                if (this.data.macrodroid_payments.length > 300) {
                    this.data.macrodroid_payments = this.data.macrodroid_payments.slice(-300);
                }
            }

            fs.writeFileSync(DATA_FILE, JSON.stringify(this.data, null, 2), 'utf-8');
            console.log(`[PythonAnywhere Sync] Pulled ${remote.users?.length || 0} users, ${remote.transactions?.length || 0} tx, ${remote.game_history?.length || 0} history from ${url}`);
            return true;
        } catch (e) {
            console.warn('[PythonAnywhere Sync] Pull error:', e.message);
            return false;
        }
    }

    async syncPushToPythonAnywhere() {
        const url = this.getPythonAnywhereUrl();
        if (!url) return false;
        try {
            const payload = {
                users: this.data.users,
                transactions: this.data.transactions,
                bets: this.data.bets.slice(-100),
                game_history: (this.data.game_history || []).slice(-300),
                macrodroid_payments: (this.data.macrodroid_payments || []).slice(-200),
                settings: this.data.settings,
                gift_codes: this.data.gift_codes || []
            };
            const res = await fetch(`${url}/api/sync/push`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-admin-key': 'spp213201pty' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (data.success) {
                this._dirty = false;
                console.log(`[PythonAnywhere Sync] Pushed updates to ${url}`);
                return true;
            }
            return false;
        } catch (e) {
            console.warn('[PythonAnywhere Sync] Push error:', e.message);
            return false;
        }
    }

    async get(sql, params = []) {
        sql = sql.trim();

        // 1. Settings
        if (sql.includes('FROM settings WHERE key =')) {
            const key = params[0];
            return { value: this.data.settings[key] !== undefined ? this.data.settings[key] : '' };
        }

        // 2. User by id
        if (sql.includes('FROM users WHERE id =')) {
            const id = parseInt(params[0]);
            return this.data.users.find(u => u.id === id) || null;
        }

        // 3. User by phone or email
        if (sql.includes('FROM users WHERE phone = ? OR email = ?')) {
            const p = String(params[0] || '').trim().toLowerCase();
            const e = String(params[1] || params[0] || '').trim().toLowerCase();
            return this.data.users.find(u => (u.phone || '').toLowerCase() === p || (u.email || '').toLowerCase() === e) || null;
        }
        if (sql.includes('FROM users WHERE email =')) {
            const email = String(params[0] || '').trim().toLowerCase();
            return this.data.users.find(u => (u.email || '').toLowerCase() === email) || null;
        }
        if (sql.includes('FROM users WHERE phone =')) {
            const phone = String(params[0]).trim();
            return this.data.users.find(u => u.phone === phone || (u.email || '').toLowerCase() === phone.toLowerCase()) || null;
        }

        // 4. User by invite_code
        if (sql.includes('FROM users WHERE invite_code =')) {
            const code = String(params[0]).trim();
            return this.data.users.find(u => u.invite_code === code) || null;
        }

        // 5. User referred_by
        if (sql.includes('SELECT referred_by FROM users WHERE id =')) {
            const id = parseInt(params[0]);
            const u = this.data.users.find(u => u.id === id);
            return u ? { referred_by: u.referred_by } : null;
        }

        // 6. User id, referred_by by invite_code
        if (sql.includes('SELECT id, referred_by FROM users WHERE invite_code =')) {
            const code = String(params[0]).trim();
            const u = this.data.users.find(u => u.invite_code === code);
            return u ? { id: u.id, referred_by: u.referred_by } : null;
        }

        // 7. Transaction by id
        if (sql.includes('FROM transactions WHERE id =')) {
            const id = String(params[0]);
            return this.data.transactions.find(t => t.id === id) || null;
        }

        // 8. Stats: Count users
        if (sql.includes('COUNT(*) as count FROM users') || sql.includes('COUNT(*) as cnt FROM users')) {
            return { count: this.data.users.length, cnt: this.data.users.length };
        }

        // 9. Stats: Sum balance
        if (sql.includes('SUM(balance) as total FROM users')) {
            const total = this.data.users.reduce((sum, u) => sum + (u.balance || 0), 0);
            return { total };
        }

        // 10. Stats: Pending deposits count
        if (sql.includes("type = 'deposit'") || sql.includes("type='deposit'")) {
            const count = this.data.transactions.filter(t => t.type === 'deposit' && t.status === 'pending').length;
            return { count };
        }

        // 11. Stats: Pending withdrawals count
        if (sql.includes("type = 'withdraw'") || sql.includes("type='withdraw'")) {
            const count = this.data.transactions.filter(t => t.type === 'withdraw' && t.status === 'pending').length;
            return { count };
        }

        // 12. Game rounds count
        if (sql.includes('COUNT(*) as cnt FROM game_rounds')) {
            return { cnt: this.data.game_rounds.length };
        }

        console.warn('Unhandled GET SQL:', sql, params);
        return null;
    }

    async all(sql, params = []) {
        sql = sql.trim();

        // 1. Bets by period and status
        if (sql.includes('FROM bets WHERE period_id = ? AND status = ?')) {
            const [period, status] = params;
            return this.data.bets.filter(b => b.period_id === String(period) && b.status === status);
        }

        // 2. Game rounds history
        if (sql.includes('FROM game_rounds ORDER BY created_at DESC')) {
            return [...this.data.game_rounds].reverse().slice(0, 30);
        }

        // 3. User bets
        if (sql.includes('FROM bets WHERE user_id = ? ORDER BY created_at DESC')) {
            const uid = parseInt(params[0]);
            return this.data.bets.filter(b => b.user_id === uid).reverse().slice(0, 30);
        }

        // 4. Downline users
        if (sql.includes('FROM users WHERE referred_by = ?')) {
            const code = String(params[0]).trim();
            return this.data.users.filter(u => u.referred_by === code);
        }

        // 5. Commissions for user
        if (sql.includes('FROM commissions WHERE user_id = ? AND claimed = 0')) {
            const uid = parseInt(params[0]);
            return this.data.commissions.filter(c => c.user_id === uid && c.claimed === 0);
        }
        if (sql.includes('FROM commissions WHERE user_id = ?')) {
            const uid = parseInt(params[0]);
            return this.data.commissions.filter(c => c.user_id === uid);
        }

        // 6. User transactions
        if (sql.includes('FROM transactions WHERE user_id = ? ORDER BY created_at DESC')) {
            const uid = parseInt(params[0]);
            return this.data.transactions.filter(t => t.user_id === uid).reverse().slice(0, 40);
        }

        // 7. Admin: All users
        if (sql.includes('FROM users ORDER BY id DESC')) {
            return [...this.data.users].reverse().slice(0, 100);
        }

        // 8. Admin: Pending deposits
        if (sql.includes("type = 'deposit' AND t.status = 'pending'") || sql.includes("type='deposit' AND status='pending'")) {
            return this.data.transactions
                .filter(t => t.type === 'deposit' && t.status === 'pending')
                .map(t => {
                    const u = this.data.users.find(u => u.id === t.user_id);
                    return Object.assign({}, t, { phone: u ? u.phone : 'Unknown' });
                })
                .reverse();
        }

        // 9. Admin: Pending withdrawals
        if (sql.includes("type = 'withdraw' AND t.status = 'pending'") || sql.includes("type='withdraw' AND status='pending'")) {
            return this.data.transactions
                .filter(t => t.type === 'withdraw' && t.status === 'pending')
                .map(t => {
                    const u = this.data.users.find(u => u.id === t.user_id);
                    return Object.assign({}, t, { phone: u ? u.phone : 'Unknown' });
                })
                .reverse();
        }

        // 10. Admin: All transactions (Deposits & Withdrawals)
        if (sql.includes('FROM transactions t JOIN users u') || sql.includes('FROM transactions ORDER BY')) {
            return this.data.transactions
                .map(t => {
                    const u = this.data.users.find(u => u.id === t.user_id);
                    return Object.assign({}, t, { phone: u ? u.phone : 'Unknown' });
                })
                .reverse()
                .slice(0, 100);
        }

        console.warn('Unhandled ALL SQL:', sql, params);
        return [];
    }

    async run(sql, params = []) {
        sql = sql.trim();

        // 1. Update settings
        if (sql.includes('UPDATE settings SET value = ? WHERE key = ?')) {
            const [val, key] = params;
            this.data.settings[key] = val;
            this.save();
            return { changes: 1 };
        }
        if (sql.includes('settings') && (sql.includes('INSERT OR REPLACE') || sql.includes('INSERT INTO'))) {
            const [key, val] = params;
            this.data.settings[key] = val;
            this.save();
            return { changes: 1 };
        }

        // 2. Insert Game Round
        if (sql.includes('INSERT') && sql.includes('game_rounds')) {
            const [period_id, game_mode, winning_number, winning_color, winning_size] = params;
            const existingIdx = this.data.game_rounds.findIndex(g => g.period_id === String(period_id));
            const roundObj = {
                period_id: String(period_id),
                game_mode,
                winning_number: parseInt(winning_number),
                winning_color,
                winning_size,
                created_at: new Date().toISOString()
            };
            if (existingIdx >= 0) {
                this.data.game_rounds[existingIdx] = roundObj;
            } else {
                this.data.game_rounds.push(roundObj);
            }
            if (this.data.game_rounds.length > 100) this.data.game_rounds.shift();
            this.save();
            return { changes: 1 };
        }

        // 3. Update Bets (Won/Lost)
        if (sql.includes('UPDATE bets SET status = ?, payout = ? WHERE id = ?')) {
            const [status, payout, id] = params;
            const bet = this.data.bets.find(b => b.id === id);
            if (bet) {
                bet.status = status;
                bet.payout = parseFloat(payout);
                this.save();
            }
            return { changes: 1 };
        }

        // 4. Update User Balance (+ or -) with 2-Wallet Architecture
        const applyUserWallet = (user, delta, isDeposit = false, isWithdraw = false) => {
            if (!user) return;
            if (typeof user.deposit_balance !== 'number' || typeof user.winning_balance !== 'number') {
                user.deposit_balance = 0;
                user.winning_balance = Math.max(0, parseFloat(user.balance || 0));
            }
            const d = parseFloat(delta);
            if (d > 0) {
                if (isDeposit) {
                    user.deposit_balance = Math.round((user.deposit_balance + d) * 100) / 100;
                } else {
                    user.winning_balance = Math.round((user.winning_balance + d) * 100) / 100;
                }
            } else if (d < 0) {
                const deduct = Math.abs(d);
                if (isWithdraw) {
                    user.winning_balance = Math.max(0, Math.round((user.winning_balance - deduct) * 100) / 100);
                } else {
                    // Bet: deduct from deposit_balance first, then winning_balance!
                    const fromDep = Math.min(user.deposit_balance, deduct);
                    const fromWin = Math.max(0, deduct - fromDep);
                    user.deposit_balance = Math.max(0, Math.round((user.deposit_balance - fromDep) * 100) / 100);
                    user.winning_balance = Math.max(0, Math.round((user.winning_balance - fromWin) * 100) / 100);
                }
            }
            user.balance = Math.round((user.deposit_balance + user.winning_balance) * 100) / 100;
        };

        if (sql.includes('UPDATE users SET balance = balance + ? WHERE id = ?')) {
            const [amt, id] = params;
            const user = this.data.users.find(u => u.id === parseInt(id));
            if (user) {
                const isDep = sql.includes('deposit') || (params.length > 2 && params[2] === 'deposit');
                applyUserWallet(user, amt, isDep, false);
                this.save();
            }
            return { changes: 1 };
        }
        if (sql.includes('UPDATE users SET balance = balance - ? WHERE id = ?')) {
            const [amt, id] = params;
            const user = this.data.users.find(u => u.id === parseInt(id));
            if (user) {
                const isWd = (params.length > 2 && params[2] === 'withdraw');
                applyUserWallet(user, -amt, false, isWd);
                this.save();
            }
            return { changes: 1 };
        }
        if (sql.includes('UPDATE users SET balance = MAX(0, balance + ?) WHERE id = ?')) {
            const [amt, id] = params;
            const user = this.data.users.find(u => u.id === parseInt(id));
            if (user) {
                // Game delta (bet if amt < 0, win if amt > 0)
                applyUserWallet(user, amt, false, false);
                this.save();
            }
            return { changes: 1 };
        }

        // 5. Update User Ban
        if (sql.includes('UPDATE users SET is_banned = ? WHERE id = ?')) {
            const [banned, id] = params;
            const user = this.data.users.find(u => u.id === parseInt(id));
            if (user) {
                user.is_banned = parseInt(banned);
                this.save();
            }
            return { changes: 1 };
        }

        // 5b. Update User Password
        if (sql.includes('UPDATE users SET password = ? WHERE id = ?')) {
            const [newPass, id] = params;
            const user = this.data.users.find(u => u.id === parseInt(id));
            if (user) {
                user.password = String(newPass).trim();
                this.save();
                return { changes: 1 };
            }
            return { changes: 0 };
        }
        if (sql.includes('UPDATE users SET password = ? WHERE phone = ?')) {
            const [newPass, phone] = params;
            const user = this.data.users.find(u => u.phone === String(phone).trim());
            if (user) {
                user.password = String(newPass).trim();
                this.save();
                return { changes: 1 };
            }
            return { changes: 0 };
        }

        // 6. Insert User
        if (sql.includes('INSERT INTO users')) {
            let phone, password, invite_code, referred_by, email, email_verified;
            if (params.length >= 6) {
                [phone, password, invite_code, referred_by, email, email_verified] = params;
            } else {
                [phone, password, invite_code, referred_by] = params;
                email = '';
                email_verified = 1;
            }
            const newId = this.data.nextUserId++;
            const user = {
                id: newId,
                phone: String(phone).trim(),
                email: email ? String(email).trim().toLowerCase() : '',
                email_verified: email_verified !== undefined ? parseInt(email_verified) : 1,
                password: String(password).trim(),
                balance: 100.0,
                invite_code: String(invite_code).trim(),
                referred_by: referred_by ? String(referred_by).trim() : null,
                vip_level: 1,
                is_banned: 0,
                created_at: new Date().toISOString()
            };
            this.data.users.push(user);
            this.save();
            return { id: newId, changes: 1 };
        }

        // 7. Insert Bet
        if (sql.includes('INSERT INTO bets')) {
            const [id, user_id, period_id, select_type, select_value, amount] = params;
            const bet = {
                id: String(id),
                user_id: parseInt(user_id),
                period_id: String(period_id),
                game_mode: '30s',
                select_type,
                select_value: String(select_value),
                amount: parseFloat(amount),
                payout: 0,
                status: 'pending',
                created_at: new Date().toISOString()
            };
            this.data.bets.push(bet);
            this.save();
            return { changes: 1 };
        }

        // 8. Insert Transaction
        if (sql.includes('INSERT INTO transactions')) {
            let id, user_id, type, amount, status, details;
            if (params.length === 6) {
                [id, user_id, type, amount, status, details] = params;
            } else if (params.length === 4) {
                [id, user_id, amount, details] = params;
                type = sql.includes("'deposit'") ? 'deposit' : (sql.includes("'withdraw'") ? 'withdraw' : (sql.includes("'commission'") ? 'commission' : 'deposit'));
                status = sql.includes("'approved'") ? 'approved' : 'pending';
            } else {
                [id, user_id, type, amount, status, details] = params;
            }
            const tx = {
                id: String(id),
                user_id: parseInt(user_id),
                type: type || 'deposit',
                amount: parseFloat(amount) || 0,
                status: status || 'pending',
                details: details || '',
                created_at: new Date().toISOString()
            };
            this.data.transactions.push(tx);
            this.save();
            return { changes: 1 };
        }

        // 9. Insert Commission
        if (sql.includes('INSERT INTO commissions')) {
            const [user_id, downline_id, tier, bet_amount, commission] = params;
            const comm = {
                id: this.data.nextCommissionId++,
                user_id: parseInt(user_id),
                downline_id: parseInt(downline_id),
                tier: parseInt(tier),
                bet_amount: parseFloat(bet_amount),
                commission: parseFloat(commission),
                claimed: 0,
                created_at: new Date().toISOString()
            };
            this.data.commissions.push(comm);
            this.save();
            return { changes: 1 };
        }

        // 10. Update Commissions Claimed
        if (sql.includes('UPDATE commissions SET claimed = 1 WHERE user_id = ?')) {
            const uid = parseInt(params[0]);
            this.data.commissions.forEach(c => {
                if (c.user_id === uid) c.claimed = 1;
            });
            this.save();
            return { changes: 1 };
        }

        // 11. Update Transaction Status
        if (sql.includes('UPDATE transactions SET status =')) {
            if (sql.includes("'approved'")) {
                const txId = params[0];
                const tx = this.data.transactions.find(t => t.id === txId);
                if (tx) tx.status = 'approved';
                this.save();
                return { changes: 1 };
            }
            if (sql.includes("'rejected'")) {
                const txId = params[0];
                const tx = this.data.transactions.find(t => t.id === txId);
                if (tx) tx.status = 'rejected';
                this.save();
                return { changes: 1 };
            }
        }

        console.warn('Unhandled RUN SQL:', sql, params);
        return { changes: 0 };
    }
}

const instance = new DataStore();
module.exports = instance;
