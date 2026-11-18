// ASGames Full-Stack Application Controller & State Manager

class StateManager {
    constructor() {
        this.token = localStorage.getItem('asg_token') || null;
        this.user = null;
        this.balance = this.token ? (parseFloat(localStorage.getItem('asg_balance')) || 0.00) : 0.00;
        this.uid = localStorage.getItem('asg_uid') || '849204';
        this.vipLevel = 1;
        this.inviteCode = localStorage.getItem('asg_invite') || 'ASG84920';

        this.transactions = [];
        this.userBets = [];
        this.checkinDay = parseInt(localStorage.getItem('asg_checkin_day')) || 1;
        this.lastCheckinDate = localStorage.getItem('asg_checkin_date') || '';

        this.currentTab = 'home';
        this.currentGame = 'wingo';

        this.init();
    }

    async init() {
        this.checkUrlReferral();
        this.updateBalanceUI();
        this.setupEventListeners();
        this.startWinningTicker();

        // Check if user is logged in
        if (this.token) {
            await this.fetchUserProfile();
            this.startLiveBalanceWatcher();
        } else {
            this.updateAuthButtonUI(false);
        }

        this.initGames();
        this.renderActivityTab();
        this.renderPromotionTab();
        this.renderAccountTab();
        this.renderTransactions();
    }

    checkUrlReferral() {
        const searchParams = new URLSearchParams(window.location.search);
        const hashQuery = window.location.hash.includes('?') ? window.location.hash.split('?')[1] : '';
        const hashParams = new URLSearchParams(hashQuery);
        const ref = searchParams.get('invite') || searchParams.get('r') || searchParams.get('invitationCode') || hashParams.get('invitationCode') || hashParams.get('invite') || hashParams.get('r');

        if (ref) {
            const regInviteInput = document.getElementById('reg-invite');
            if (regInviteInput) regInviteInput.value = ref.trim();
            if (!this.token) {
                openAuthModal('register');
            }
        }
    }

    async fetchUserProfile() {
        try {
            const res = await fetch('/api/auth/me', {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            const data = await res.json();
            if (data.success && data.user) {
                this.user = data.user;
                this.balance = data.user.balance;
                this.rawUserId = data.user.id;
                this.uid = data.user.uid || (Number(data.user.id) < 100000 ? 100000 + Number(data.user.id) : data.user.id);
                this.inviteCode = data.user.invite_code;
                this.vipLevel = data.user.vip_level || 1;

                localStorage.setItem('asg_balance', this.balance);
                localStorage.setItem('asg_uid', this.uid);
                localStorage.setItem('asg_invite', this.inviteCode);

                this.updateBalanceUI();
                this.updateAuthButtonUI(true);
                this.renderPromotionTab();
                this.renderAccountTab();
            } else {
                this.token = null;
                localStorage.removeItem('asg_token');
                this.updateAuthButtonUI(false);
            }
        } catch (e) {
            console.log('Error fetching profile, using cached balance:', e);
            this.updateAuthButtonUI(!!this.token);
        }
    }

    updateAuthButtonUI(isLoggedIn) {
        const authBtn = document.getElementById('btn-auth-trigger');
        const balCard = document.getElementById('header-balance-card');

        if (isLoggedIn && this.user) {
            if (balCard) balCard.classList.remove('hidden');
            if (authBtn) {
                const maskedPhone = this.user.phone.replace(/(\d{3})\d{4}(\d{3})/, '$1****$2');
                authBtn.textContent = `📱 ${maskedPhone} (Logout)`;
                authBtn.onclick = () => {
                    if (confirm('Do you want to log out?')) {
                        localStorage.removeItem('asg_token');
                        localStorage.removeItem('asg_balance');
                        location.reload();
                    }
                };
            }
        } else {
            if (balCard) balCard.classList.add('hidden');
            this.balance = 0.00;
            this.updateBalanceUI();
            if (authBtn) {
                authBtn.textContent = 'Login / Register';
                authBtn.onclick = () => openAuthModal();
            }
        }
    }

    startLiveBalanceWatcher() {
        if (this._balWatcher) clearInterval(this._balWatcher);
        this._syncLockUntil = 0;

        this._balWatcher = setInterval(async () => {
            if (!this.token || document.hidden) return;
            if (Date.now() < (this._syncLockUntil || 0)) return;

            try {
                const res = await fetch('/api/auth/me', {
                    headers: { 'Authorization': `Bearer ${this.token}` },
                    cache: 'no-store'
                });
                const data = await res.json();
                if (data.success && data.user && typeof data.user.balance === 'number') {
                    const serverBal = Math.round(data.user.balance * 100) / 100;
                    const localBal = Math.round(this.balance * 100) / 100;
                    const diff = Math.round((serverBal - localBal) * 100) / 100;

                    if (Math.abs(diff) >= 0.01) {
                        this.balance = serverBal;
                        localStorage.setItem('asg_balance', serverBal);
                        // Refresh ONLY balance display with smooth glow flash (no page reload!)
                        this.updateBalanceUI(diff > 0 ? 'up' : 'down');

                        if (diff > 0) {
                            this.showToast(`💰 Balance Updated: +₹${diff.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 'success');
                            if (window.sound && window.sound.coin) window.sound.coin();
                        }
                    }
                }
            } catch (e) {}
        }, 3000);
    }

    updateBalanceUI(flashDir = null) {
        const balEls = document.querySelectorAll('.user-balance-val');
        const formatted = `₹${this.balance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        balEls.forEach(el => {
            el.textContent = formatted;
            if (flashDir) {
                el.classList.remove('balance-flash-up', 'balance-flash-down');
                void el.offsetWidth; // trigger reflow for replay
                el.classList.add(flashDir === 'up' ? 'balance-flash-up' : 'balance-flash-down');
            }
        });

        const depBal = (this.user && typeof this.user.deposit_balance === 'number')
            ? this.user.deposit_balance
            : (window._currentTurnoverInfo && typeof window._currentTurnoverInfo.deposit_balance === 'number' ? window._currentTurnoverInfo.deposit_balance : 0);
        const winBal = (this.user && typeof this.user.winning_balance === 'number')
            ? this.user.winning_balance
            : (window._currentTurnoverInfo && typeof window._currentTurnoverInfo.winning_balance === 'number' ? window._currentTurnoverInfo.winning_balance : this.balance);

        const depEl = document.getElementById('wd-deposit-bal-val');
        const winEl = document.getElementById('wd-winning-bal-val');
        const walDepEl = document.getElementById('wal-deposit-amt');
        const walWinEl = document.getElementById('wal-winning-amt');
        if (depEl) depEl.textContent = `₹${Number(depBal || 0).toFixed(2)}`;
        if (winEl) winEl.textContent = `₹${Number(winBal || 0).toFixed(2)}`;
        if (walDepEl) walDepEl.textContent = `₹${Number(depBal || 0).toFixed(2)}`;
        if (walWinEl) walWinEl.textContent = `₹${Number(winBal || 0).toFixed(2)}`;
    }

    async syncGameDelta(delta) {
        if (!this.token || !delta) return;
        this._syncLockUntil = Date.now() + 4000;
        try {
            const res = await fetch('/api/wallet/sync-game-delta', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify({ delta })
            });
            const d = await res.json();
            if (d.success && typeof d.balance === 'number') {
                this.balance = d.balance;
                localStorage.setItem('asg_balance', this.balance);
                this.updateBalanceUI();
            }
        } catch (e) {}
    }

    setLocalBalance(newBalance, flashDir = null) {
        this.balance = Math.max(0, Math.round(Number(newBalance || 0) * 100) / 100);
        this._syncLockUntil = Date.now() + 5000;
        localStorage.setItem('asg_balance', this.balance);
        this.updateBalanceUI(flashDir);
        if (typeof updateWithdrawSummary === 'function') updateWithdrawSummary();
        if (typeof updateWalletCenterRings === 'function') updateWalletCenterRings();
    }

    addBalance(amount, desc, skipServerSync = false) {
        this.balance = Math.round((this.balance + amount) * 100) / 100;
        localStorage.setItem('asg_balance', this.balance);
        this.updateBalanceUI('up');
        if (!skipServerSync) this.syncGameDelta(amount);
    }

    deductBalance(amount, desc, skipServerSync = false) {
        this.balance = Math.max(0, Math.round((this.balance - amount) * 100) / 100);
        localStorage.setItem('asg_balance', this.balance);
        this.updateBalanceUI('down');
        if (!skipServerSync) this.syncGameDelta(-amount);
    }

    saveUserBet(bet) {
        this.userBets.unshift(bet);
        this.renderAccountTab();
    }

    _getLocalGameHistoryKey() {
        return `asg_game_history_${this.uid || 'guest'}`;
    }

    getLocalGameHistory() {
        const keys = [this._getLocalGameHistoryKey()];
        const numUid = Number(this.uid);
        if (this.rawUserId && String(this.rawUserId) !== String(this.uid)) {
            keys.push(`asg_game_history_${this.rawUserId}`);
        }
        if (Number.isFinite(numUid) && numUid >= 100000) {
            keys.push(`asg_game_history_${numUid - 100000}`);
        }
        keys.push('asg_game_history_849204', 'asg_game_history_guest');

        const byId = new Map();
        for (const k of Array.from(new Set(keys))) {
            try {
                const arr = JSON.parse(localStorage.getItem(k) || '[]');
                if (Array.isArray(arr)) {
                    for (const item of arr) {
                        if (!item || !item.id) continue;
                        const prev = byId.get(String(item.id));
                        if (!prev || (prev.status === 'Pending' && item.status !== 'Pending')) {
                            byId.set(String(item.id), item);
                        }
                    }
                }
            } catch (e) {}
        }
        return Array.from(byId.values()).sort((a, b) =>
            String(b.created_at || '').localeCompare(String(a.created_at || ''))
        );
    }

    recordGameHistory(entry) {
        if (!entry) return;
        const item = {
            id: String(entry.id || ('GH' + Date.now() + Math.floor(Math.random() * 999))),
            game: entry.game || 'Game',
            detail: entry.detail || '',
            bet_amount: parseFloat(entry.bet_amount || 0) || 0,
            win_amount: parseFloat(entry.win_amount || 0) || 0,
            status: entry.status || 'Pending',
            created_at: entry.created_at || new Date().toISOString()
        };

        const list = this.getLocalGameHistory();
        const idx = list.findIndex(x => String(x.id) === item.id);
        if (idx >= 0) {
            list[idx] = Object.assign({}, list[idx], item);
        } else {
            list.unshift(item);
        }
        if (list.length > 100) list.length = 100;
        localStorage.setItem(this._getLocalGameHistoryKey(), JSON.stringify(list));

        if (this.token) {
            fetch('/api/game/log-history', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify(item)
            }).catch(() => {});
        }
        // Live refresh modal if currently open
        const modal = document.getElementById('game-history-modal');
        if (modal && !modal.classList.contains('hidden') && typeof loadUnifiedGameHistory === 'function') {
            loadUnifiedGameHistory();
        }
        return item.id;
    }

    showToast(message, type = 'info') {
        const toastContainer = document.getElementById('toast-container');
        if (!toastContainer) return;

        const toast = document.createElement('div');
        toast.className = `custom-toast toast-${type} animate-slide-down`;

        let icon = 'ℹ️';
        if (type === 'success') icon = '✅';
        else if (type === 'error') icon = '❌';
        else if (type === 'warning') icon = '⚠️';

        toast.innerHTML = `<span class="toast-icon">${icon}</span> <span>${message}</span>`;
        toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('toast-fadeout');
            setTimeout(() => toast.remove(), 400);
        }, 2800);
    }

    showWinModal(amount, gameDesc) {
        const modal = document.getElementById('win-modal');
        if (!modal) return;

        const amountEl = document.getElementById('win-modal-amount');
        const descEl = document.getElementById('win-modal-desc');

        if (amountEl) amountEl.textContent = `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
        if (descEl) descEl.textContent = gameDesc;

        modal.classList.remove('hidden');
        if (window.sound) window.sound.jackpot();
    }

    closeWinModal() {
        const modal = document.getElementById('win-modal');
        if (modal) modal.classList.add('hidden');
    }

    setupEventListeners() {
        // Tab switching (ignore center wheel button which has no data-tab)
        document.querySelectorAll('.tabbar-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const tab = item.dataset.tab;
                if (!tab) return;
                this.switchTab(tab);
                if (window.sound) window.sound.click();
            });
        });

        // Refresh balance animation
        const refreshBtn = document.getElementById('btn-refresh-balance');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', async () => {
                refreshBtn.classList.add('spin-anim');
                if (window.sound) window.sound.click();
                await this.fetchUserProfile();
                setTimeout(() => {
                    refreshBtn.classList.remove('spin-anim');
                    this.showToast('Balance updated!', 'success');
                }, 600);
            });
        }

        // Sound toggle
        const soundBtn = document.getElementById('sound-toggle-btn');
        if (soundBtn) {
            soundBtn.addEventListener('click', () => {
                const enabled = window.sound.toggle();
                soundBtn.textContent = enabled ? '🔊' : '🔇';
                this.showToast(`Sound ${enabled ? 'Enabled' : 'Muted'}`, 'info');
            });
        }

        // Modals triggers
        document.querySelectorAll('.trigger-recharge').forEach(btn => {
            btn.addEventListener('click', () => this.openRechargeModal());
        });
        document.querySelectorAll('.trigger-withdraw').forEach(btn => {
            btn.addEventListener('click', () => this.openWithdrawModal());
        });

        const closeRechargeBtn = document.getElementById('recharge-modal-close');
        if (closeRechargeBtn) {
            closeRechargeBtn.addEventListener('click', () => this.closeRechargeModal());
        }

        const closeWithdrawBtn = document.getElementById('withdraw-modal-close');
        if (closeWithdrawBtn) {
            closeWithdrawBtn.addEventListener('click', () => this.closeWithdrawModal());
        }

        const closeAuthBtn = document.getElementById('auth-modal-close');
        if (closeAuthBtn) {
            closeAuthBtn.addEventListener('click', () => closeAuthModal());
        }

        // Quick recharge amount pills
        document.querySelectorAll('.recharge-pill').forEach(pill => {
            pill.addEventListener('click', () => {
                const amt = pill.dataset.amount;
                const input = document.getElementById('recharge-amount-input');
                if (input) input.value = amt;
                document.querySelectorAll('.recharge-pill').forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
                if (typeof updateDepositButtonState === 'function') updateDepositButtonState();
                if (window.sound) window.sound.click();
            });
        });

        // Submit Recharge (Server API)
        const submitRechargeBtn = document.getElementById('btn-submit-recharge');
        if (submitRechargeBtn) {
            submitRechargeBtn.addEventListener('click', async () => {
                if (!this.token) {
                    this.showToast('Please login first to deposit funds!', 'warning');
                    openAuthModal();
                    return;
                }
                const amtInput = document.getElementById('recharge-amount-input');
                const utrInput = document.getElementById('recharge-utr-input');
                const amt = parseFloat(amtInput ? amtInput.value : 0);
                const utr = utrInput ? utrInput.value.trim() : '';

                if (!amt || amt < 100) {
                    this.showToast('Minimum deposit is ₹100', 'warning');
                    return;
                }
                if (!utr || utr.length < 6) {
                    this.showToast('Please enter your 12-digit UTR/Transaction ID', 'warning');
                    return;
                }

                try {
                    const res = await fetch('/api/wallet/deposit', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${this.token}`
                        },
                        body: JSON.stringify({ amount: amt, utr, channel: window._selectedDepositChannel || 'UPI-QR' })
                    });
                    const d = await res.json();
                    if (d.success) {
                        this.showToast(d.message || (d.instant_credited ? 'Deposit verified & credited instantly!' : 'Deposit submitted! Waiting for admin approval.'), 'success');
                        if (d.instant_credited) {
                            if (window.sound && window.sound.coin) window.sound.coin();
                            this.fetchUserProfile();
                        }
                        if (typeof closeDepositCheckoutSheet === 'function') closeDepositCheckoutSheet();
                        if (typeof loadDepositPageHistory === 'function') loadDepositPageHistory();
                        if (utrInput) utrInput.value = '';
                    } else {
                        this.showToast(d.message, 'error');
                    }
                } catch (e) {
                    this.showToast('Error submitting deposit', 'error');
                }
            });
        }

        // Submit Withdraw (Server API)
        const submitWithdrawBtn = document.getElementById('btn-submit-withdraw');
        if (submitWithdrawBtn) {
            submitWithdrawBtn.addEventListener('click', async () => {
                if (this._withdrawSubmitting) return;
                if (!this.token) {
                    this.showToast('Please login first to withdraw funds!', 'warning');
                    openAuthModal();
                    return;
                }
                const amtInput = document.getElementById('withdraw-amount-input');
                const accInput = document.getElementById('withdraw-account-input');
                const amt = parseFloat(amtInput ? amtInput.value : 0);
                const account = accInput ? accInput.value.trim() : '';

                // 1. Time Restriction (10:00 AM to 08:00 PM IST)
                const now = new Date();
                const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
                const istH = ist.getUTCHours();
                const istM = ist.getUTCMinutes();
                const isTimeOpen = (istH >= 10 && (istH < 20 || (istH === 20 && istM === 0)));
                if (!isTimeOpen) {
                    this.showToast('Withdrawal service is open only from 10:00 AM to 08:00 PM (IST)! Please submit during active hours.', 'warning');
                    return;
                }

                if (!amt || amt < 110) {
                    this.showToast('Minimum withdrawal is ₹110', 'warning');
                    return;
                }
                if (amt > this.balance) {
                    this.showToast('Insufficient wallet balance!', 'error');
                    return;
                }

                // 2. Strict Winning Wallet Requirement Check
                const winBal = window._currentTurnoverInfo && typeof window._currentTurnoverInfo.winning_balance === 'number'
                    ? window._currentTurnoverInfo.winning_balance
                    : (this.user && typeof this.user.winning_balance === 'number' ? this.user.winning_balance : this.balance);

                if (amt > winBal) {
                    const maxWd = Number(winBal || 0).toFixed(2);
                    this.showToast(`Withdrawal sirf Winning Wallet se ho sakta hai! Aapka Winning balance ₹${maxWd} hai. Deposit wallet ka amount sirf bet lagane ke liye hai.`, 'warning');
                    return;
                }

                if (!account) {
                    this.showToast('Please enter your UPI ID or Bank Account', 'warning');
                    return;
                }

                this._withdrawSubmitting = true;
                submitWithdrawBtn.disabled = true;
                try {
                    const res = await fetch('/api/wallet/withdraw', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${this.token}`
                        },
                        body: JSON.stringify({ amount: amt, bank_info: account })
                    });
                    const d = await res.json();
                    if (d.success) {
                        const updatedBal = (typeof d.balance === 'number')
                            ? d.balance
                            : Math.max(0, this.balance - amt);
                        this.setLocalBalance(updatedBal, 'down');
                        const tds = Math.round(amt * 0.18 * 100) / 100;
                        const net = Math.max(0, Math.round((amt - tds) * 100) / 100);
                        this.showToast(`Withdrawal ₹${amt.toFixed(2)} requested! (18% TDS: -₹${tds.toFixed(2)} | Net Received: ₹${net.toFixed(2)})`, 'success');
                        if (amtInput) amtInput.value = '';
                        if (typeof updateWithdrawSummary === 'function') updateWithdrawSummary();
                        if (typeof loadWithdrawPageHistory === 'function') loadWithdrawPageHistory();
                    } else {
                        this.showToast(d.message, 'error');
                    }
                } catch (e) {
                    this.showToast('Error submitting withdrawal', 'error');
                } finally {
                    this._withdrawSubmitting = false;
                    submitWithdrawBtn.disabled = false;
                }
            });
        }

        // Game category filter in Home
        document.querySelectorAll('.cat-pill').forEach(pill => {
            pill.addEventListener('click', () => {
                const cat = pill.dataset.cat;
                document.querySelectorAll('.cat-pill').forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
                this.filterGameCards(cat);
                if (window.sound) window.sound.click();
            });
        });

        // Game card clicks
        document.querySelectorAll('[data-open-game]').forEach(card => {
            card.addEventListener('click', () => {
                const gameName = card.dataset.openGame;
                this.openGameView(gameName);
                if (window.sound) window.sound.click();
            });
        });

        // Back to home from game views
        document.querySelectorAll('.btn-back-home').forEach(btn => {
            btn.addEventListener('click', () => {
                this.backToHome();
                if (window.sound) window.sound.click();
            });
        });

        // Win modal close
        const closeWinBtn = document.getElementById('btn-close-win-modal');
        if (closeWinBtn) {
            closeWinBtn.addEventListener('click', () => this.closeWinModal());
        }
    }

    switchTab(tabName) {
        this.currentTab = tabName;

        document.querySelectorAll('.tabbar-item').forEach(item => {
            if (item.dataset.tab === tabName) item.classList.add('active');
            else item.classList.remove('active');
        });

        document.querySelectorAll('.tab-view').forEach(view => view.classList.add('hidden'));
        document.querySelectorAll('.game-view').forEach(view => view.classList.add('hidden'));
        if (window.sound && window.sound.suspendIfNoGame) window.sound.suspendIfNoGame();

        const targetView = document.getElementById(`tab-${tabName}`);
        if (targetView) targetView.classList.remove('hidden');

        if (tabName === 'home') {
            const homeMain = document.getElementById('home-main-content');
            if (homeMain) homeMain.classList.remove('hidden');
        }

        if (tabName === 'activity') this.renderActivityTab();
        if (tabName === 'promotion') this.renderPromotionTab();
        if (tabName === 'account') this.renderAccountTab();
        if (tabName === 'wallet') {
            this.renderTransactions();
            if (typeof updateWalletCenterRings === 'function') updateWalletCenterRings();
        }
    }

    showSplashLoader(label = 'Loading Secure Casino Engine...', durationMs = 500) {
        const overlay = document.getElementById('app-splash-loader');
        const fill = document.getElementById('splash-progress-fill');
        const pct = document.getElementById('splash-percent');
        const status = document.getElementById('splash-status-text');
        if (!overlay) return;

        overlay.classList.remove('fade-out');
        overlay.style.display = 'flex';
        if (status) status.textContent = label;

        let p = 0;
        const step = 100 / Math.max(8, durationMs / 35);
        const iv = setInterval(() => {
            p = Math.min(100, p + step);
            if (fill) fill.style.width = `${Math.floor(p)}%`;
            if (pct) pct.textContent = `${Math.floor(p)}%`;
            if (p >= 100) {
                clearInterval(iv);
                overlay.classList.add('fade-out');
                setTimeout(() => { overlay.style.display = 'none'; }, 280);
            }
        }, 35);
    }

    showError1003Toast() {
        const el = document.getElementById('game-error-1003-toast');
        if (!el) return;
        el.classList.remove('hidden');
        if (this._err1003Timer) clearTimeout(this._err1003Timer);
        this._err1003Timer = setTimeout(() => {
            el.classList.add('hidden');
        }, 2600);
    }

    openGameView(gameName, bypassBalanceGate = false) {
        // Require balance >= ₹1 to enter any cash game (Invite Wheel & Free Friend Rooms stay open)
        if (!bypassBalanceGate && gameName !== 'wheel' && Number(this.balance || 0) < 1) {
            this.showError1003Toast();
            return;
        }

        const labels = {
            wingo: 'Loading Win Go Live Arena...',
            aviator: 'Connecting Aviator Flight Radar...',
            mines: 'Preparing 5x5 Diamond Vault...',
            k3: 'Warming Up K3 Dice Table...',
            ludo: 'Loading Ludo Supreme Cash Board...',
            king: 'Loading AS King Live Result Board...'
        };
        this.showSplashLoader(labels[gameName] || 'Loading Game Engine...', 420);

        // Ensure Home tab container is visible (so opening Wheel or any game works from ANY tab!)
        document.querySelectorAll('.tab-view').forEach(v => v.classList.add('hidden'));
        const tabHome = document.getElementById('tab-home');
        if (tabHome) tabHome.classList.remove('hidden');

        const homeMain = document.getElementById('home-main-content');
        if (homeMain) homeMain.classList.add('hidden');

        document.querySelectorAll('.game-view').forEach(view => view.classList.add('hidden'));

        const gameView = document.getElementById(`game-view-${gameName}`);
        if (gameView) {
            gameView.classList.remove('hidden');
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        if (gameName === 'aviator' && window.aviatorGame) {
            setTimeout(() => window.aviatorGame.resizeCanvas(), 80);
        }
        if (gameName === 'ludo' && window.ludoGame) {
            setTimeout(() => window.ludoGame.resizeCanvas(), 80);
        }
        if (gameName === 'wheel' && window.wheelGame) {
            setTimeout(() => window.wheelGame.resizeCanvas(), 80);
        }
        if (gameName === 'king' && window.kingGame) {
            window.kingGame.fetchMarkets();
        }
    }

    backToHome() {
        document.querySelectorAll('.game-view').forEach(view => view.classList.add('hidden'));
        const homeMain = document.getElementById('home-main-content');
        if (homeMain) homeMain.classList.remove('hidden');
        this.switchTab('home');
    }

    filterGameCards(category) {
        document.querySelectorAll('.game-card').forEach(card => {
            const cardCat = card.dataset.category || '';
            if (category === 'all' || cardCat.includes(category)) {
                card.style.display = 'flex';
            } else {
                card.style.display = 'none';
            }
        });
    }

    openRechargeModal() {
        const modal = document.getElementById('recharge-modal');
        if (modal) modal.classList.remove('hidden');
        if (typeof fetchLivePaymentDetails === 'function') fetchLivePaymentDetails();
        if (typeof updateDepositButtonState === 'function') updateDepositButtonState();
        if (typeof loadDepositPageHistory === 'function') loadDepositPageHistory();
        if (window.sound) window.sound.click();
    }

    closeRechargeModal() {
        const modal = document.getElementById('recharge-modal');
        if (modal) modal.classList.add('hidden');
        if (typeof closeDepositCheckoutSheet === 'function') closeDepositCheckoutSheet();
    }

    openWithdrawModal() {
        const modal = document.getElementById('withdraw-modal');
        if (modal) modal.classList.remove('hidden');
        if (typeof selectWithdrawMethod === 'function') selectWithdrawMethod(window._selectedWithdrawMethod || 'BANK');
        if (typeof fetchUserTurnoverStatus === 'function') fetchUserTurnoverStatus();
        if (typeof updateWithdrawSummary === 'function') updateWithdrawSummary();
        if (typeof loadWithdrawPageHistory === 'function') loadWithdrawPageHistory();
        if (window.sound) window.sound.click();
    }

    closeWithdrawModal() {
        const modal = document.getElementById('withdraw-modal');
        if (modal) modal.classList.add('hidden');
        if (typeof closeAddBeneficiarySheet === 'function') closeAddBeneficiarySheet();
    }

    startWinningTicker() {
        const ticker = document.getElementById('winning-ticker-list');
        if (!ticker) return;

        const fakeWinners = [
            { name: 'Mem***KAA', amount: 2940, game: 'Win Go 1Min' },
            { name: 'Mem***RCN', amount: 484.12, game: 'Win Go 30s' },
            { name: 'Mem***MFM', amount: 5880, game: 'Aviator' },
            { name: 'Mem***NMU', amount: 150, game: 'Mines' },
            { name: 'Mem***SCB', amount: 260, game: 'K3 Dice' },
            { name: 'Mem***ZNI', amount: 1470, game: 'Win Go 3Min' },
            { name: 'Mem***UKX', amount: 12500, game: 'Aviator' },
            { name: 'Mem***VUN', amount: 4200, game: 'Win Go 1Min' }
        ];

        let index = 0;
        setInterval(() => {
            const item = fakeWinners[index % fakeWinners.length];
            const div = document.createElement('div');
            div.className = 'ticker-item animate-fade-in';
            div.innerHTML = `
                <div class="ticker-avatar">👤</div>
                <div class="ticker-info">
                    <span class="ticker-name">${item.name}</span>
                    <span class="ticker-game">${item.game}</span>
                </div>
                <div class="ticker-win">Receive ₹${item.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
            `;
            ticker.prepend(div);
            if (ticker.children.length > 5) ticker.lastElementChild.remove();
            index++;
        }, 2200);
    }

    renderActivityTab() {
        const rewards = [10, 20, 30, 40, 50, 70, 100];
        const grid = document.getElementById('checkin-grid');
        if (grid) {
            grid.innerHTML = rewards.map((rew, idx) => {
                const dayNum = idx + 1;
                const isClaimed = dayNum < this.checkinDay;
                const isCurrent = dayNum === this.checkinDay;
                return `
                    <div class="checkin-day-card ${isClaimed ? 'claimed' : (isCurrent ? 'current' : '')}" data-day="${dayNum}">
                        <div class="day-label">Day ${dayNum}</div>
                        <div class="reward-coin">🪙</div>
                        <div class="reward-amt">+₹${rew}</div>
                        <div class="day-status">${isClaimed ? 'Claimed ✓' : (isCurrent ? 'Ready' : 'Locked')}</div>
                    </div>
                `;
            }).join('');
        }

        const checkinBtn = document.getElementById('btn-claim-checkin');
        if (checkinBtn) {
            const todayStr = new Date().toDateString();
            if (this.lastCheckinDate === todayStr) {
                checkinBtn.disabled = true;
                checkinBtn.textContent = 'Already Claimed Today ✓';
            } else {
                checkinBtn.disabled = false;
                const reward = rewards[Math.min(this.checkinDay - 1, 6)];
                checkinBtn.textContent = `Claim Day ${this.checkinDay} Bonus (+₹${reward})`;
                checkinBtn.onclick = () => {
                    this.addBalance(reward, `Day ${this.checkinDay} Check-in Bonus`);
                    this.lastCheckinDate = todayStr;
                    this.checkinDay = (this.checkinDay % 7) + 1;
                    localStorage.setItem('asg_checkin_day', this.checkinDay);
                    localStorage.setItem('asg_checkin_date', this.lastCheckinDate);
                    if (window.sound) window.sound.win();
                    this.showToast(`Claimed ₹${reward} Check-in Bonus!`, 'success');
                    this.renderActivityTab();
                };
            }
        }

        this.setupLuckyWheel();
    }

    setupLuckyWheel() {
        const wheel = document.getElementById('wheel-canvas');
        const spinBtn = document.getElementById('btn-spin-wheel');
        if (!wheel || !spinBtn) return;

        const prizes = [10, 50, 5, 100, 20, 500, 15, 200];
        let isSpinning = false;
        let currentRotation = 0;

        spinBtn.onclick = () => {
            if (isSpinning) return;
            isSpinning = true;
            spinBtn.disabled = true;

            const prizeIndex = Math.floor(Math.random() * prizes.length);
            const prizeAmount = prizes[prizeIndex];
            const extraDegrees = 360 * 5 + (360 - (prizeIndex * (360 / prizes.length)) - 22.5);
            currentRotation += extraDegrees;

            wheel.style.transition = 'transform 4s cubic-bezier(0.15, 0.9, 0.2, 1)';
            wheel.style.transform = `rotate(${currentRotation}deg)`;

            if (window.sound) window.sound.diceRoll();

            setTimeout(() => {
                isSpinning = false;
                spinBtn.disabled = false;
                this.addBalance(prizeAmount, 'Lucky Wheel Bonus');
                if (window.sound) window.sound.jackpot();
                this.showWinModal(prizeAmount, `Lucky Wheel Spin Prize!`);
            }, 4100);
        };
    }

    async renderPromotionTab() {
        const codeEl = document.getElementById('promo-code');
        const linkEl = document.getElementById('promo-link');
        const dateInp = document.getElementById('sub-filter-date');

        const currentOrigin = window.location.origin;
        const link = `${currentOrigin}/#/register?invitationCode=${this.inviteCode}`;

        if (codeEl) codeEl.textContent = this.inviteCode;
        if (linkEl) linkEl.value = link;
        if (dateInp && !dateInp.value) dateInp.value = new Date().toISOString().slice(0, 10);

        this._subordinatesCache = [];

        if (this.token) {
            try {
                const res = await fetch('/api/referral/stats', {
                    headers: { 'Authorization': `Bearer ${this.token}` }
                });
                const d = await res.json();
                if (d.success) {
                    const subs = d.subordinates || [];
                    this._subordinatesCache = subs;
                    const unclaimed = parseFloat(d.unclaimedCommission || d.unclaimed_commission || 0);
                    const totalComm = parseFloat(d.totalCommission || d.total_commission || unclaimed);

                    const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
                    setTxt('promo-yesterday-comm', totalComm.toFixed(0));
                    setTxt('ag-direct-reg', subs.length);
                    setTxt('ag-team-reg', subs.length);
                    setTxt('ag-this-week', totalComm.toFixed(0));
                    setTxt('ag-total-comm', totalComm.toFixed(0));
                    setTxt('ag-direct-sub-count', subs.length);
                    setTxt('ag-team-sub-count', subs.length);

                    this.renderSubordinatesList(subs);
                }
            } catch (e) {}
        }
    }

    renderSubordinatesList(list) {
        const subList = document.getElementById('subordinates-list');
        if (!subList) return;
        if (!list || list.length === 0) {
            subList.innerHTML = `<div class="bdg-no-data"><div style="font-size:48px; opacity:0.35; margin-bottom:8px;">📜</div><div>No data</div></div>`;
            return;
        }
        subList.innerHTML = list.map(s => `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 12px; border-bottom:1px solid rgba(255,255,255,0.06);">
                <div>
                    <div style="color:#fff; font-weight:700; font-size:13px;">📱 ${s.phone || 'User'}</div>
                    <div style="color:#94a3b8; font-size:11px;">UID: ${s.id || '---'}</div>
                </div>
                <div style="color:#f5c443; font-size:11px;">${(s.date || s.created_at || '').slice(0, 10)}</div>
            </div>
        `).join('');
    }

    renderAccountTab() {
        const uidEl = document.getElementById('account-uid');
        if (uidEl) uidEl.textContent = String(this.uid).padStart(6, '0');

        const nameEl = document.getElementById('account-member-name');
        if (nameEl) {
            if (this.user && this.user.phone) {
                nameEl.textContent = `MEMBER${this.user.invite_code || this.user.phone.slice(-6)}`;
            } else {
                nameEl.textContent = 'GUEST PLAYER';
            }
        }

        const vipEl = document.getElementById('account-vip-pill');
        if (vipEl) vipEl.textContent = `⭐ VIP${this.vipLevel || 1}`;

        const lastEl = document.getElementById('account-last-login');
        if (lastEl) {
            const now = new Date();
            lastEl.textContent = `Last login: ${now.toISOString().replace('T', ' ').slice(0, 19)}`;
        }

        const langVal = document.getElementById('account-lang-val');
        if (langVal) langVal.textContent = (typeof currentLang !== 'undefined' && currentLang === 'hi') ? 'हिंदी' : 'English';
    }

    async renderTransactions() {
        const container = document.getElementById('transactions-list');
        if (!container) return;

        if (this.token) {
            try {
                const res = await fetch('/api/wallet/transactions', {
                    headers: { 'Authorization': `Bearer ${this.token}` }
                });
                const d = await res.json();
                if (d.success && d.transactions.length > 0) {
                    container.innerHTML = d.transactions.map(tx => {
                        const isCredit = ['deposit', 'win', 'commission'].includes(tx.type);
                        return `
                            <div class="tx-card">
                                <div class="tx-left">
                                    <span class="tx-desc">${tx.type.toUpperCase()}: ${tx.details || ''}</span>
                                    <span class="tx-time">${tx.created_at} | Status: <strong style="color:${tx.status === 'approved' ? '#10b981' : (tx.status === 'pending' ? '#f5c443' : '#ef4444')}">${tx.status.toUpperCase()}</strong></span>
                                </div>
                                <div class="tx-amount ${isCredit ? 'text-win' : 'text-loss'}">
                                    ${isCredit ? '+' : '-'}₹${tx.amount.toFixed(2)}
                                </div>
                            </div>
                        `;
                    }).join('');
                    return;
                }
            } catch (e) {}
        }

        container.innerHTML = `<div class="empty-state"><p>No transactions yet</p></div>`;
    }

    initGames() {
        window.wingoGame = new WinGoGame(this);
        window.aviatorGame = new AviatorGame(this);
        window.minesGame = new MinesGame(this);
        window.k3Game = new K3Game(this);
    }
}

// ========================================================
// HINDI / ENGLISH LANGUAGE SYSTEM (i18n)
// ========================================================
const I18N_DICT = {
    en: {
        reg_title: 'Register your phone',
        login_title: 'Log in with phone',
        forgot_title: 'Reset your password',
        phone_number: 'Phone number',
        set_password: 'Set password',
        confirm_password: 'Confirm password',
        new_password: 'New password',
        password: 'Password',
        invite_code: 'Invite code',
        agree_prefix: 'I have read and agree',
        privacy_agreement: '【Privacy Agreement】',
        btn_register: 'Register',
        btn_login: 'Log in',
        btn_reset: 'Reset Password',
        have_account: 'I have an account',
        remember_pass: 'Remember password',
        forgot_password: 'Forgot password?',
        back_login: '← Back to Login',
        ph_phone: 'Please enter the phone number',
        ph_set_pass: 'Set password',
        ph_confirm_pass: 'Confirm password',
        ph_enter_pass: 'Please enter password',
        ph_new_pass: 'Enter new password',
        ph_invite: 'Please enter the invitation code',
        login_register: 'Login / Register',
        total_balance: 'Total Balance',
        btn_deposit: '+ Deposit',
        btn_withdraw: 'Withdraw',
        nav_home: 'Home',
        nav_activity: 'Activity',
        nav_promo: 'Get ₹500',
        nav_wallet: 'Wallet',
        nav_account: 'Account',
        fdb_title: 'Extra first deposit bonus',
        fdb_sub: 'Each account can only receive rewards once',
        fdb_no_remind: 'No more reminders today',
        gmail_label: 'Gmail (For One-Time OTP)',
        otp_label: 'Gmail OTP Code',
        btn_send_otp: 'Send OTP',
        phone_or_gmail: 'Registered Phone or Gmail',
        ph_gmail: 'Enter your Gmail (e.g. name@gmail.com)',
        ph_otp: 'Enter 6-digit OTP from Gmail',
        ph_phone_gmail: 'Enter Phone or Gmail'
    },
    hi: {
        reg_title: 'अपना फ़ोन रजिस्टर करें',
        login_title: 'फ़ोन नंबर से लॉगिन करें',
        forgot_title: 'पासवर्ड रीसेट करें',
        phone_number: 'फ़ोन नंबर',
        set_password: 'पासवर्ड सेट करें',
        confirm_password: 'पासवर्ड की पुष्टि करें',
        new_password: 'नया पासवर्ड',
        password: 'पासवर्ड',
        invite_code: 'इनवाइट कोड',
        agree_prefix: 'मैंने पढ़ा है और सहमत हूँ',
        privacy_agreement: '【गोपनीयता नीति】',
        btn_register: 'रजिस्टर करें',
        btn_login: 'लॉगिन करें',
        btn_reset: 'पासवर्ड बदलें',
        have_account: 'मेरा अकाउंट पहले से है',
        remember_pass: 'पासवर्ड याद रखें',
        forgot_password: 'पासवर्ड भूल गए?',
        back_login: '← लॉगिन पर वापस जाएं',
        ph_phone: 'कृपया 10 अंकों का फ़ोन नंबर डालें',
        ph_set_pass: 'पासवर्ड सेट करें',
        ph_confirm_pass: 'पासवर्ड दोबारा डालें',
        ph_enter_pass: 'कृपया पासवर्ड डालें',
        ph_new_pass: 'नया पासवर्ड डालें',
        ph_invite: 'कृपया इनवाइट कोड डालें (वैकल्पिक)',
        login_register: 'लॉगिन / रजिस्टर',
        total_balance: 'कुल बैलेंस',
        btn_deposit: '+ जमा करें',
        btn_withdraw: 'निकासी',
        nav_home: 'होम',
        nav_activity: 'गतिविधि',
        nav_promo: '₹500 कमाएं',
        nav_wallet: 'वॉलेट',
        nav_account: 'अकाउंट',
        fdb_title: 'एक्स्ट्रा फर्स्ट डिपॉजिट बोनस',
        fdb_sub: 'प्रत्येक अकाउंट को यह इनाम केवल एक बार मिल सकता है',
        fdb_no_remind: 'आज दोबारा न दिखाएं',
        gmail_label: 'जीमेल (एक बार OTP वेरिफिकेशन के लिए)',
        otp_label: 'जीमेल OTP कोड',
        btn_send_otp: 'OTP भेजें',
        phone_or_gmail: 'रजिस्टर्ड फ़ोन या जीमेल',
        ph_gmail: 'अपना जीमेल डालें (जैसे name@gmail.com)',
        ph_otp: 'जीमेल पर आया 6 अंकों का OTP डालें',
        ph_phone_gmail: 'रजिस्टर्ड फ़ोन नंबर या जीमेल डालें'
    }
};

let currentLang = localStorage.getItem('asg_lang') || 'en';
let currentAuthView = 'register';

function applyLanguage(lang) {
    currentLang = (lang === 'hi') ? 'hi' : 'en';
    localStorage.setItem('asg_lang', currentLang);
    const dict = I18N_DICT[currentLang];

    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (dict[key]) el.textContent = dict[key];
    });
    document.querySelectorAll('[data-i18n-ph]').forEach(el => {
        const key = el.getAttribute('data-i18n-ph');
        if (dict[key]) el.setAttribute('placeholder', dict[key]);
    });

    // Update all language pills across header, account & auth screen
    document.querySelectorAll('.lang-flag').forEach(el => {
        el.textContent = currentLang === 'hi' ? '🇮🇳' : '🇺🇸';
    });
    document.querySelectorAll('.lang-code').forEach(el => {
        el.textContent = currentLang === 'hi' ? 'हिंदी' : 'EN';
    });
    const accLang = document.getElementById('account-lang-val');
    if (accLang) accLang.textContent = currentLang === 'hi' ? 'हिंदी' : 'English';

    // Update Auth Subheader title according to active tab
    const title = document.getElementById('auth-modal-title');
    if (title) {
        if (currentAuthView === 'login') title.textContent = dict.login_title;
        else if (currentAuthView === 'forgot') title.textContent = dict.forgot_title;
        else title.textContent = dict.reg_title;
    }
}

function logoutUserAccount() {
    if (confirm(currentLang === 'hi' ? 'क्या आप लॉग आउट करना चाहते हैं?' : 'Are you sure you want to log out?')) {
        localStorage.removeItem('asg_token');
        localStorage.removeItem('asg_balance');
        location.reload();
    }
}

function toggleLanguage() {
    const next = currentLang === 'en' ? 'hi' : 'en';
    applyLanguage(next);
    if (window.stateManager) {
        window.stateManager.showToast(next === 'hi' ? '🇮🇳 भाषा हिंदी में बदल दी गई है!' : '🇺🇸 Language switched to English!', 'info');
    }
}

function togglePassEye(inputId, btn) {
    const inp = document.getElementById(inputId);
    if (!inp) return;
    if (inp.type === 'password') {
        inp.type = 'text';
        btn.textContent = '🙈';
    } else {
        inp.type = 'password';
        btn.textContent = '👁️';
    }
}

// Global Auth Modal Functions
function openAuthModal(defaultTab = 'register') {
    const modal = document.getElementById('auth-modal');
    if (modal) modal.classList.remove('hidden');
    switchAuthTab(defaultTab);
}

function closeAuthModal() {
    const modal = document.getElementById('auth-modal');
    if (modal) modal.classList.add('hidden');
}

function switchAuthTab(tab) {
    currentAuthView = tab;
    const formLogin = document.getElementById('form-login');
    const formReg = document.getElementById('form-register');
    const formForgot = document.getElementById('form-forgot');
    const title = document.getElementById('auth-modal-title');
    const dict = I18N_DICT[currentLang] || I18N_DICT.en;

    if (formLogin) formLogin.classList.add('hidden');
    if (formReg) formReg.classList.add('hidden');
    if (formForgot) formForgot.classList.add('hidden');

    if (tab === 'login') {
        if (formLogin) formLogin.classList.remove('hidden');
        if (title) title.textContent = dict.login_title;
    } else if (tab === 'forgot') {
        if (formForgot) formForgot.classList.remove('hidden');
        if (title) title.textContent = dict.forgot_title;
    } else {
        if (formReg) formReg.classList.remove('hidden');
        if (title) title.textContent = dict.reg_title;
    }
}

async function sendAuthOtp(purpose) {
    const isReg = (purpose === 'register');
    const btn = document.getElementById(isReg ? 'btn-reg-send-otp' : 'btn-forgot-send-otp');
    const hint = document.getElementById(isReg ? 'reg-otp-hint' : 'forgot-otp-hint');
    const emailVal = isReg ? (document.getElementById('reg-email')?.value || '').trim() : '';
    const phoneVal = !isReg ? (document.getElementById('forgot-phone')?.value || '').trim() : '';

    if (isReg && (!emailVal || !emailVal.includes('@'))) {
        alert(currentLang === 'hi' ? 'कृपया सही Gmail पता डालें (जैसे name@gmail.com)' : 'Please enter a valid Gmail address first.');
        return;
    }
    if (!isReg && !phoneVal) {
        alert(currentLang === 'hi' ? 'कृपया अपना रजिस्टर्ड फ़ोन नंबर या जीमेल डालें' : 'Please enter your registered phone number or Gmail.');
        return;
    }

    if (btn) { btn.disabled = true; btn.textContent = '...'; }
    if (hint) { hint.style.color = '#fae59f'; hint.textContent = 'Sending OTP to Gmail...'; }

    try {
        const res = await fetch('/api/auth/send-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ purpose, email: emailVal, phone: phoneVal })
        });
        const d = await res.json();
        if (d.success) {
            if (hint) {
                hint.style.color = '#34d399';
                hint.textContent = d.demo_otp
                    ? `✓ OTP: ${d.demo_otp} (Sent for ${d.masked_email})`
                    : `✓ OTP sent to ${d.masked_email}! Check Gmail Inbox/Spam.`;
            }
            if (d.demo_otp) {
                const otpInp = document.getElementById(isReg ? 'reg-otp' : 'forgot-otp');
                if (otpInp && !otpInp.value) otpInp.placeholder = `OTP: ${d.demo_otp}`;
            }
            // Start 45s countdown
            let secs = 45;
            const iv = setInterval(() => {
                secs--;
                if (btn) btn.textContent = `${secs}s`;
                if (secs <= 0) {
                    clearInterval(iv);
                    if (btn) {
                        btn.disabled = false;
                        btn.textContent = currentLang === 'hi' ? 'OTP भेजें' : 'Send OTP';
                    }
                }
            }, 1000);
        } else {
            if (hint) { hint.style.color = '#ef4444'; hint.textContent = '✗ ' + (d.message || 'Failed to send OTP'); }
            if (btn) { btn.disabled = false; btn.textContent = currentLang === 'hi' ? 'OTP भेजें' : 'Send OTP'; }
        }
    } catch (e) {
        if (hint) { hint.style.color = '#ef4444'; hint.textContent = '✗ Network error sending OTP'; }
        if (btn) { btn.disabled = false; btn.textContent = currentLang === 'hi' ? 'OTP भेजें' : 'Send OTP'; }
    }
}

async function submitForgotPassword() {
    const phone = (document.getElementById('forgot-phone')?.value || '').trim();
    const otp = (document.getElementById('forgot-otp')?.value || '').trim();
    const newPass = (document.getElementById('forgot-password')?.value || '').trim();
    const confirmPass = (document.getElementById('forgot-password-confirm')?.value || '').trim();

    if (!phone) {
        alert('Please enter your registered mobile number or Gmail.');
        return;
    }
    if (!otp || otp.length < 6) {
        alert('Please click Send OTP and enter the 6-digit OTP from your Gmail.');
        return;
    }
    if (!newPass || newPass.length < 4) {
        alert('Password must be at least 4 characters long.');
        return;
    }
    if (newPass !== confirmPass) {
        alert('New passwords do not match! Please check and re-enter.');
        return;
    }

    try {
        const res = await fetch('/api/auth/forgot-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, otp, new_password: newPass })
        });
        const d = await res.json();
        if (d.success) {
            alert('Password reset successfully! You can now log in directly without OTP.');
            switchAuthTab('login');
            const loginPhone = document.getElementById('login-phone');
            if (loginPhone) loginPhone.value = phone;
        } else {
            alert(d.message || 'Password reset failed.');
        }
    } catch (e) {
        alert('Request failed. Please check your connection.');
    }
}

async function submitLogin() {
    const phone = document.getElementById('login-phone').value.trim();
    const password = document.getElementById('login-password').value.trim();

    if (!phone || !password) {
        alert('Please enter your mobile number/Gmail and password');
        return;
    }

    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, password })
        });
        const d = await res.json();
        if (d.success) {
            localStorage.setItem('asg_token', d.token);
            sessionStorage.setItem('asg_just_logged_in', '1');
            closeAuthModal();
            location.reload();
        } else {
            alert(d.message);
        }
    } catch (e) {
        alert('Login failed. Please check server.');
    }
}

async function submitRegister() {
    const phone = (document.getElementById('reg-phone')?.value || '').trim();
    const email = (document.getElementById('reg-email')?.value || '').trim();
    const otp = (document.getElementById('reg-otp')?.value || '').trim();
    const password = (document.getElementById('reg-password')?.value || '').trim();
    const confirmPassword = (document.getElementById('reg-password-confirm')?.value || '').trim();
    const invite = (document.getElementById('reg-invite')?.value || '').trim();
    const agree = document.getElementById('reg-agree');

    if (!phone || phone.length < 10) {
        alert(currentLang === 'hi' ? 'कृपया 10 अंकों का सही मोबाइल नंबर डालें' : 'Please enter a valid 10-digit mobile number');
        return;
    }
    if (!email || !email.includes('@')) {
        alert(currentLang === 'hi' ? 'कृपया सही Gmail पता डालें' : 'Please enter a valid Gmail address');
        return;
    }
    if (!otp || otp.length < 6) {
        alert(currentLang === 'hi' ? 'कृपया पहले OTP भेजें पर क्लिक करें और Gmail पर आया 6 अंकों का OTP डालें' : 'Please click Send OTP and enter the 6-digit OTP sent to your Gmail');
        return;
    }
    if (!password || password.length < 4) {
        alert(currentLang === 'hi' ? 'पासवर्ड कम से कम 4 अक्षरों का होना चाहिए' : 'Password must be at least 4 characters');
        return;
    }
    if (confirmPassword && password !== confirmPassword) {
        alert(currentLang === 'hi' ? 'दोनों पासवर्ड मेल नहीं खा रहे हैं!' : 'Set password and Confirm password do not match!');
        return;
    }
    if (agree && !agree.checked) {
        alert(currentLang === 'hi' ? 'कृपया गोपनीयता नीति (Privacy Agreement) को स्वीकार करें' : 'Please agree to the Privacy Agreement first');
        return;
    }

    try {
        const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, email, otp, password, invite_code: invite })
        });
        const d = await res.json();
        if (d.success) {
            localStorage.setItem('asg_token', d.token);
            sessionStorage.setItem('asg_just_logged_in', '1');
            closeAuthModal();
            location.reload();
        } else {
            alert(d.message);
        }
    } catch (e) {
        alert('Registration failed. Please try again.');
    }
}

// ========================================================
// EXTRA FIRST DEPOSIT BONUS POPUP (AUTO AFTER LOGIN)
// ========================================================
const FIRST_DEPOSIT_TIERS = [
    { deposit: 200000, bonus: 10000 },
    { deposit: 100000, bonus: 5000 },
    { deposit: 30000,  bonus: 2000 },
    { deposit: 10000,  bonus: 600 },
    { deposit: 3000,   bonus: 300 },
    { deposit: 1000,   bonus: 150 },
    { deposit: 500,    bonus: 100 },
    { deposit: 300,    bonus: 60 },
    { deposit: 100,    bonus: 20 }
];

function renderFirstDepositTiers() {
    const container = document.getElementById('fdb-list-container');
    if (!container) return;

    const isHi = currentLang === 'hi';
    container.innerHTML = FIRST_DEPOSIT_TIERS.map(t => `
        <div class="fdb-tier-card">
            <div class="fdb-tier-top">
                <div class="fdb-tier-heading">
                    ${isHi ? 'पहला डिपॉजिट' : 'First deposit'} <span class="fdb-tier-amt">${t.deposit}</span>
                </div>
                <div class="fdb-tier-bonus">+ ₹${t.bonus.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
            </div>
            <div class="fdb-tier-desc">
                ${isHi
                    ? `पहली बार ₹${t.deposit} जमा करें और ₹${t.bonus} एक्स्ट्रा बोनस पाएं`
                    : `Deposit ${t.deposit} for the first time and you will receive ${t.bonus} bonus`}
            </div>
            <div class="fdb-tier-bottom">
                <div class="fdb-tier-prog">0/${t.deposit}</div>
                <button class="fdb-deposit-btn" onclick="depositFromBonus(${t.deposit})">${isHi ? 'जमा करें' : 'Deposit'}</button>
            </div>
        </div>
    `).join('');
}

function openFirstDepositModal(force = false) {
    const today = new Date().toISOString().slice(0, 10);
    const hiddenToday = localStorage.getItem('asg_fdb_hide_date') === today;
    const justLoggedIn = sessionStorage.getItem('asg_just_logged_in') === '1';

    if (!force && !justLoggedIn && hiddenToday) return;
    if (justLoggedIn) sessionStorage.removeItem('asg_just_logged_in');

    renderFirstDepositTiers();
    const modal = document.getElementById('first-deposit-modal');
    if (modal) modal.classList.remove('hidden');
}

function closeFirstDepositModal() {
    const chk = document.getElementById('fdb-no-remind');
    if (chk && chk.checked) {
        const today = new Date().toISOString().slice(0, 10);
        localStorage.setItem('asg_fdb_hide_date', today);
    }
    const modal = document.getElementById('first-deposit-modal');
    if (modal) modal.classList.add('hidden');
}

function depositFromBonus(amount) {
    closeFirstDepositModal();
    if (window.stateManager) {
        window.stateManager.openRechargeModal();
        const inp = document.getElementById('recharge-amount-input');
        if (inp) inp.value = amount;
        document.querySelectorAll('.recharge-pill').forEach(p => {
            p.classList.toggle('active', parseInt(p.dataset.amount) === amount);
        });
        updateDepositButtonState();
    }
}

function goFdbActivity() {
    closeFirstDepositModal();
    if (window.stateManager) {
        window.stateManager.switchTab('activity');
    }
}

// ========================================================
// AGENCY / PROMOTION SUB-VIEWS & INVITATION BONUS (10 TIERS)
// ========================================================
const INVITATION_BONUS_TIERS = [
    { level: 1,  invitees: 1,    recharge: 300, reward: 55 },
    { level: 2,  invitees: 3,    recharge: 300, reward: 155 },
    { level: 3,  invitees: 10,   recharge: 300, reward: 555 },
    { level: 4,  invitees: 30,   recharge: 300, reward: 1555 },
    { level: 5,  invitees: 60,   recharge: 300, reward: 2955 },
    { level: 6,  invitees: 100,  recharge: 300, reward: 5655 },
    { level: 7,  invitees: 200,  recharge: 300, reward: 11555 },
    { level: 8,  invitees: 500,  recharge: 300, reward: 28555 },
    { level: 9,  invitees: 1000, recharge: 300, reward: 58555 },
    { level: 10, invitees: 5000, recharge: 300, reward: 365555 }
];

function renderInvitationBonusCards() {
    const container = document.getElementById('inv-bonus-cards-list');
    if (!container) return;
    const sm = window.stateManager;
    const curInvitees = (sm && sm._subordinatesCache) ? sm._subordinatesCache.length : 0;
    const claimedLevels = JSON.parse(localStorage.getItem('asg_invb_claimed') || '[]');

    container.innerHTML = INVITATION_BONUS_TIERS.map(t => {
        const isClaimed = claimedLevels.includes(t.level);
        const canClaim = !isClaimed && curInvitees >= t.invitees;
        const shownInv = Math.min(curInvitees, t.invitees);
        const btnClass = isClaimed ? 'invb-btn-done' : (canClaim ? 'invb-btn-claim' : 'invb-btn-unfin');
        const btnLabel = isClaimed ? 'Claimed ✓' : (canClaim ? `Claim ₹${t.reward.toLocaleString('en-IN')}` : 'Unfinished');
        return `
            <div class="invb-ticket-card">
                <div class="invb-ticket-top">
                    <div class="invb-green-ribbon">
                        <span>Bonus</span>
                        <span class="invb-lvl-dot">${t.level}</span>
                        <span class="invb-x-circle">${isClaimed ? '✓' : '✕'}</span>
                    </div>
                    <div class="invb-reward-amt">₹${t.reward.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
                </div>

                <div class="invb-info-rows">
                    <div class="invb-info-row">
                        <span>Number of invitees</span>
                        <strong style="color:#fff;">${t.invitees}</strong>
                    </div>
                    <div class="invb-info-row">
                        <span>Recharge per people</span>
                        <strong style="color:#ef4444;">₹${t.recharge.toFixed(2)}</strong>
                    </div>
                </div>

                <div class="invb-perf-line"></div>

                <div class="invb-prog-grid">
                    <div class="invb-prog-col">
                        <div class="invb-prog-num" style="color:#f59e0b;">${shownInv} / ${t.invitees}</div>
                        <div class="invb-prog-lbl">Number of invitees</div>
                    </div>
                    <div class="invb-prog-col invb-prog-border">
                        <div class="invb-prog-num" style="color:#ef4444;">${shownInv} / ${t.invitees}</div>
                        <div class="invb-prog-lbl">Deposit number</div>
                    </div>
                </div>

                <button class="invb-action-btn ${btnClass}" onclick="claimInvitationBonus(${t.level}, ${t.reward}, ${t.invitees})">${btnLabel}</button>
            </div>
        `;
    }).join('');
}

function claimInvitationBonus(level, reward, needed) {
    const sm = window.stateManager;
    if (!sm) return;
    const curInvitees = (sm._subordinatesCache) ? sm._subordinatesCache.length : 0;
    const claimed = JSON.parse(localStorage.getItem('asg_invb_claimed') || '[]');
    if (claimed.includes(level)) {
        sm.showToast('You have already claimed this bonus tier!', 'info');
        return;
    }
    if (curInvitees < needed) {
        sm.showToast(`Invite ${needed - curInvitees} more friend(s) (with ₹300 recharge) to unlock ₹${reward}!`, 'warning');
        return;
    }
    claimed.push(level);
    localStorage.setItem('asg_invb_claimed', JSON.stringify(claimed));
    sm.addBalance(reward, `Invitation Bonus Tier ${level}`);
    sm.showWinModal(reward, `Invitation Bonus #${level} Unlocked!`);
    renderInvitationBonusCards();
}

function openInvitationBonusPage() {
    if (window.stateManager) {
        window.stateManager.switchTab('promotion');
    }
    openPromoSubView('invbonus');
}

function openPromoSubView(viewName) {
    ['main', 'subordinates', 'rules', 'invbonus'].forEach(v => {
        const el = document.getElementById(`promo-view-${v}`);
        if (el) el.classList.toggle('hidden', v !== viewName);
    });
    if (viewName === 'invbonus') renderInvitationBonusCards();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function copyInvitationLink() {
    const sm = window.stateManager;
    const code = (sm && sm.inviteCode) || 'ASG84920';
    const link = `${window.location.origin}/#/register?invitationCode=${code}`;
    if (navigator.clipboard) {
        navigator.clipboard.writeText(link).catch(() => {});
    }
    if (sm) sm.showToast('Invitation Link Copied! Share to earn 6-level commission.', 'success');
}

function copyInvitationCode() {
    const sm = window.stateManager;
    const code = (sm && sm.inviteCode) || 'ASG84920';
    if (navigator.clipboard) {
        navigator.clipboard.writeText(code).catch(() => {});
    }
    if (sm) sm.showToast(`Invitation Code Copied: ${code}`, 'success');
}

async function claimPromoCommission() {
    const sm = window.stateManager;
    if (!sm || !sm.token) {
        openAuthModal('login');
        return;
    }
    try {
        const res = await fetch('/api/referral/claim', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${sm.token}` }
        });
        const d = await res.json();
        sm.showToast(d.message || 'Checked commission details.', d.success ? 'success' : 'info');
        if (d.success) {
            sm.fetchUserProfile();
            sm.renderPromotionTab();
        }
    } catch (e) {}
}

function filterSubordinatesList() {
    const sm = window.stateManager;
    if (!sm) return;
    const q = (document.getElementById('sub-search-uid')?.value || '').trim().toLowerCase();
    const list = sm._subordinatesCache || [];
    if (!q) {
        sm.renderSubordinatesList(list);
        return;
    }
    const filtered = list.filter(s => String(s.id || '').includes(q) || String(s.phone || '').toLowerCase().includes(q));
    sm.renderSubordinatesList(filtered);
}

// ========================================================
// REDEEM GIFT CODE MODAL & API
// ========================================================
function openRedeemGiftModal() {
    const modal = document.getElementById('redeem-gift-modal');
    if (modal) modal.classList.remove('hidden');
    loadGiftHistory();
}

function closeRedeemGiftModal() {
    const modal = document.getElementById('redeem-gift-modal');
    if (modal) modal.classList.add('hidden');
}

async function loadGiftHistory() {
    const listEl = document.getElementById('gift-history-list');
    const sm = window.stateManager;
    if (!listEl || !sm || !sm.token) return;
    try {
        const res = await fetch('/api/gift/history', { headers: { 'Authorization': `Bearer ${sm.token}` } });
        const d = await res.json();
        if (d.success && d.history && d.history.length > 0) {
            listEl.innerHTML = d.history.map(h => `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 6px; border-bottom:1px solid rgba(255,255,255,0.06);">
                    <div>
                        <div style="color:#fff; font-weight:700; font-size:13px;">🎁 ${h.details || 'Gift Code'}</div>
                        <div style="color:#94a3b8; font-size:11px;">${(h.created_at || '').replace('T', ' ').slice(0, 19)}</div>
                    </div>
                    <div style="color:#10b981; font-weight:800; font-size:14px;">+₹${parseFloat(h.amount || 0).toFixed(2)}</div>
                </div>
            `).join('');
        } else {
            listEl.innerHTML = `<div class="bdg-no-data" style="padding:32px 10px;"><div style="font-size:44px; opacity:0.35; margin-bottom:6px;">📜</div><div>No data</div></div>`;
        }
    } catch (e) {}
}

async function redeemGiftCode() {
    const sm = window.stateManager;
    if (!sm || !sm.token) {
        alert('Please login first to redeem a gift code!');
        closeRedeemGiftModal();
        openAuthModal('login');
        return;
    }
    const inp = document.getElementById('gift-code-input');
    const code = (inp?.value || '').trim();
    if (!code) {
        sm.showToast('Please enter a gift code first!', 'warning');
        return;
    }
    try {
        const res = await fetch('/api/gift/redeem', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sm.token}` },
            body: JSON.stringify({ code })
        });
        const d = await res.json();
        if (d.success) {
            if (inp) inp.value = '';
            sm.fetchUserProfile();
            loadGiftHistory();
            sm.showWinModal(d.amount || 50, `Gift Code ${code.toUpperCase()} Redeemed!`);
        } else {
            sm.showToast(d.message || 'Invalid gift code', 'error');
        }
    } catch (e) {
        sm.showToast('Network error redeeming gift code.', 'error');
    }
}

// ========================================================
// INVITE POSTER & QR SHARE SCREEN (BDG #/promotion/PromotionShare)
// ========================================================
let _inviteOpenedFromWheel = false;

function getInviteShareCode() {
    const sm = window.stateManager;
    return (sm && sm.inviteCode) ? sm.inviteCode : 'ASG84920';
}

function getInviteShareLink() {
    const code = getInviteShareCode();
    return `${window.location.origin}/?invite=${encodeURIComponent(code)}`;
}

function openInvitePosterModal(fromWheel = false) {
    _inviteOpenedFromWheel = Boolean(fromWheel);
    const modal = document.getElementById('invite-poster-modal');
    if (!modal) return;

    const link = getInviteShareLink();
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=6&data=${encodeURIComponent(link)}`;
    modal.querySelectorAll('.inv-qr-img').forEach(img => {
        img.src = qrUrl;
    });

    modal.classList.remove('hidden');
}

function closeInvitePosterModal() {
    const modal = document.getElementById('invite-poster-modal');
    if (modal) modal.classList.add('hidden');
}

function _maybeGrantWheelInviteSpin() {
    if (_inviteOpenedFromWheel && window.wheelGame && typeof window.wheelGame.claimInviteSpin === 'function') {
        const lastClaim = parseInt(localStorage.getItem('asg_wheel_share_ts') || '0', 10);
        if (Date.now() - lastClaim > 30000) {
            window.wheelGame.spinsLeft += 1;
            localStorage.setItem('asg_wheel_spins', String(window.wheelGame.spinsLeft));
            localStorage.setItem('asg_wheel_share_ts', String(Date.now()));
            window.wheelGame.updateUI();
            if (window.sound && window.sound.coin) window.sound.coin();
            return true;
        }
    }
    return false;
}

function copyInvitePosterLink() {
    const sm = window.stateManager;
    const link = getInviteShareLink();
    const done = () => {
        const gotSpin = _maybeGrantWheelInviteSpin();
        if (sm) {
            sm.showToast(
                gotSpin ? '🎁 Invitation link copied! +1 FREE SPIN added!' : '📋 Invitation link copied! Share with friends to earn 85% commission.',
                'success'
            );
        }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link).then(done).catch(() => {
            prompt('Copy your invitation link:', link);
            done();
        });
    } else {
        prompt('Copy your invitation link:', link);
        done();
    }
}

function downloadInvitePosterQR() {
    const sm = window.stateManager;
    const carousel = document.getElementById('inv-poster-carousel');
    let activeIdx = 0;
    if (carousel) {
        const cards = Array.from(carousel.querySelectorAll('.inv-poster-card'));
        const centerX = carousel.scrollLeft + carousel.clientWidth / 2;
        let bestDist = Infinity;
        cards.forEach((c, i) => {
            const dist = Math.abs((c.offsetLeft + c.offsetWidth / 2) - centerX);
            if (dist < bestDist) {
                bestDist = dist;
                activeIdx = i;
            }
        });
    }

    const themes = [
        { bg1: '#2366d8', bg2: '#3bb5f2', r1: 'Fair and justice', r2: 'Open and transparent', head: 'Full Odds Bonus Rate', f1: 'Financial security', f2: 'Quick withdrawal' },
        { bg1: '#5b3a08', bg2: '#b88220', r1: 'VIP Daily Bonus', r2: 'Instant Payout', head: 'Invite Bonus Up To ₹3,65,555', f1: '100% Verified', f2: 'Fast UPI Pay' },
        { bg1: '#991b1b', bg2: '#ef4444', r1: 'Free Spin Daily', r2: 'Win Cash ₹500', head: 'ASGames Official Partner', f1: 'Lucky Wheel', f2: 'Zero Fee Cash' }
    ];
    const th = themes[activeIdx] || themes[0];
    const code = getInviteShareCode();
    const link = getInviteShareLink();

    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 920;
    const ctx = canvas.getContext('2d');

    // Poster gradient background
    const grad = ctx.createLinearGradient(0, 0, 0, 920);
    grad.addColorStop(0, th.bg1);
    grad.addColorStop(1, th.bg2);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 600, 920);

    // Top two gold ribbon pills
    ctx.fillStyle = '#fde68a';
    ctx.fillRect(42, 34, 244, 72);
    ctx.fillStyle = '#fcd34d';
    ctx.fillRect(314, 34, 244, 72);
    ctx.fillStyle = '#b45309';
    ctx.font = 'bold 24px Poppins, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(th.r1, 164, 78);
    ctx.fillText(th.r2, 436, 78);

    // Headline
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 34px Poppins, sans-serif';
    ctx.fillText(th.head, 300, 166);

    // Two feature boxes
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 2;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(48, 200, 232, 118);
    ctx.strokeRect(48, 200, 232, 118);
    ctx.fillRect(320, 200, 232, 118);
    ctx.strokeRect(320, 200, 232, 118);
    ctx.fillStyle = '#ffffff';
    ctx.font = '600 22px Poppins, sans-serif';
    ctx.fillText(th.f1, 164, 286);
    ctx.fillText(th.f2, 436, 286);

    // Commission highlight
    ctx.font = 'bold 32px Poppins, sans-serif';
    ctx.fillText('Permanent commission up to', 300, 386);
    ctx.fillStyle = '#fde047';
    ctx.font = '900 54px Poppins, sans-serif';
    ctx.fillText('85%', 300, 448);

    // Golden Gift Box backdrop behind QR
    const boxGrad = ctx.createLinearGradient(150, 490, 450, 820);
    boxGrad.addColorStop(0, '#fed7aa');
    boxGrad.addColorStop(1, '#f97316');
    ctx.fillStyle = boxGrad;
    ctx.fillRect(150, 520, 300, 290);

    const finalizeDownload = () => {
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 24px Poppins, sans-serif';
        ctx.fillText(`Invite Code: ${code}`, 300, 868);
        ctx.font = '500 18px Poppins, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.fillText(link, 300, 900);

        const a = document.createElement('a');
        a.download = `ASGames-Invite-${code}.png`;
        a.href = canvas.toDataURL('image/png');
        document.body.appendChild(a);
        a.click();
        a.remove();

        const gotSpin = _maybeGrantWheelInviteSpin();
        if (sm) {
            sm.showToast(
                gotSpin ? '⬇️ QR Poster Downloaded! +1 FREE SPIN Added!' : '⬇️ QR Poster downloaded successfully!',
                'success'
            );
        }
    };

    const qrImg = document.querySelectorAll('#invite-poster-modal .inv-qr-img')[activeIdx];
    if (qrImg && qrImg.complete && qrImg.naturalWidth > 0) {
        try {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(172, 488, 256, 256);
            ctx.drawImage(qrImg, 182, 498, 236, 236);
            finalizeDownload();
            return;
        } catch (e) {}
    }

    // Fallback fresh CORS-enabled QR fetch
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(172, 488, 256, 256);
        ctx.drawImage(img, 182, 498, 236, 236);
        finalizeDownload();
    };
    img.onerror = () => finalizeDownload();
    img.src = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=6&data=${encodeURIComponent(link)}`;
}

function shareInvitePosterNative() {
    const link = getInviteShareLink();
    const code = getInviteShareCode();
    const text = `🎁 Join ASGames & win ₹500 on Invite Wheel + up to 85% commission! Use Invite Code: ${code}`;
    if (navigator.share) {
        navigator.share({ title: 'ASGames VIP Invite', text, url: link })
            .then(() => {
                const gotSpin = _maybeGrantWheelInviteSpin();
                if (gotSpin && window.stateManager) {
                    window.stateManager.showToast('🎁 Shared! +1 FREE SPIN Added!', 'success');
                }
            })
            .catch(() => {});
    } else {
        copyInvitePosterLink();
    }
}

// ========================================================
// FULL-SCREEN BDG DEPOSIT PAGE LOGIC (#/wallet/Recharge)
// ========================================================
window._selectedDepositMethod = 'UPI-QR';
window._selectedDepositChannel = 'UPI-QR';

const DEPOSIT_CHANNEL_MAP = {
    'UPI-QR': [
        { name: 'UPI-QR', range: 'Balance:100 - 50K' },
        { name: 'UPI-FastQR', range: 'Balance:100 - 50K' }
    ],
    'UPI-QRpay': [
        { name: 'UPI-QRpay', range: 'Balance:100 - 50K' },
        { name: 'QRpay-VIP', range: 'Balance:500 - 50K' }
    ],
    'Wake UP-APP': [
        { name: 'Wake UP-APP', range: 'Balance:100 - 50K' },
        { name: 'PhonePe/GPay', range: 'Balance:100 - 50K' }
    ],
    'USDT': [
        { name: 'USDT-TRC20', range: 'Balance:100 - 50K' }
    ],
    'ARPay': [
        { name: 'ARPay (+1% Bonus)', range: 'Balance:100 - 50K' }
    ]
};

function selectDepositMethod(method, tileEl) {
    window._selectedDepositMethod = method;
    document.querySelectorAll('.dep-method-tile').forEach(t => t.classList.remove('active'));
    if (tileEl) tileEl.classList.add('active');

    const channels = DEPOSIT_CHANNEL_MAP[method] || [{ name: method, range: 'Balance:100 - 50K' }];
    window._selectedDepositChannel = channels[0].name;

    const chGrid = document.getElementById('dep-channel-grid');
    if (chGrid) {
        chGrid.innerHTML = channels.map((ch, idx) => `
            <div class="dep-channel-tile ${idx === 0 ? 'active' : ''}" data-channel="${ch.name}" onclick="selectDepositChannel('${ch.name}', this)">
                <div class="dep-ch-name">${ch.name}</div>
                <div class="dep-ch-range">${ch.range}</div>
            </div>
        `).join('');
    }
    const footerMethod = document.getElementById('dep-footer-method');
    if (footerMethod) footerMethod.textContent = method;
    if (window.sound) window.sound.click();
}

function selectDepositChannel(channel, el) {
    window._selectedDepositChannel = channel;
    document.querySelectorAll('.dep-channel-tile').forEach(c => c.classList.remove('active'));
    if (el) el.classList.add('active');
    const footerMethod = document.getElementById('dep-footer-method');
    if (footerMethod) footerMethod.textContent = channel;
    if (window.sound) window.sound.click();
}

function updateDepositButtonState() {
    const inp = document.getElementById('recharge-amount-input');
    const btn = document.getElementById('dep-open-pay-btn');
    const amt = parseFloat(inp?.value || '0');
    if (btn) {
        if (amt >= 100) btn.classList.add('ready');
        else btn.classList.remove('ready');
    }
}

function clearDepositAmount() {
    const inp = document.getElementById('recharge-amount-input');
    if (inp) inp.value = '';
    document.querySelectorAll('.dep-amt-btn').forEach(b => b.classList.remove('active'));
    updateDepositButtonState();
}

window._livePaymentDetails = {
    upi_id: 'akshit9908@barodampay',
    upi_name: 'AKSHIT KUMAR SAXENA',
    arpay_upi: 'manusaxena465267@ikwik',
    usdt_address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    qr_url: '/assets/deposit-qr.jpg'
};
window._depCheckoutAmount = 500;
window._depCheckoutSlot = 1;

async function fetchLivePaymentDetails() {
    try {
        const res = await fetch('/api/payment-details', { cache: 'no-store' });
        const d = await res.json();
        if (d.success) {
            window._livePaymentDetails = {
                upi_id: d.upi_id || 'akshit9908@barodampay',
                upi_name: d.upi_name || 'AKSHIT KUMAR SAXENA',
                arpay_upi: d.arpay_upi || 'manusaxena465267@ikwik',
                usdt_address: d.usdt_address || 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
                qr_url: d.qr_url || '/assets/deposit-qr.jpg'
            };
        }
    } catch (e) {}
    return window._livePaymentDetails;
}

function selectDepositUpiSlot(slot) {
    window._depCheckoutSlot = slot === 2 ? 2 : 1;
    const pay = window._livePaymentDetails || {};
    const amt = Number(window._depCheckoutAmount || 500);
    const idLbl = document.getElementById('dep-pay-id-label');
    const idVal = document.getElementById('dep-pay-id-val');
    const qrImg = document.getElementById('dep-pay-qr-img');
    const btn1 = document.getElementById('dep-upi-btn-1');
    const btn2 = document.getElementById('dep-upi-btn-2');

    const activeStyle = 'padding:8px 6px; border-radius:8px; border:1px solid #d9ac4f; background:linear-gradient(135deg,#fae59f,#c4933f); color:#1a1305; font-size:11px; font-weight:800; cursor:pointer;';
    const idleStyle = 'padding:8px 6px; border-radius:8px; border:1px solid rgba(255,255,255,0.14); background:#18181b; color:#e4e4e7; font-size:11px; font-weight:700; cursor:pointer;';
    if (btn1) btn1.style.cssText = window._depCheckoutSlot === 1 ? activeStyle : idleStyle;
    if (btn2) btn2.style.cssText = window._depCheckoutSlot === 2 ? activeStyle : idleStyle;

    const addr = window._depCheckoutSlot === 2
        ? (pay.arpay_upi || 'manusaxena465267@ikwik')
        : (pay.upi_id || 'akshit9908@barodampay');
    const payeeName = window._depCheckoutSlot === 2 ? 'MANU SAXENA' : (pay.upi_name || 'AKSHIT KUMAR SAXENA');

    if (idLbl) idLbl.textContent = `Official Deposit UPI (${payeeName})`;
    if (idVal) idVal.textContent = addr;

    if (qrImg) {
        if (window._depCheckoutSlot === 1 && pay.qr_url) {
            qrImg.src = pay.qr_url;
        } else {
            const qrPayload = `upi://pay?pa=${addr}&pn=${encodeURIComponent(payeeName)}&am=${amt.toFixed(2)}&cu=INR`;
            qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=6&data=${encodeURIComponent(qrPayload)}`;
        }
    }
}

async function openDepositCheckoutSheet() {
    const sm = window.stateManager;
    if (!sm || !sm.token) {
        if (sm) sm.showToast('Please login first to deposit funds!', 'warning');
        openAuthModal('login');
        return;
    }
    const inp = document.getElementById('recharge-amount-input');
    const amt = parseFloat(inp?.value || '0');
    if (!amt || amt < 100) {
        sm.showToast('Please select or enter at least ₹100 to deposit.', 'warning');
        return;
    }
    window._depCheckoutAmount = amt;

    const pay = await fetchLivePaymentDetails();
    const ch = window._selectedDepositChannel || window._selectedDepositMethod || 'UPI-QR';
    const isUsdt = window._selectedDepositMethod === 'USDT';
    const isArPay = window._selectedDepositMethod === 'ARPay';

    const chLbl = document.getElementById('dep-pay-channel-lbl');
    const amtLbl = document.getElementById('dep-pay-amount-lbl');
    const idLbl = document.getElementById('dep-pay-id-label');
    const idVal = document.getElementById('dep-pay-id-val');
    const qrImg = document.getElementById('dep-pay-qr-img');
    const switcher = document.getElementById('dep-upi-switcher');

    if (chLbl) chLbl.textContent = ch;
    if (amtLbl) amtLbl.textContent = `₹${amt.toFixed(2)}`;

    if (isUsdt) {
        if (switcher) switcher.style.display = 'none';
        const usdtAddr = pay.usdt_address || 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
        if (idLbl) idLbl.textContent = 'Official USDT (TRC20) Address';
        if (idVal) idVal.textContent = usdtAddr;
        if (qrImg) qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=6&data=${encodeURIComponent(usdtAddr)}`;
    } else {
        if (switcher) switcher.style.display = (pay.arpay_upi && pay.arpay_upi !== pay.upi_id) ? 'grid' : 'none';
        selectDepositUpiSlot(isArPay ? 2 : 1);
    }

    const sheet = document.getElementById('dep-checkout-sheet');
    if (sheet) sheet.classList.remove('hidden');
}

function closeDepositCheckoutSheet() {
    const sheet = document.getElementById('dep-checkout-sheet');
    if (sheet) sheet.classList.add('hidden');
}

function copyDepositPayAddress() {
    const val = document.getElementById('dep-pay-id-val')?.textContent || 'akshit9908@barodampay';
    if (navigator.clipboard) navigator.clipboard.writeText(val).catch(() => {});
    if (window.stateManager) window.stateManager.showToast(`Copied: ${val}`, 'success');
}

async function loadDepositPageHistory() {
    const listEl = document.getElementById('dep-history-list');
    const sm = window.stateManager;
    if (!listEl || !sm || !sm.token) return;
    try {
        const res = await fetch('/api/wallet/transactions', { headers: { 'Authorization': `Bearer ${sm.token}` } });
        const d = await res.json();
        const deps = (d.transactions || []).filter(t => t.type === 'deposit').slice(0, 15);
        if (deps.length === 0) {
            listEl.innerHTML = `<div class="bdg-no-data" style="padding:30px 10px;"><div style="font-size:44px; opacity:0.35; margin-bottom:6px;">📜</div><div>No data</div></div>`;
            return;
        }
        listEl.innerHTML = deps.map(t => {
            const st = String(t.status || 'pending').toLowerCase();
            const stColor = (st === 'approved' || st === 'completed') ? '#10b981' : (st === 'rejected' ? '#ef4444' : '#f59e0b');
            const stText = (st === 'approved' || st === 'completed') ? 'Completed' : (st === 'rejected' ? 'Rejected' : 'Pending');
            return `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 4px; border-bottom:1px solid rgba(255,255,255,0.06);">
                    <div>
                        <div style="color:#fff; font-weight:700; font-size:13px;">₹${parseFloat(t.amount || 0).toFixed(2)}</div>
                        <div style="color:#94a3b8; font-size:11px;">${t.details || 'Deposit'}</div>
                        <div style="color:#71717a; font-size:10px;">${(t.created_at || '').replace('T', ' ').slice(0, 19)}</div>
                    </div>
                    <span style="font-size:11px; font-weight:700; color:${stColor}; background:rgba(255,255,255,0.05); padding:4px 9px; border-radius:6px;">${stText}</span>
                </div>
            `;
        }).join('');
    } catch (e) {}
}

// ========================================================
// FULL-SCREEN BDG WITHDRAW PAGE LOGIC (#/wallet/Withdraw)
// ========================================================
window._selectedWithdrawMethod = 'BANK';

function _getSavedBeneficiaries() {
    try {
        return JSON.parse(localStorage.getItem('asg_wd_beneficiaries') || '{}');
    } catch (e) {
        return {};
    }
}

function selectWithdrawMethod(method) {
    window._selectedWithdrawMethod = method;

    const tiles = {
        ARPay: document.getElementById('wd-tile-arpay'),
        BANK: document.getElementById('wd-tile-bank'),
        USDT: document.getElementById('wd-tile-usdt'),
        UPI: document.getElementById('wd-tile-upi')
    };
    Object.values(tiles).forEach(t => t && t.classList.remove('active'));
    if (tiles[method]) tiles[method].classList.add('active');

    const arPanel = document.getElementById('wd-arpay-panel');
    const stdPanel = document.getElementById('wd-standard-panel');
    const arActivated = localStorage.getItem('asg_arwallet_active') === '1';

    if (method === 'ARPay' && !arActivated) {
        if (arPanel) { arPanel.classList.remove('hidden'); arPanel.style.display = 'flex'; }
        if (stdPanel) { stdPanel.classList.add('hidden'); stdPanel.style.display = 'none'; }
    } else {
        if (arPanel) { arPanel.classList.add('hidden'); arPanel.style.display = 'none'; }
        if (stdPanel) { stdPanel.classList.remove('hidden'); stdPanel.style.display = 'flex'; }
        renderSavedBeneficiaryUI();
    }
    updateWithdrawSummary();
    if (window.sound) window.sound.click();
}

function activateArWallet() {
    localStorage.setItem('asg_arwallet_active', '1');
    if (window.stateManager) {
        window.stateManager.showToast('🎉 AR Wallet Activated! Add your UPI/ARPay ID below to withdraw.', 'success');
    }
    selectWithdrawMethod('ARPay');
}

function renderSavedBeneficiaryUI() {
    const m = window._selectedWithdrawMethod || 'BANK';
    const saved = _getSavedBeneficiaries()[m];
    const emptyEl = document.getElementById('wd-beneficiary-empty');
    const savedEl = document.getElementById('wd-beneficiary-saved');
    const phEl = document.getElementById('wd-beneficiary-placeholder');
    const warnEl = document.getElementById('wd-beneficiary-warn');
    const hiddenAcc = document.getElementById('withdraw-account-input');

    const placeholders = {
        BANK: 'Add a bank account number',
        USDT: 'Add USDT (TRC20) wallet address',
        UPI: 'Add UPI ID (e.g. name@upi)',
        ARPay: 'Add ARPay / UPI ID for instant payout'
    };
    if (phEl) phEl.textContent = placeholders[m] || 'Add beneficiary details';

    if (saved && saved.value) {
        if (emptyEl) emptyEl.classList.add('hidden');
        if (savedEl) { savedEl.classList.remove('hidden'); savedEl.style.display = 'flex'; }
        if (warnEl) warnEl.classList.add('hidden');
        const tEl = document.getElementById('wd-saved-title');
        const sEl = document.getElementById('wd-saved-sub');
        if (tEl) tEl.textContent = saved.title || m;
        if (sEl) sEl.textContent = saved.display || saved.value;
        if (hiddenAcc) hiddenAcc.value = saved.value;
    } else {
        if (emptyEl) emptyEl.classList.remove('hidden');
        if (savedEl) { savedEl.classList.add('hidden'); savedEl.style.display = 'none'; }
        if (warnEl) warnEl.classList.remove('hidden');
        if (hiddenAcc) hiddenAcc.value = '';
    }
    updateWithdrawSummary();
}

function openAddBeneficiarySheet() {
    const m = window._selectedWithdrawMethod || 'BANK';
    const sheet = document.getElementById('wd-add-beneficiary-sheet');
    const titleEl = document.getElementById('wd-ben-modal-title');
    const bankFields = document.getElementById('wd-ben-bank-fields');
    const singleField = document.getElementById('wd-ben-single-field');
    const singleLbl = document.getElementById('wd-single-label');
    const singleInp = document.getElementById('wd-single-input');

    if (m === 'BANK') {
        if (titleEl) titleEl.textContent = 'Add Bank Account';
        if (bankFields) bankFields.classList.remove('hidden');
        if (singleField) singleField.classList.add('hidden');
    } else {
        if (bankFields) bankFields.classList.add('hidden');
        if (singleField) singleField.classList.remove('hidden');
        if (m === 'USDT') {
            if (titleEl) titleEl.textContent = 'Add USDT (TRC20) Address';
            if (singleLbl) singleLbl.textContent = 'USDT TRC20 Wallet Address';
            if (singleInp) singleInp.placeholder = 'Paste your T... TRC20 wallet address';
        } else {
            if (titleEl) titleEl.textContent = m === 'ARPay' ? 'Link ARPay / UPI ID' : 'Add UPI ID';
            if (singleLbl) singleLbl.textContent = 'UPI ID';
            if (singleInp) singleInp.placeholder = 'e.g. 9876543210@paytm or name@ybl';
        }
    }
    if (sheet) sheet.classList.remove('hidden');
}

function closeAddBeneficiarySheet() {
    const sheet = document.getElementById('wd-add-beneficiary-sheet');
    if (sheet) sheet.classList.add('hidden');
}

function saveWithdrawBeneficiary() {
    const m = window._selectedWithdrawMethod || 'BANK';
    const sm = window.stateManager;
    const all = _getSavedBeneficiaries();

    if (m === 'BANK') {
        const bank = (document.getElementById('wd-bank-name')?.value || '').trim();
        const holder = (document.getElementById('wd-bank-holder')?.value || '').trim();
        const num = (document.getElementById('wd-bank-number')?.value || '').trim();
        const ifsc = (document.getElementById('wd-bank-ifsc')?.value || '').trim().toUpperCase();
        if (!bank || !num || !ifsc) {
            if (sm) sm.showToast('Please enter Bank Name, Account Number & IFSC!', 'warning');
            return;
        }
        all.BANK = {
            title: `${bank} (${holder || 'Account'})`,
            display: `A/C: ${num} | IFSC: ${ifsc}`,
            value: `BANK: ${bank} | ${holder} | A/C: ${num} | IFSC: ${ifsc}`
        };
    } else {
        const val = (document.getElementById('wd-single-input')?.value || '').trim();
        if (!val || val.length < 4) {
            if (sm) sm.showToast('Please enter a valid address / UPI ID!', 'warning');
            return;
        }
        all[m] = {
            title: m === 'USDT' ? 'USDT (TRC20)' : `${m} Payout`,
            display: val,
            value: `${m}: ${val}`
        };
    }

    localStorage.setItem('asg_wd_beneficiaries', JSON.stringify(all));
    closeAddBeneficiarySheet();
    renderSavedBeneficiaryUI();
    if (sm) sm.showToast('Beneficiary saved successfully!', 'success');
}

window._currentTurnoverInfo = null;

async function fetchUserTurnoverStatus() {
    const sm = window.stateManager;
    if (!sm || !sm.token) return;
    try {
        const res = await fetch('/api/wallet/turnover-status', {
            headers: { 'Authorization': `Bearer ${sm.token}` }
        });
        const d = await res.json();
        if (d.success) {
            window._currentTurnoverInfo = d;
            updateWithdrawSummary();
        }
    } catch (e) {}
}

function updateWithdrawSummary() {
    const sm = window.stateManager;
    const bal = sm ? Number(sm.balance || 0) : 0;
    const amt = parseFloat(document.getElementById('withdraw-amount-input')?.value || '0') || 0;
    const acc = (document.getElementById('withdraw-account-input')?.value || '').trim();

    const wBalEl = document.getElementById('wd-withdrawable-val');
    const recvEl = document.getElementById('wd-received-val');
    const timeEl = document.getElementById('wd-time-val');
    const depEl = document.getElementById('wd-deposit-bal-val');
    const winEl = document.getElementById('wd-winning-bal-val');
    const btn = document.getElementById('btn-submit-withdraw');

    let depositBal = 0;
    let winningBal = bal;
    if (window._currentTurnoverInfo) {
        depositBal = typeof window._currentTurnoverInfo.deposit_balance === 'number' ? window._currentTurnoverInfo.deposit_balance : 0;
        winningBal = typeof window._currentTurnoverInfo.winning_balance === 'number' ? window._currentTurnoverInfo.winning_balance : (window._currentTurnoverInfo.withdrawable_balance ?? bal);
    } else if (sm && sm.user) {
        depositBal = typeof sm.user.deposit_balance === 'number' ? sm.user.deposit_balance : 0;
        winningBal = typeof sm.user.winning_balance === 'number' ? sm.user.winning_balance : bal;
    }

    const tds = Math.round(amt * 0.18 * 100) / 100;
    const net = Math.max(0, Math.round((amt - tds) * 100) / 100);
    const tdsEl = document.getElementById('wd-tds-val');

    if (depEl) depEl.textContent = `₹${depositBal.toFixed(2)}`;
    if (winEl) winEl.textContent = `₹${winningBal.toFixed(2)}`;
    if (wBalEl) wBalEl.textContent = `₹${winningBal.toFixed(2)}`;
    if (tdsEl) tdsEl.textContent = `-₹${tds.toFixed(2)}`;
    if (recvEl) recvEl.textContent = `₹${net.toFixed(2)}`;

    // Check IST time: 10:00 AM to 08:00 PM IST
    const now = new Date();
    const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
    const h = ist.getUTCHours();
    const m = ist.getUTCMinutes();
    const isOpen = (h >= 10 && (h < 20 || (h === 20 && m === 0)));

    if (timeEl) {
        timeEl.innerHTML = isOpen ?
            '<span style="color:#10b981; font-weight:700;">10:00 - 20:00 (Open Now)</span>' :
            '<span style="color:#ef4444; font-weight:700;">10:00 - 20:00 (Closed Now • Opens 10:00 AM IST)</span>';
    }

    if (btn) {
        if (amt >= 110 && amt <= winningBal && acc && isOpen) btn.classList.add('ready');
        else btn.classList.remove('ready');
    }
}

function fillAllWithdrawBalance() {
    const sm = window.stateManager;
    const bal = sm ? Number(sm.balance || 0) : 0;
    let winningBal = bal;
    if (window._currentTurnoverInfo && typeof window._currentTurnoverInfo.winning_balance === 'number') {
        winningBal = window._currentTurnoverInfo.winning_balance;
    } else if (sm && sm.user && typeof sm.user.winning_balance === 'number') {
        winningBal = sm.user.winning_balance;
    }

    const withdrawable = Math.floor(winningBal);
    const inp = document.getElementById('withdraw-amount-input');
    if (inp) inp.value = withdrawable > 0 ? String(withdrawable) : '';
    if (withdrawable <= 0 && sm) {
        sm.showToast('Withdrawal sirf Winning Wallet se ho sakta hai! Game khel kar jeetein aur winning amount withdraw karein.', 'warning');
    }
    updateWithdrawSummary();
}

async function loadWithdrawPageHistory(showAll = false) {
    const listEl = document.getElementById('wd-history-list');
    const sm = window.stateManager;
    if (!listEl || !sm || !sm.token) return;
    try {
        const res = await fetch('/api/wallet/transactions', { headers: { 'Authorization': `Bearer ${sm.token}` } });
        const d = await res.json();
        const wds = (d.transactions || []).filter(t => t.type === 'withdraw');
        const shown = showAll ? wds : wds.slice(0, 10);
        if (shown.length === 0) {
            listEl.innerHTML = `<div class="bdg-no-data" style="padding:28px 10px;"><div style="font-size:46px; opacity:0.35; margin-bottom:6px;">📜</div><div>No data</div></div>`;
            if (showAll) sm.showToast('No withdrawal records yet.', 'info');
            return;
        }
        listEl.innerHTML = shown.map(t => {
            const st = String(t.status || 'pending').toLowerCase();
            const stColor = (st === 'approved' || st === 'completed') ? '#10b981' : (st === 'rejected' ? '#ef4444' : '#f59e0b');
            const stText = (st === 'approved' || st === 'completed') ? 'Completed' : (st === 'rejected' ? 'Rejected' : 'Pending');
            return `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 6px; border-bottom:1px solid rgba(255,255,255,0.06);">
                    <div>
                        <div style="color:#fff; font-weight:700; font-size:13px;">₹${parseFloat(t.amount || 0).toFixed(2)}</div>
                        <div style="color:#94a3b8; font-size:11px;">${t.details || 'Withdrawal'}</div>
                        <div style="color:#71717a; font-size:10px;">${(t.created_at || '').replace('T', ' ').slice(0, 19)}</div>
                    </div>
                    <span style="font-size:11px; font-weight:700; color:${stColor}; background:rgba(255,255,255,0.05); padding:4px 9px; border-radius:6px;">${stText}</span>
                </div>
            `;
        }).join('');
    } catch (e) {}
}

// ========================================================
// BDG WALLET CENTER HELPERS (#/wallet)
// ========================================================
function updateWalletCenterRings() {
    const sm = window.stateManager;
    const bal = sm ? Number(sm.balance || 0) : 0;
    const pct = bal > 0 ? 100 : 0;
    const pctEl = document.getElementById('wal-main-pct');
    const ringEl = document.getElementById('wal-main-ring');
    if (pctEl) pctEl.textContent = `${pct}%`;
    if (ringEl) {
        ringEl.style.background = pct > 0
            ? `conic-gradient(#d9ac4f 0deg 360deg, #4b4b52 360deg)`
            : `#4b4b52`;
    }
}

async function transferToMainWallet() {
    const sm = window.stateManager;
    if (!sm) return;
    await sm.fetchUserProfile();
    updateWalletCenterRings();
    if (window.sound && window.sound.coin) window.sound.coin();
    sm.showToast('✅ All 3rd-party game balances transferred to Main Wallet!', 'success');
}

function openDepositHistoryDirectly() {
    if (window.stateManager) {
        window.stateManager.openRechargeModal();
        setTimeout(() => {
            const el = document.getElementById('dep-history-card');
            if (el) el.scrollIntoView({ behavior: 'smooth' });
        }, 120);
    }
}

function openWithdrawHistoryDirectly() {
    if (window.stateManager) {
        window.stateManager.openWithdrawModal();
        setTimeout(() => {
            const el = document.getElementById('wd-history-section');
            if (el) el.scrollIntoView({ behavior: 'smooth' });
        }, 120);
    }
}

// ========================================================
// HERO 3D BANNER CAROUSEL CONTROLLER
// ========================================================
let _heroSlideIdx = 0;
function goHeroSlide(idx) {
    const track = document.getElementById('hero-slider-track');
    const dots = document.querySelectorAll('.hero-dot');
    if (!track) return;
    _heroSlideIdx = idx % 2;
    track.style.transform = `translateX(-${_heroSlideIdx * 100}%)`;
    dots.forEach((d, i) => d.classList.toggle('active', i === _heroSlideIdx));
}

function initHeroCarousel() {
    setInterval(() => {
        goHeroSlide((_heroSlideIdx + 1) % 2);
    }, 4500);
}

function initLivePlayersCounter() {
    const el = document.getElementById('live-players-count');
    if (!el) return;
    let count = 13200 + Math.floor(Math.random() * 4800);
    el.textContent = count.toLocaleString('en-US');

    const tick = () => {
        const delta = Math.floor(Math.random() * 115) - 52; // natural -52 to +62 drift
        count = Math.max(10800, Math.min(22500, count + delta));
        el.textContent = count.toLocaleString('en-US');
        setTimeout(tick, 1800 + Math.floor(Math.random() * 2000));
    };
    setTimeout(tick, 2000);
}

// ========================================================
// 24/7 VIP SUPPORT CHATBOT (SYNCED LIVE WITH ADMIN PANEL)
// ========================================================
let _supportChatPollTimer = null;

function _getChatSessionId() {
    let sid = localStorage.getItem('asg_chat_sid');
    if (!sid) {
        sid = 'S' + Date.now() + Math.floor(Math.random() * 9999);
        localStorage.setItem('asg_chat_sid', sid);
    }
    return sid;
}

function _escChatText(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function openSupportChat() {
    const modal = document.getElementById('support-chat-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    loadSupportChatMessages();
    if (_supportChatPollTimer) clearInterval(_supportChatPollTimer);
    _supportChatPollTimer = setInterval(loadSupportChatMessages, 3000);
}

function closeSupportChat() {
    const modal = document.getElementById('support-chat-modal');
    if (modal) modal.classList.add('hidden');
    if (_supportChatPollTimer) {
        clearInterval(_supportChatPollTimer);
        _supportChatPollTimer = null;
    }
}

function renderSupportChatMessages(msgs) {
    const body = document.getElementById('support-chat-body');
    if (!body) return;
    const welcomeHtml = `
        <div class="chat-bubble chat-bot">
            <div class="chat-sender-lbl">🤖 ASGames VIP Assistant</div>
            <div>Namaste! 🙏 Deposit, Withdraw, Gift Code, Ludo ya kisi bhi help ke liye message bhejein — aapka har message seedha <strong>Admin Panel</strong> me jata hai aur Admin yahin live reply karte hain!</div>
        </div>
    `;
    const listHtml = (msgs || []).map(m => {
        const cls = m.sender === 'user' ? 'chat-user' : (m.sender === 'admin' ? 'chat-admin' : 'chat-bot');
        const lbl = m.sender === 'user' ? 'You' : (m.sender === 'admin' ? '👑 Admin Support' : '🤖 VIP Bot');
        const tm = (m.created_at || '').replace('T', ' ').slice(11, 16);
        return `
            <div class="chat-bubble ${cls}">
                <div class="chat-sender-lbl"><span>${lbl}</span><span>${tm}</span></div>
                <div style="white-space:pre-wrap;">${_escChatText(m.text)}</div>
            </div>
        `;
    }).join('');
    body.innerHTML = welcomeHtml + listHtml;
    body.scrollTop = body.scrollHeight;
}

async function loadSupportChatMessages() {
    try {
        const sm = window.stateManager;
        const headers = {};
        if (sm && sm.token) headers['Authorization'] = `Bearer ${sm.token}`;
        const res = await fetch(`/api/chat/messages?session_id=${encodeURIComponent(_getChatSessionId())}`, { headers });
        const d = await res.json();
        if (d.success && Array.isArray(d.messages)) {
            renderSupportChatMessages(d.messages);
        }
    } catch (e) {}
}

function sendQuickChat(text) {
    const inp = document.getElementById('support-chat-input');
    if (inp) inp.value = text;
    sendSupportChatMessage();
}

async function sendSupportChatMessage() {
    const inp = document.getElementById('support-chat-input');
    const text = (inp?.value || '').trim();
    if (!text) return;
    inp.value = '';
    try {
        const sm = window.stateManager;
        const headers = { 'Content-Type': 'application/json' };
        if (sm && sm.token) headers['Authorization'] = `Bearer ${sm.token}`;
        const res = await fetch('/api/chat/send', {
            method: 'POST',
            headers,
            body: JSON.stringify({ message: text, session_id: _getChatSessionId() })
        });
        const d = await res.json();
        if (d.success && Array.isArray(d.messages)) {
            renderSupportChatMessages(d.messages);
        }
    } catch (e) {}
}

// ========================================================
// UNIFIED GAME HISTORY MODAL (ALL 5 GAMES + STATS)
// ========================================================
let _ghCache = [];
let _ghActiveFilter = 'all';

function openGameHistoryModal() {
    const modal = document.getElementById('game-history-modal');
    if (modal) modal.classList.remove('hidden');
    loadUnifiedGameHistory();
}

function closeGameHistoryModal() {
    const modal = document.getElementById('game-history-modal');
    if (modal) modal.classList.add('hidden');
}

function filterGameHistory(gameName, btnEl) {
    _ghActiveFilter = gameName || 'all';
    document.querySelectorAll('.gh-filter-pill').forEach(p => p.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');
    renderUnifiedGameHistory();
}

async function loadUnifiedGameHistory() {
    const sm = window.stateManager;
    const localList = sm ? sm.getLocalGameHistory() : [];
    const byId = new Map();
    localList.forEach(h => byId.set(String(h.id), h));

    // Render cached/local records immediately so UI is never blank
    _ghCache = Array.from(byId.values()).sort((a, b) =>
        String(b.created_at || '').localeCompare(String(a.created_at || ''))
    );
    renderUnifiedGameHistory();

    if (sm && sm.token) {
        try {
            const res = await fetch('/api/game/my-history', {
                headers: { 'Authorization': `Bearer ${sm.token}` },
                cache: 'no-store'
            });
            const d = await res.json();
            if (d.success && Array.isArray(d.history)) {
                const serverIds = new Set();
                d.history.forEach(h => {
                    const hid = String(h.id);
                    serverIds.add(hid);
                    if (!byId.has(hid) || byId.get(hid).status === 'Pending') {
                        byId.set(hid, h);
                    }
                });
                // Backfill any local records missing from server (e.g. after server restart)
                localList.slice(0, 20).forEach(lh => {
                    if (lh && lh.id && !serverIds.has(String(lh.id))) {
                        fetch('/api/game/log-history', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${sm.token}`
                            },
                            body: JSON.stringify(lh)
                        }).catch(() => {});
                    }
                });
            }
        } catch (e) {}
    }

    _ghCache = Array.from(byId.values()).sort((a, b) =>
        String(b.created_at || '').localeCompare(String(a.created_at || ''))
    );
    if (sm && _ghCache.length > 0) {
        try {
            localStorage.setItem(sm._getLocalGameHistoryKey(), JSON.stringify(_ghCache.slice(0, 100)));
        } catch (e) {}
    }
    renderUnifiedGameHistory();
}

function renderUnifiedGameHistory() {
    const listEl = document.getElementById('gh-list-container');
    const countEl = document.getElementById('gh-stat-count');
    const betEl = document.getElementById('gh-stat-bet');
    const winEl = document.getElementById('gh-stat-win');

    const filtered = _ghActiveFilter === 'all'
        ? _ghCache
        : _ghCache.filter(h => h.game === _ghActiveFilter);

    const totalBet = filtered.reduce((acc, h) => acc + (parseFloat(h.bet_amount) || 0), 0);
    const totalWin = filtered.reduce((acc, h) => acc + (parseFloat(h.win_amount) || 0), 0);

    if (countEl) countEl.textContent = filtered.length;
    if (betEl) betEl.textContent = `₹${totalBet.toFixed(0)}`;
    if (winEl) winEl.textContent = `₹${totalWin.toFixed(2)}`;

    if (!listEl) return;
    if (filtered.length === 0) {
        listEl.innerHTML = `<div class="bdg-no-data" style="padding:40px 10px;"><div style="font-size:44px; opacity:0.35; margin-bottom:6px;">🎮</div><div>No game history yet. Play any game to see live records!</div></div>`;
        return;
    }

    const icons = {
        'Win Go': '🎯',
        'Aviator': '✈️',
        'Mines': '💎',
        'K3 Lottery': '🎲',
        'Ludo Cash': '👑',
        'AS King': '🔥'
    };

    listEl.innerHTML = filtered.slice(0, 60).map(h => {
        const st = String(h.status || 'Pending');
        const isWin = st.toLowerCase() === 'won';
        const isLoss = st.toLowerCase() === 'lost';
        const badgeCls = isWin ? 'gh-badge-win' : (isLoss ? 'gh-badge-loss' : 'gh-badge-pend');
        const amountTxt = isWin
            ? `+₹${parseFloat(h.win_amount || 0).toFixed(2)}`
            : (isLoss ? `-₹${parseFloat(h.bet_amount || 0).toFixed(2)}` : 'Pending');
        const dt = (h.created_at || '').replace('T', ' ').slice(0, 19);
        const ico = icons[h.game] || '🎮';

        return `
            <div class="gh-item-card">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
                    <div>
                        <div style="color:#fae59f; font-weight:800; font-size:13.5px;">${ico} ${h.game}</div>
                        <div style="color:#e4e4e7; font-size:12px; margin-top:2px;">${h.detail || 'Round Played'}</div>
                        <div style="color:#71717a; font-size:10.5px; margin-top:4px;">${dt} • Bet: ₹${parseFloat(h.bet_amount || 0).toFixed(2)}</div>
                    </div>
                    <div style="text-align:right; flex-shrink:0;">
                        <div class="${badgeCls}">${st.toUpperCase()}</div>
                        <div style="font-size:14px; font-weight:800; margin-top:4px; color:${isWin ? '#10b981' : (isLoss ? '#ef4444' : '#f59e0b')};">${amountTxt}</div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// ========================================================
// DEDICATED FRIENDS & 1-ON-1 DIRECT CHAT HUB
// ========================================================
let _fhActiveFriendUid = null;
let _fhActiveFriendPhone = '';
let _fhChatPollTimer = null;

function openFriendsHubModal() {
    const sm = window.stateManager;
    if (!sm || !sm.token) {
        if (sm) sm.showToast('Please login first to add friends & chat!', 'warning');
        openAuthModal('login');
        return;
    }
    const modal = document.getElementById('friends-hub-modal');
    if (modal) modal.classList.remove('hidden');
    backToFriendsHubList();
    loadFriendsHub();
}

function closeFriendsHubModal() {
    const modal = document.getElementById('friends-hub-modal');
    if (modal) modal.classList.add('hidden');
    if (_fhChatPollTimer) {
        clearInterval(_fhChatPollTimer);
        _fhChatPollTimer = null;
    }
}

function copyFriendsHubUid() {
    const sm = window.stateManager;
    const uid = String(sm?.uid || document.getElementById('fh-my-uid')?.textContent || '');
    if (!uid || uid === '--') return;
    if (navigator.clipboard) navigator.clipboard.writeText(uid).catch(() => {});
    if (sm) sm.showToast(`📋 Your UID (${uid}) copied! Share with your friends.`, 'success');
}

async function loadFriendsHub() {
    const sm = window.stateManager;
    if (!sm || !sm.token) return;
    try {
        const res = await fetch('/api/friends/list', {
            headers: { 'Authorization': `Bearer ${sm.token}` }
        });
        const d = await res.json();
        if (!d.success) return;

        const uidEl = document.getElementById('fh-my-uid');
        if (uidEl) uidEl.textContent = d.my_uid || sm.uid || '--';

        // Room Invites
        const invBox = document.getElementById('fh-invites-box');
        if (invBox) {
            const invites = d.invites || [];
            if (invites.length > 0) {
                invBox.classList.remove('hidden');
                invBox.innerHTML = invites.map(inv => `
                    <div class="ludo-invite-banner">
                        <div style="font-size:12px; color:#fff;">
                            <strong style="color:#fae59f;">🎲 UID ${inv.host_uid} invited you to Ludo!</strong><br>
                            <span style="color:#d4d4d8;">Room #${inv.room_code} • ${inv.joined_count}/${inv.max_players}P • ${inv.entry_fee > 0 ? '₹' + inv.entry_fee : 'Free'}</span>
                        </div>
                        <button type="button" class="ludo-mini-gold-btn" onclick="joinLudoFromFriendsHub('${inv.room_code}')">✅ Join Ludo</button>
                    </div>
                `).join('');
            } else {
                invBox.classList.add('hidden');
                invBox.innerHTML = '';
            }
        }

        // Pending Friend Requests
        const reqBox = document.getElementById('fh-requests-box');
        if (reqBox) {
            const reqs = d.requests || [];
            if (reqs.length > 0) {
                reqBox.classList.remove('hidden');
                reqBox.innerHTML = reqs.map(r => `
                    <div class="ludo-invite-banner" style="border-color:#10b981; background:rgba(16,185,129,0.14);">
                        <div style="font-size:12px; color:#fff;">
                            <strong>👋 Friend Request: UID ${r.uid}</strong> (${r.phone})
                        </div>
                        <div style="display:flex; gap:6px;">
                            <button type="button" class="ludo-mini-gold-btn" onclick="respondFriendFromHub(${r.uid}, 'accept')">Accept</button>
                            <button type="button" class="ludo-mini-red-btn" onclick="respondFriendFromHub(${r.uid}, 'reject')">✗</button>
                        </div>
                    </div>
                `).join('');
            } else {
                reqBox.classList.add('hidden');
                reqBox.innerHTML = '';
            }
        }

        // Accepted Friends List
        const listEl = document.getElementById('fh-friends-list');
        if (listEl) {
            const friends = d.friends || [];
            if (friends.length === 0) {
                listEl.innerHTML = `<div class="bdg-no-data" style="padding:28px 10px;"><div style="font-size:40px; opacity:0.35; margin-bottom:6px;">👥</div><div>No friends yet. Enter your friend's UID above to add them!</div></div>`;
            } else {
                listEl.innerHTML = friends.map(f => `
                    <div class="fh-friend-card">
                        <div>
                            <div style="color:#fae59f; font-weight:800; font-size:13.5px;">👤 UID ${f.uid}</div>
                            <div style="color:#94a3b8; font-size:11px;">${f.phone} • <span style="color:#10b981;">● Friend</span></div>
                        </div>
                        <div style="display:flex; gap:6px;">
                            <button type="button" class="fh-chat-btn" onclick="openDirectFriendChat(${f.uid}, '${f.phone}')">💬 Chat</button>
                            <button type="button" class="ludo-mini-gold-btn" onclick="quickInviteFriendToLudo(${f.uid})">🎲 Play</button>
                        </div>
                    </div>
                `).join('');
            }
        }
    } catch (e) {}
}

async function addFriendFromHub() {
    const sm = window.stateManager;
    const inp = document.getElementById('fh-add-uid-input');
    const targetUid = parseInt(inp?.value || '0', 10);
    if (!targetUid) {
        if (sm) sm.showToast('Please enter a valid Friend UID number!', 'warning');
        return;
    }
    try {
        const res = await fetch('/api/friends/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sm.token}` },
            body: JSON.stringify({ friend_uid: targetUid })
        });
        const d = await res.json();
        if (sm) sm.showToast(d.message || 'Done', d.success ? 'success' : 'warning');
        if (d.success && inp) inp.value = '';
        loadFriendsHub();
    } catch (e) {}
}

async function respondFriendFromHub(friendUid, action) {
    const sm = window.stateManager;
    try {
        const res = await fetch('/api/friends/respond', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sm.token}` },
            body: JSON.stringify({ friend_uid: friendUid, action })
        });
        const d = await res.json();
        if (sm) sm.showToast(d.message, d.success ? 'success' : 'error');
        loadFriendsHub();
    } catch (e) {}
}

function backToFriendsHubList() {
    if (_fhChatPollTimer) {
        clearInterval(_fhChatPollTimer);
        _fhChatPollTimer = null;
    }
    _fhActiveFriendUid = null;
    const listV = document.getElementById('fh-list-view');
    const chatV = document.getElementById('fh-chat-view');
    if (listV) { listV.classList.remove('hidden'); listV.style.display = 'flex'; }
    if (chatV) { chatV.classList.add('hidden'); chatV.style.display = 'none'; }
}

function openDirectFriendChat(friendUid, phoneStr = '') {
    _fhActiveFriendUid = friendUid;
    _fhActiveFriendPhone = phoneStr;
    const listV = document.getElementById('fh-list-view');
    const chatV = document.getElementById('fh-chat-view');
    const titleEl = document.getElementById('fh-chat-title');
    if (listV) { listV.classList.add('hidden'); listV.style.display = 'none'; }
    if (chatV) { chatV.classList.remove('hidden'); chatV.style.display = 'flex'; }
    if (titleEl) titleEl.textContent = `💬 UID ${friendUid}`;

    loadDirectFriendMessages();
    if (_fhChatPollTimer) clearInterval(_fhChatPollTimer);
    _fhChatPollTimer = setInterval(loadDirectFriendMessages, 2500);
}

async function loadDirectFriendMessages() {
    const sm = window.stateManager;
    if (!sm?.token || !_fhActiveFriendUid) return;
    try {
        const res = await fetch(`/api/friends/chat/${_fhActiveFriendUid}`, {
            headers: { 'Authorization': `Bearer ${sm.token}` }
        });
        const d = await res.json();
        if (d.success && Array.isArray(d.messages)) {
            renderDirectFriendMessages(d.messages, d.my_uid || sm.uid);
        }
    } catch (e) {}
}

function renderDirectFriendMessages(msgs, myUid) {
    const body = document.getElementById('fh-chat-body');
    if (!body) return;
    if (!msgs || msgs.length === 0) {
        body.innerHTML = `<div style="color:#71717a; text-align:center; font-size:12px; margin:auto;">No messages yet! Say Hi &amp; invite UID ${_fhActiveFriendUid} to Ludo 🎲</div>`;
        return;
    }
    body.innerHTML = msgs.map(m => {
        const isMe = Number(m.from_uid) === Number(myUid);
        const cls = isMe ? 'chat-user' : 'chat-bot';
        const tm = (m.created_at || '').replace('T', ' ').slice(11, 16);
        const joinBtn = m.room_code
            ? `<div style="margin-top:8px;"><button type="button" class="ludo-mini-gold-btn" style="width:100%; padding:7px 10px; border:1px solid #2b1704;" onclick="joinLudoFromFriendsHub('${m.room_code}')">🎲 Join Ludo Room #${m.room_code}</button></div>`
            : '';
        return `
            <div class="chat-bubble ${cls}">
                <div class="chat-sender-lbl"><span>${isMe ? 'You' : 'UID ' + m.from_uid}</span><span>${tm}</span></div>
                <div style="white-space:pre-wrap;">${_escChatText(m.text)}</div>
                ${joinBtn}
            </div>
        `;
    }).join('');
    body.scrollTop = body.scrollHeight;
}

function sendQuickFriendMsg(text) {
    const inp = document.getElementById('fh-chat-input');
    if (inp) inp.value = text;
    sendFriendDirectMessage();
}

async function sendFriendDirectMessage(customText = '', roomCode = '') {
    const sm = window.stateManager;
    if (!sm?.token || !_fhActiveFriendUid) return;
    const inp = document.getElementById('fh-chat-input');
    const text = (customText || inp?.value || '').trim();
    if (!text) return;
    if (!customText && inp) inp.value = '';
    try {
        const res = await fetch('/api/friends/chat/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sm.token}` },
            body: JSON.stringify({ friend_uid: _fhActiveFriendUid, message: text, room_code: roomCode })
        });
        const d = await res.json();
        if (d.success && Array.isArray(d.messages)) {
            renderDirectFriendMessages(d.messages, sm.uid);
        }
    } catch (e) {}
}

async function quickInviteFriendToLudo(friendUid) {
    const sm = window.stateManager;
    if (!sm?.token) return;
    try {
        // Create a Free 4-Player Online Ludo Room (or ₹0 so any friend can jump in immediately!)
        const res = await fetch('/api/ludo/room/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sm.token}` },
            body: JSON.stringify({ max_players: 4, entry_fee: 0 })
        });
        const d = await res.json();
        if (!d.success || !d.room) {
            sm.showToast(d.message || 'Could not create room', 'error');
            return;
        }
        const code = d.room.code;
        // Invite friend to room + drop clickable invite card in their direct chat!
        await fetch('/api/ludo/room/invite', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sm.token}` },
            body: JSON.stringify({ room_code: code, friend_uid: friendUid })
        });
        await fetch('/api/friends/chat/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sm.token}` },
            body: JSON.stringify({
                friend_uid: friendUid,
                message: `🎲 Maine Ludo Room #${code} banaya hai! Jaldi join kar saath khelte hain!`,
                room_code: code
            })
        });

        closeFriendsHubModal();
        // Open Ludo directly into the created waiting room!
        sm.openGameView('ludo', true);
        setTimeout(() => {
            if (window.ludoGame) {
                window.ludoGame.setPlayMode('online');
                window.ludoGame.enterOnlineRoomState(d.room);
                window.ludoGame.loadFriendsAndInvites();
            }
        }, 120);
        sm.showToast(`📩 Ludo Room #${code} invite sent to UID ${friendUid}!`, 'success');
    } catch (e) {
        sm.showToast('Error creating Ludo room.', 'error');
    }
}

function inviteCurrentChatFriendToLudo() {
    if (_fhActiveFriendUid) quickInviteFriendToLudo(_fhActiveFriendUid);
}

function joinLudoFromFriendsHub(roomCode) {
    const sm = window.stateManager;
    closeFriendsHubModal();
    if (sm) sm.openGameView('ludo', true);
    setTimeout(() => {
        if (window.ludoGame) {
            window.ludoGame.setPlayMode('online');
            window.ludoGame.joinOnlineRoom(roomCode);
        }
    }, 150);
}

// ========================================================
// SECRET 8-TAP ASGAMES LOGO -> HIDDEN ADMIN PASSWORD GATE
// ========================================================
let _secretLogoTaps = 0;
let _secretLogoTimer = null;

function handleSecretLogoTap() {
    _secretLogoTaps++;
    if (_secretLogoTimer) clearTimeout(_secretLogoTimer);
    _secretLogoTimer = setTimeout(() => {
        _secretLogoTaps = 0;
    }, 3500);

    if (_secretLogoTaps >= 8) {
        _secretLogoTaps = 0;
        if (_secretLogoTimer) clearTimeout(_secretLogoTimer);
        openSecretAdminModal();
    }
}

function openSecretAdminModal() {
    const modal = document.getElementById('secret-admin-modal');
    const inp = document.getElementById('secret-admin-password');
    const err = document.getElementById('secret-admin-err');
    if (err) err.textContent = '';
    if (inp) inp.value = '';
    if (modal) modal.classList.remove('hidden');
    setTimeout(() => { if (inp) inp.focus(); }, 80);
}

function closeSecretAdminModal() {
    const modal = document.getElementById('secret-admin-modal');
    const inp = document.getElementById('secret-admin-password');
    if (inp) inp.value = '';
    if (modal) modal.classList.add('hidden');
}

async function submitSecretAdminUnlock() {
    const inp = document.getElementById('secret-admin-password');
    const err = document.getElementById('secret-admin-err');
    const btn = document.getElementById('secret-admin-unlock-btn');
    const password = (inp ? inp.value : '').trim();

    if (!password) {
        if (err) err.textContent = 'Please enter password.';
        return;
    }

    if (btn) { btn.disabled = true; btn.textContent = 'Checking...'; }
    if (err) err.textContent = '';

    try {
        const res = await fetch('/api/admin/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        const d = await res.json();
        if (d.success && d.adminKey) {
            localStorage.setItem('asg_admin_key', d.adminKey);
            sessionStorage.setItem('asg_admin_unlocked', '1');
            closeSecretAdminModal();
            window.location.href = '/admin';
            return;
        }
        if (err) err.textContent = d.message || 'Invalid password!';
        if (inp) { inp.value = ''; inp.focus(); }
    } catch (e) {
        if (err) err.textContent = 'Connection error. Please try again.';
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Unlock'; }
    }
}

// Global initialization
window.addEventListener('DOMContentLoaded', () => {
    window.stateManager = new StateManager();
    applyLanguage(currentLang);
    initHeroCarousel();
    initLivePlayersCounter();
    window.stateManager.showSplashLoader('Loading ASGames VIP...', 850);

    // Automatically show Extra First Deposit Bonus modal right after login!
    if (localStorage.getItem('asg_token')) {
        setTimeout(() => {
            openFirstDepositModal(false);
        }, 950);
    }
});
