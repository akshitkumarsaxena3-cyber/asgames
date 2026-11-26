// ASGames Full-Stack Application Controller & State Manager

class StateManager {
    constructor() {
        this.token = localStorage.getItem('asg_token') || null;
        this.user = null;
        this.balance = this.token ? (parseFloat(localStorage.getItem('asg_balance')) || 0.00) : 0.00;
        const cachedDep = parseFloat(localStorage.getItem('asg_deposit_balance'));
        const cachedWin = parseFloat(localStorage.getItem('asg_winning_balance'));
        if (this.token && !isNaN(cachedDep) && !isNaN(cachedWin)) {
            this.user = {
                balance: this.balance,
                deposit_balance: cachedDep,
                winning_balance: cachedWin
            };
        }
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
                this.isSpecialVip = Boolean(data.user.is_special_vip || (data.user.phone && String(data.user.phone).replace(/\D/g, '').endsWith('9720955287')));

                localStorage.setItem('asg_balance', this.balance);
                if (typeof data.user.deposit_balance === 'number') localStorage.setItem('asg_deposit_balance', data.user.deposit_balance);
                if (typeof data.user.winning_balance === 'number') localStorage.setItem('asg_winning_balance', data.user.winning_balance);
                localStorage.setItem('asg_uid', this.uid);
                localStorage.setItem('asg_invite', this.inviteCode);
                if (this.isSpecialVip) {
                    localStorage.setItem('asg_is_vip_god', '1');
                    const vipBtn = document.getElementById('vip-wingo-subnav-btn');
                    if (vipBtn) {
                        vipBtn.classList.remove('hidden');
                        vipBtn.style.display = 'inline-flex';
                    }
                } else {
                    localStorage.removeItem('asg_is_vip_god');
                    const vipBtn = document.getElementById('vip-wingo-subnav-btn');
                    if (vipBtn) {
                        vipBtn.classList.add('hidden');
                        vipBtn.style.display = 'none';
                    }
                }

                this.updateBalanceUI();
                this.updateAuthButtonUI(true);
                this.renderPromotionTab();
                this.renderAccountTab();
            } else {
                this.token = null;
                localStorage.removeItem('asg_token');
                localStorage.removeItem('asg_is_vip_god');
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
                        localStorage.removeItem('asg_deposit_balance');
                        localStorage.removeItem('asg_winning_balance');
                        localStorage.removeItem('asg_is_vip_god');
                        location.reload();
                    }
                };
            }
        } else {
            if (balCard) balCard.classList.add('hidden');
            const vipBtn = document.getElementById('vip-wingo-subnav-btn');
            if (vipBtn) {
                vipBtn.classList.add('hidden');
                vipBtn.style.display = 'none';
            }
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
                    this.user = data.user;
                    if (typeof data.user.deposit_balance === 'number') localStorage.setItem('asg_deposit_balance', data.user.deposit_balance);
                    if (typeof data.user.winning_balance === 'number') localStorage.setItem('asg_winning_balance', data.user.winning_balance);
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
                    } else {
                        // Sub-wallets (winning/deposit) may have changed even if total balance remained identical
                        this.updateBalanceUI();
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

        const wdBalEl = document.getElementById('wd-withdrawable-val');
        if (wdBalEl) wdBalEl.textContent = formatted;
        const walMainEl = document.getElementById('wal-main-pct');
        if (walMainEl) walMainEl.textContent = '100%';
    }

    async syncGameDelta(delta, desc = '') {
        if (!this.token || !delta) return;
        this._syncLockUntil = Date.now() + 4000;
        try {
            const res = await fetch('/api/wallet/sync-game-delta', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify({
                    delta,
                    details: desc || (delta > 0 ? 'Game Win' : 'Game Bet'),
                    game: (desc && desc.split(/[\s:•-]/)[0]) || 'Game'
                })
            });
            const d = await res.json();
            if (d.success && typeof d.balance === 'number') {
                this.balance = d.balance;
                if (this.user) {
                    this.user.balance = d.balance;
                    if (typeof d.deposit_balance === 'number') this.user.deposit_balance = d.deposit_balance;
                    if (typeof d.winning_balance === 'number') this.user.winning_balance = d.winning_balance;
                }
                localStorage.setItem('asg_balance', this.balance);
                if (typeof d.deposit_balance === 'number') localStorage.setItem('asg_deposit_balance', d.deposit_balance);
                if (typeof d.winning_balance === 'number') localStorage.setItem('asg_winning_balance', d.winning_balance);
                this.updateBalanceUI();
            }
        } catch (e) {}
    }

    setLocalBalance(newBalance, flashDir = null) {
        this.balance = Math.max(0, Math.round(Number(newBalance || 0) * 100) / 100);
        if (this.user) {
            this.user.balance = this.balance;
        }
        this._syncLockUntil = Date.now() + 5000;
        localStorage.setItem('asg_balance', this.balance);
        this.updateBalanceUI(flashDir);
        if (typeof updateWithdrawSummary === 'function') updateWithdrawSummary();
        if (typeof updateWalletCenterRings === 'function') updateWalletCenterRings();
    }

    addBalance(amount, desc, skipServerSync = false) {
        if (desc && typeof desc === 'string') {
            const dLow = desc.toLowerCase();
            if (dLow.includes('bonus') || dLow.includes('gift') || dLow.includes('reward') || dLow.includes('spin') || dLow.includes('wheel') || dLow.includes('check-in')) {
                amount = Math.min(100, amount);
            }
        }
        this.balance = Math.round((this.balance + amount) * 100) / 100;
        if (this.user) {
            this.user.balance = this.balance;
            this.user.winning_balance = Math.round(((this.user.winning_balance || 0) + amount) * 100) / 100;
            localStorage.setItem('asg_winning_balance', this.user.winning_balance);
        }
        localStorage.setItem('asg_balance', this.balance);
        this.updateBalanceUI('up');
        if (!skipServerSync) this.syncGameDelta(amount, desc);
    }

    deductBalance(amount, desc, skipServerSync = false) {
        this.balance = Math.max(0, Math.round((this.balance - amount) * 100) / 100);
        if (this.user) {
            this.user.balance = this.balance;
            const fromDep = Math.min(this.user.deposit_balance || 0, amount);
            const fromWin = Math.max(0, amount - fromDep);
            this.user.deposit_balance = Math.max(0, Math.round(((this.user.deposit_balance || 0) - fromDep) * 100) / 100);
            this.user.winning_balance = Math.max(0, Math.round(((this.user.winning_balance || 0) - fromWin) * 100) / 100);
            localStorage.setItem('asg_deposit_balance', this.user.deposit_balance);
            localStorage.setItem('asg_winning_balance', this.user.winning_balance);
        }
        localStorage.setItem('asg_balance', this.balance);
        this.updateBalanceUI('down');
        if (!skipServerSync) this.syncGameDelta(-amount, desc);
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
                const rawAmt = parseFloat(amtInput ? amtInput.value : 0);
                const utr = utrInput ? utrInput.value.trim() : '';

                const isUsdt = window._selectedDepositMethod === 'USDT';
                const usdtRate = window._livePaymentDetails?.usdt_rate || 90.0;
                let usdtAmt = 0;
                let finalCoinAmt = rawAmt;

                if (isUsdt) {
                    usdtAmt = rawAmt;
                    if (!usdtAmt || usdtAmt < 2) {
                        this.showToast(`Minimum USDT deposit is 2 USDT (approx ₹${(2 * usdtRate).toFixed(0)} coins)`, 'warning');
                        return;
                    }
                    finalCoinAmt = Math.round(usdtAmt * usdtRate * 100) / 100;
                } else {
                    if (!rawAmt || rawAmt < 100) {
                        this.showToast('Minimum deposit is ₹100', 'warning');
                        return;
                    }
                }

                let finalUtr = utr;
                let screenshotData = null;

                if (isUsdt) {
                    screenshotData = window._usdtScreenshotDataUrl || null;
                    const txIdInp = (document.getElementById('recharge-usdt-txid-input')?.value || '').trim();
                    if (txIdInp) {
                        finalUtr = txIdInp;
                    } else if (screenshotData) {
                        finalUtr = 'SCREENSHOT_ATTACHED';
                    } else if (!finalUtr || finalUtr.length < 6) {
                        this.showToast('Please upload USDT Transfer Screenshot or enter TxID / Hash!', 'warning');
                        return;
                    }
                } else {
                    if (!utr || utr.length < 6) {
                        this.showToast('Please enter your 12-digit UTR/Transaction ID', 'warning');
                        return;
                    }
                }

                try {
                    const res = await fetch('/api/wallet/deposit', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${this.token}`
                        },
                        body: JSON.stringify({
                            amount: finalCoinAmt,
                            usdt_amount: isUsdt ? usdtAmt : null,
                            usdt_rate: isUsdt ? usdtRate : null,
                            channel: window._selectedDepositChannel || (isUsdt ? 'USDT-TRC20' : 'UPI-QR'),
                            utr: finalUtr,
                            screenshot: screenshotData
                        })
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
                        if (typeof clearUsdtScreenshot === 'function') clearUsdtScreenshot();
                        const txIdInp = document.getElementById('recharge-usdt-txid-input');
                        if (txIdInp) txIdInp.value = '';
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

                // 1. Minimum amount and wallet check
                if (!amt || amt < 110) {
                    this.showToast('Minimum withdrawal is ₹110', 'warning');
                    return;
                }

                // 2. Withdrawal timings check (10:00 AM to 08:00 PM IST)
                const now = new Date();
                const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
                const h = ist.getUTCHours();
                const m = ist.getUTCMinutes();
                const isOpen = (h >= 10 && (h < 20 || (h === 20 && m === 0)));
                if (!isOpen) {
                    this.showToast('Withdrawals are allowed only between 10:00 AM and 08:00 PM IST!', 'warning');
                    return;
                }

                // 3. Daily withdrawal limit check
                if (window._currentTurnoverInfo && window._currentTurnoverInfo.remaining_withdrawals !== undefined && window._currentTurnoverInfo.remaining_withdrawals <= 0) {
                    this.showToast('Daily withdrawal limit reached! Ek din me maximum 3 withdrawal requests allow hain.', 'warning');
                    return;
                }

                if (amt > this.balance) {
                    this.showToast('Insufficient wallet balance!', 'error');
                    return;
                }

                // 4. Winning balance check (Only won money can be withdrawn, not deposited money)
                const winBal = (window._currentTurnoverInfo && typeof window._currentTurnoverInfo.winning_balance === 'number')
                    ? window._currentTurnoverInfo.winning_balance
                    : (this.user && typeof this.user.winning_balance === 'number' ? this.user.winning_balance : this.balance);
                if (amt > winBal) {
                    this.showToast(`Sirf game se jeete hue paise hi withdraw ho sakte hain! Aapka withdrawable jeeta hua balance ₹${winBal.toFixed(2)} hai.`, 'warning');
                    return;
                }

                // 5. 30-Minute Win Cooldown check
                if (window._currentTurnoverInfo && window._currentTurnoverInfo.win_cooldown_remaining_sec > 0) {
                    const remMin = Math.ceil(window._currentTurnoverInfo.win_cooldown_remaining_sec / 60);
                    this.showToast(`Game jeetne ke 30 minute baad hi withdrawal lag sakti hai! Kripya ${remMin} minute baad koshish karein.`, 'warning');
                    return;
                }

                if (!account) {
                    this.showToast('Please add your Bank Account or UPI ID first to receive payout!', 'warning');
                    if (typeof openAddBeneficiarySheet === 'function') openAddBeneficiarySheet();
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

        // Pre-select ₹500 if input is empty
        const inp = document.getElementById('recharge-amount-input');
        if (inp && (!inp.value || parseFloat(inp.value) < 100)) {
            inp.value = '500';
            document.querySelectorAll('.dep-amt-btn, .recharge-pill').forEach(b => {
                b.classList.toggle('active', b.dataset.amount === '500');
            });
        }

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

        const prizes = [10, 50, 5, 100, 20, 75, 15, 30];
        let isSpinning = false;
        let currentRotation = 0;

        spinBtn.onclick = () => {
            if (isSpinning) return;
            isSpinning = true;
            spinBtn.disabled = true;

            const prizeIndex = Math.floor(Math.random() * prizes.length);
            const prizeAmount = Math.min(100, prizes[prizeIndex]);
            const extraDegrees = 360 * 5 + (360 - (prizeIndex * (360 / prizes.length)) - 22.5);
            currentRotation += extraDegrees;

            wheel.style.transition = 'transform 4s cubic-bezier(0.15, 0.9, 0.2, 1)';
            wheel.style.transform = `rotate(${currentRotation}deg)`;

            if (window.sound) window.sound.diceRoll();

            setTimeout(() => {
                isSpinning = false;
                spinBtn.disabled = false;
                // Wheel is display-only ("khali dikhane ke liye hai"), never adds real wallet balance
                if (window.sound) window.sound.jackpot();
                this.showToast('Wheel spin completed! Invite friends for more spins.', 'info');
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
            if (this.user && this.user.name) {
                nameEl.textContent = this.user.name;
            } else if (this.user && this.user.phone) {
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
                    headers: { 'Authorization': `Bearer ${this.token}` },
                    cache: 'no-store'
                });
                const d = await res.json();
                if (d.success && Array.isArray(d.transactions) && d.transactions.length > 0) {
                    container.innerHTML = d.transactions.map(tx => {
                        const isCredit = ['deposit', 'win', 'commission'].includes(tx.type);
                        const isBet = tx.type === 'bet';
                        const st = String(tx.status || 'pending').toLowerCase();
                        const isApp = (st === 'approved' || st === 'completed');
                        const isRej = (st === 'rejected');
                        const stColor = isBet ? '#38bdf8' : (isApp ? '#10b981' : (isRej ? '#ef4444' : '#f5c443'));
                        const stText = isBet ? 'BET PLACED' : (isApp ? 'COMPLETED' : (isRej ? 'REJECTED (REFUNDED)' : 'PENDING'));
                        const txTitle = isBet ? 'BET' : tx.type.toUpperCase();
                        const amt = Math.abs(parseFloat(tx.amount || 0));
                        return `
                            <div class="tx-card">
                                <div class="tx-left">
                                    <span class="tx-desc">${txTitle}: ${tx.details || ''}</span>
                                    <span class="tx-time">${(tx.created_at || '').replace('T', ' ').slice(0, 19)} | Status: <strong style="color:${stColor}; font-weight:800;">${stText}</strong></span>
                                </div>
                                <div class="tx-amount ${isCredit ? 'text-win' : 'text-loss'}">
                                    ${isCredit ? '+' : '-'}₹${amt.toFixed(2)}
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
        full_name: 'Full Name',
        ph_name: 'Enter your full name',
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
        full_name: 'पूरा नाम',
        ph_name: 'अपना पूरा नाम दर्ज करें',
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
            if (d.user) {
                localStorage.setItem('asg_balance', d.user.balance || 0);
                if (typeof d.user.deposit_balance === 'number') localStorage.setItem('asg_deposit_balance', d.user.deposit_balance);
                if (typeof d.user.winning_balance === 'number') localStorage.setItem('asg_winning_balance', d.user.winning_balance);
            }
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
    const name = (document.getElementById('reg-name')?.value || '').trim();
    const phone = (document.getElementById('reg-phone')?.value || '').trim();
    const email = (document.getElementById('reg-email')?.value || '').trim();
    const otp = (document.getElementById('reg-otp')?.value || '').trim();
    const password = (document.getElementById('reg-password')?.value || '').trim();
    const confirmPassword = (document.getElementById('reg-password-confirm')?.value || '').trim();
    const invite = (document.getElementById('reg-invite')?.value || '').trim();
    const agree = document.getElementById('reg-agree');

    if (!name) {
        alert(currentLang === 'hi' ? 'कृपया अपना पूरा नाम डालें' : 'Please enter your full name');
        return;
    }
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
            body: JSON.stringify({ name, phone, email, otp, password, invite_code: invite })
        });
        const d = await res.json();
        if (d.success) {
            localStorage.setItem('asg_token', d.token);
            if (d.user) {
                localStorage.setItem('asg_balance', d.user.balance || 0);
                if (typeof d.user.deposit_balance === 'number') localStorage.setItem('asg_deposit_balance', d.user.deposit_balance);
                if (typeof d.user.winning_balance === 'number') localStorage.setItem('asg_winning_balance', d.user.winning_balance);
            }
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
    { deposit: 200000, bonus: 100 },
    { deposit: 100000, bonus: 100 },
    { deposit: 30000,  bonus: 100 },
    { deposit: 10000,  bonus: 100 },
    { deposit: 3000,   bonus: 100 },
    { deposit: 1000,   bonus: 100 },
    { deposit: 500,    bonus: 80 },
    { deposit: 300,    bonus: 50 },
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
    { level: 1,  invitees: 1,    recharge: 300, reward: 20 },
    { level: 2,  invitees: 3,    recharge: 300, reward: 35 },
    { level: 3,  invitees: 10,   recharge: 300, reward: 50 },
    { level: 4,  invitees: 30,   recharge: 300, reward: 65 },
    { level: 5,  invitees: 60,   recharge: 300, reward: 75 },
    { level: 6,  invitees: 100,  recharge: 300, reward: 85 },
    { level: 7,  invitees: 200,  recharge: 300, reward: 90 },
    { level: 8,  invitees: 500,  recharge: 300, reward: 95 },
    { level: 9,  invitees: 1000, recharge: 300, reward: 100 },
    { level: 10, invitees: 5000, recharge: 300, reward: 100 }
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
    const cappedReward = Math.min(100, reward);
    sm.addBalance(cappedReward, `Invitation Bonus Tier ${level}`);
    sm.showWinModal(cappedReward, `Invitation Bonus #${level} Unlocked!`);
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
        { name: 'USDT-TRC20', range: '1 USDT ≈ ₹90 Coins' },
        { name: 'USDT-BEP20', range: '1 USDT ≈ ₹90 Coins' }
    ],
    'ARPay': [
        { name: 'ARPay (+1% Bonus)', range: 'Balance:100 - 50K' }
    ]
};

function selectDepositMethod(method, tileEl) {
    window._selectedDepositMethod = method;
    document.querySelectorAll('.dep-method-tile').forEach(t => t.classList.remove('active'));
    if (tileEl) tileEl.classList.add('active');

    const isUsdt = method === 'USDT';
    const inrGrid = document.getElementById('dep-amounts-inr-grid');
    const usdtGrid = document.getElementById('dep-amounts-usdt-grid');
    const calcBox = document.getElementById('dep-usdt-calculator-box');
    const symEl = document.getElementById('dep-input-currency-symbol');
    const inp = document.getElementById('recharge-amount-input');

    if (isUsdt) {
        if (inrGrid) inrGrid.style.display = 'none';
        if (usdtGrid) usdtGrid.style.display = 'grid';
        if (calcBox) calcBox.style.display = 'block';
        if (symEl) symEl.textContent = '₮';
        if (inp) {
            inp.placeholder = '10 - 10,000 USDT';
            inp.value = '50';
        }
    } else {
        if (inrGrid) inrGrid.style.display = 'grid';
        if (usdtGrid) usdtGrid.style.display = 'none';
        if (calcBox) calcBox.style.display = 'none';
        if (symEl) symEl.textContent = '₹';
        if (inp && (inp.value === '50' || !inp.value)) {
            inp.placeholder = '₹100.00 - ₹50,000.00';
            inp.value = '500';
        }
    }

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
    updateDepositButtonState();
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

function selectDepositAmount(amt, el) {
    const inp = document.getElementById('recharge-amount-input');
    if (inp) {
        inp.value = amt;
    }
    document.querySelectorAll('.dep-amt-btn, .recharge-pill').forEach(b => {
        const bAmt = parseFloat(b.dataset.amount || '0');
        b.classList.toggle('active', bAmt === parseFloat(amt));
    });
    if (el) el.classList.add('active');
    updateDepositButtonState();
    if (window.sound) window.sound.click();
}
window.selectDepositAmount = selectDepositAmount;

function selectUsdtDepositAmount(usdtAmt, el) {
    const inp = document.getElementById('recharge-amount-input');
    if (inp) {
        inp.value = usdtAmt;
    }
    document.querySelectorAll('.dep-usdt-btn').forEach(b => {
        const bAmt = parseFloat(b.dataset.usdt || '0');
        b.classList.toggle('active', bAmt === parseFloat(usdtAmt));
    });
    if (el) el.classList.add('active');
    updateDepositButtonState();
    if (window.sound) window.sound.click();
}
window.selectUsdtDepositAmount = selectUsdtDepositAmount;

function updateDepositButtonState() {
    const inp = document.getElementById('recharge-amount-input');
    const footerBtn = document.getElementById('dep-open-pay-btn');
    const cardBtn = document.getElementById('dep-card-pay-btn');
    const isUsdt = window._selectedDepositMethod === 'USDT';
    const pay = window._livePaymentDetails || {};
    const usdtRate = pay.usdt_rate || 90.0;
    const rawVal = parseFloat(inp?.value || '0');

    if (isUsdt) {
        const rateBadge = document.getElementById('dep-usdt-live-rate-badge');
        if (rateBadge) rateBadge.textContent = `1 USDT = ₹${usdtRate.toFixed(2)} Coins`;

        const coinsLbl = document.getElementById('dep-usdt-converted-coins-lbl');
        const convertedCoins = Math.round(rawVal * usdtRate * 100) / 100;
        if (coinsLbl) {
            coinsLbl.innerHTML = `₹${convertedCoins.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span style="font-size:12px; color:#38bdf8;">Coins</span>`;
        }

        if (rawVal >= 2) {
            const formattedCoins = convertedCoins.toLocaleString('en-IN');
            if (footerBtn) {
                footerBtn.classList.add('ready');
                footerBtn.classList.remove('disabled');
                footerBtn.textContent = `Deposit ${rawVal} USDT (₹${formattedCoins} Coins)`;
            }
            if (cardBtn) {
                cardBtn.classList.add('ready');
                cardBtn.classList.remove('disabled');
                cardBtn.textContent = `⚡ Deposit ${rawVal} USDT (₹${formattedCoins} Coins)`;
            }
        } else {
            if (footerBtn) {
                footerBtn.classList.remove('ready');
                footerBtn.classList.add('disabled');
                footerBtn.textContent = rawVal > 0 ? `Min 2 USDT` : `Deposit USDT`;
            }
            if (cardBtn) {
                cardBtn.classList.remove('ready');
                cardBtn.classList.add('disabled');
                cardBtn.textContent = rawVal > 0 ? `Min 2 USDT (₹${(2 * usdtRate).toFixed(0)})` : `Enter USDT Amount`;
            }
        }
    } else {
        const amt = rawVal;
        if (amt >= 100) {
            const formattedAmt = amt.toLocaleString('en-IN');
            if (footerBtn) {
                footerBtn.classList.add('ready');
                footerBtn.classList.remove('disabled');
                footerBtn.textContent = `Deposit ₹${formattedAmt}`;
            }
            if (cardBtn) {
                cardBtn.classList.add('ready');
                cardBtn.classList.remove('disabled');
                cardBtn.textContent = `⚡ Deposit ₹${formattedAmt}`;
            }
        } else {
            if (footerBtn) {
                footerBtn.classList.remove('ready');
                footerBtn.classList.add('disabled');
                footerBtn.textContent = amt > 0 ? `Min ₹100` : `Deposit`;
            }
            if (cardBtn) {
                cardBtn.classList.remove('ready');
                cardBtn.classList.add('disabled');
                cardBtn.textContent = amt > 0 ? `Deposit (Min ₹100)` : `Select Amount`;
            }
        }
    }
}
window.updateDepositButtonState = updateDepositButtonState;

function clearDepositAmount() {
    const inp = document.getElementById('recharge-amount-input');
    if (inp) inp.value = '';
    document.querySelectorAll('.dep-amt-btn, .recharge-pill, .dep-usdt-btn').forEach(b => b.classList.remove('active'));
    updateDepositButtonState();
}
window.clearDepositAmount = clearDepositAmount;

const USDT_WALLETS = {
    trc20: {
        name: "TRC20 (Tron)",
        address: "TCwpq6nk9KKs3FKgm9oGhw8pgKKjs7JnKa"
    },
    bep20: {
        name: "BEP20 (BNB Smart Chain)",
        address: "0x8f1794c280daA146Ca8A46c1b73716D9f3E52AE5"
    },
    polygon: {
        name: "Polygon (POS)",
        address: "0x8f1794c280daA146Ca8A46c1b73716D9f3E52AE5"
    },
    arbitrum: {
        name: "Arbitrum One",
        address: "0x8f1794c280daA146Ca8A46c1b73716D9f3E52AE5"
    },
    erc20: {
        name: "ERC20 (Ethereum)",
        address: "0x8f1794c280daA146Ca8A46c1b73716D9f3E52AE5"
    },
    solana: {
        name: "Solana (SPL)",
        address: "HdFgzjXMY1HLGh3ogAswvyrAAF5NFqKa61EDQB6krdVH"
    }
};
window.USDT_WALLETS = USDT_WALLETS;

function updateUsdtWalletNetwork() {
    const netSelect = document.getElementById("usdtNetwork");
    const selected = (netSelect ? netSelect.value : "trc20") || "trc20";
    const pay = window._livePaymentDetails || {};
    const liveWallets = pay.usdt_wallets || {};
    const data = liveWallets[selected] || USDT_WALLETS[selected] || USDT_WALLETS.trc20;

    const addrEl = document.getElementById("walletAddress");
    const warnEl = document.getElementById("networkWarning");
    const qrEl = document.getElementById("qrImage");
    const copyBtnEl = document.getElementById("copyBtn");
    const chLbl = document.getElementById('dep-pay-channel-lbl');

    if (addrEl) addrEl.innerText = data.address;
    if (warnEl) warnEl.innerText = "⚠️ Only send USDT via " + data.name + " network.";
    if (qrEl) qrEl.src = "https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=" + encodeURIComponent(data.address);
    if (copyBtnEl) {
        copyBtnEl.innerText = "Copy Address";
        copyBtnEl.style.background = "#00b894";
    }
    window._selectedDepositChannel = "USDT-" + selected.toUpperCase();
    if (chLbl) chLbl.textContent = window._selectedDepositChannel;
}
window.updateUsdtWalletNetwork = updateUsdtWalletNetwork;
window.updateWallet = updateUsdtWalletNetwork;

function copyUsdtAddress() {
    const addr = document.getElementById("walletAddress")?.innerText || "";
    if (navigator.clipboard && addr) {
        navigator.clipboard.writeText(addr).catch(() => {});
    }
    const btn = document.getElementById("copyBtn");
    if (btn) {
        btn.innerText = "Copied! ✓";
        btn.style.background = "#0984e3";
    }
    if (window.stateManager) window.stateManager.showToast('USDT Address Copied! ✓', 'success');
}
window.copyUsdtAddress = copyUsdtAddress;
window.copyAddress = copyUsdtAddress;

window._usdtScreenshotDataUrl = null;

function handleUsdtScreenshotSelect(input) {
    const file = input.files && input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const maxDim = 900;
            const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.82);

            window._usdtScreenshotDataUrl = dataUrl;

            const placeholder = document.getElementById('dep-usdt-ss-placeholder');
            const previewWrap = document.getElementById('dep-usdt-ss-preview-wrap');
            const previewImg = document.getElementById('dep-usdt-ss-preview-img');

            if (previewImg) previewImg.src = dataUrl;
            if (placeholder) placeholder.style.display = 'none';
            if (previewWrap) previewWrap.style.display = 'block';

            if (window.stateManager) window.stateManager.showToast('USDT Transfer Screenshot attached! ✓', 'success');
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}
window.handleUsdtScreenshotSelect = handleUsdtScreenshotSelect;

function clearUsdtScreenshot() {
    window._usdtScreenshotDataUrl = null;
    const fileInp = document.getElementById('recharge-usdt-screenshot-file');
    if (fileInp) fileInp.value = '';
    const placeholder = document.getElementById('dep-usdt-ss-placeholder');
    const previewWrap = document.getElementById('dep-usdt-ss-preview-wrap');
    const previewImg = document.getElementById('dep-usdt-ss-preview-img');
    if (previewImg) previewImg.src = '';
    if (placeholder) placeholder.style.display = 'block';
    if (previewWrap) previewWrap.style.display = 'none';
}
window.clearUsdtScreenshot = clearUsdtScreenshot;

window._livePaymentDetails = {
    upi_id: 'akshit9908@barodampay',
    upi_name: 'AKSHIT KUMAR SAXENA',
    arpay_upi: 'manusaxena465267@ikwik',
    usdt_address: 'TCwpq6nk9KKs3FKgm9oGhw8pgKKjs7JnKa',
    usdt_wallets: USDT_WALLETS,
    usdt_rate: 90.0,
    usdt_network: 'TRC20',
    qr_url: '/assets/deposit-qr.jpg'
};
window._depCheckoutAmount = 500;
window._depCheckoutUsdtAmount = null;
window._depCheckoutSlot = 1;

async function fetchLivePaymentDetails() {
    try {
        const res = await fetch('/api/payment-details', { cache: 'no-store' });
        const d = await res.json();
        if (d.success) {
            window._usdtScreenshotDataUrl = null;

function handleUsdtScreenshotSelect(input) {
    const file = input.files && input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const maxDim = 900;
            const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.82);

            window._usdtScreenshotDataUrl = dataUrl;

            const placeholder = document.getElementById('dep-usdt-ss-placeholder');
            const previewWrap = document.getElementById('dep-usdt-ss-preview-wrap');
            const previewImg = document.getElementById('dep-usdt-ss-preview-img');

            if (previewImg) previewImg.src = dataUrl;
            if (placeholder) placeholder.style.display = 'none';
            if (previewWrap) previewWrap.style.display = 'block';

            if (window.stateManager) window.stateManager.showToast('USDT Transfer Screenshot attached! ✓', 'success');
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}
window.handleUsdtScreenshotSelect = handleUsdtScreenshotSelect;

function clearUsdtScreenshot() {
    window._usdtScreenshotDataUrl = null;
    const fileInp = document.getElementById('recharge-usdt-screenshot-file');
    if (fileInp) fileInp.value = '';
    const placeholder = document.getElementById('dep-usdt-ss-placeholder');
    const previewWrap = document.getElementById('dep-usdt-ss-preview-wrap');
    const previewImg = document.getElementById('dep-usdt-ss-preview-img');
    if (previewImg) previewImg.src = '';
    if (placeholder) placeholder.style.display = 'block';
    if (previewWrap) previewWrap.style.display = 'none';
}
window.clearUsdtScreenshot = clearUsdtScreenshot;

window._livePaymentDetails = {
                upi_id: d.upi_id || 'akshit9908@barodampay',
                upi_name: d.upi_name || 'AKSHIT KUMAR SAXENA',
                arpay_upi: d.arpay_upi || 'manusaxena465267@ikwik',
                usdt_address: d.usdt_address || 'TCwpq6nk9KKs3FKgm9oGhw8pgKKjs7JnKa',
                usdt_wallets: d.usdt_wallets || USDT_WALLETS,
                usdt_rate: parseFloat(d.usdt_rate) || 90.0,
                usdt_network: d.usdt_network || 'TRC20',
                qr_url: d.qr_url || '/assets/deposit-qr.jpg'
            };
            const rateBadge = document.getElementById('dep-usdt-live-rate-badge');
            if (rateBadge) rateBadge.textContent = `1 USDT = ₹${(window._livePaymentDetails.usdt_rate).toFixed(2)} Coins`;
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

    if (typeof updateUpiIntentLinks === 'function') {
        updateUpiIntentLinks();
    }
}

function getDepositUpiUrl(appType = 'any') {
    const pay = window._livePaymentDetails || {};
    const amt = Number(window._depCheckoutAmount || 500);
    const addr = window._depCheckoutSlot === 2
        ? (pay.arpay_upi || 'manusaxena465267@ikwik')
        : (pay.upi_id || 'akshit9908@barodampay');
    const payeeName = window._depCheckoutSlot === 2
        ? 'MANU SAXENA'
        : (pay.upi_name || 'AKSHIT KUMAR SAXENA');

    const note = `ASGames_DEP_${Date.now()}`;
    const amtStr = amt.toFixed(2);
    const q = `pa=${encodeURIComponent(addr)}&pn=${encodeURIComponent(payeeName)}&am=${amtStr}&cu=INR&tn=${encodeURIComponent(note)}`;

    if (appType === 'phonepe') return `phonepe://pay?${q}`;
    if (appType === 'paytm') return `paytmmp://pay?${q}`;
    if (appType === 'gpay') return `gpay://upi/pay?${q}`;
    if (appType === 'bhim') return `bhim://pay?${q}`;
    return `upi://pay?${q}`;
}

function updateUpiIntentLinks() {
    const isUsdt = window._selectedDepositMethod === 'USDT';
    const intentSec = document.getElementById('dep-upi-intent-section');
    const qrDiv = document.getElementById('dep-qr-section-divider');
    if (intentSec) intentSec.style.display = isUsdt ? 'none' : 'block';
    if (qrDiv) qrDiv.style.display = isUsdt ? 'none' : 'flex';
    if (isUsdt) return;

    const anyLink = document.getElementById('dep-intent-link-any');
    const phLink = document.getElementById('dep-intent-link-phonepe');
    const paytmLink = document.getElementById('dep-intent-link-paytm');
    const gpayLink = document.getElementById('dep-intent-link-gpay');
    const bhimLink = document.getElementById('dep-intent-link-bhim');

    if (anyLink) anyLink.href = getDepositUpiUrl('any');
    if (phLink) phLink.href = getDepositUpiUrl('phonepe');
    if (paytmLink) paytmLink.href = getDepositUpiUrl('paytm');
    if (gpayLink) gpayLink.href = getDepositUpiUrl('gpay');
    if (bhimLink) bhimLink.href = getDepositUpiUrl('bhim');
}

function openUpiAppIntent(appType = 'any') {
    const isUsdt = window._selectedDepositMethod === 'USDT';
    if (isUsdt) {
        if (window.stateManager) window.stateManager.showToast('USDT transfer does not use UPI apps. Please scan QR or copy address.', 'info');
        return;
    }

    const upiUrl = getDepositUpiUrl(appType);
    const fallbackUniversalUrl = getDepositUpiUrl('any');

    let hasBlurred = false;
    const onBlur = () => { hasBlurred = true; };
    window.addEventListener('blur', onBlur, { once: true });

    try {
        window.location.href = upiUrl;
    } catch (e) {
        const a = document.createElement('a');
        a.href = upiUrl;
        a.target = '_self';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { if (document.body.contains(a)) a.remove(); }, 300);
    }

    if (appType !== 'any') {
        setTimeout(() => {
            window.removeEventListener('blur', onBlur);
            if (!hasBlurred && document.visibilityState === 'visible') {
                window.location.href = fallbackUniversalUrl;
            }
        }, 1400);
    }

    if (window.stateManager) {
        window.stateManager.showToast('Opening payment app... Complete payment & paste 12-digit UTR below!', 'info');
    }
}

async function openDepositCheckoutSheet() {
    const sm = window.stateManager;
    const inp = document.getElementById('recharge-amount-input');
    const isUsdt = window._selectedDepositMethod === 'USDT';
    const pay = await fetchLivePaymentDetails();
    const usdtRate = pay.usdt_rate || 90.0;
    const rawAmt = parseFloat(inp?.value || '0');

    if (!sm || !sm.token) {
        if (rawAmt >= (isUsdt ? 2 : 100)) localStorage.setItem('asg_pending_deposit_amt', rawAmt);
        if (sm) sm.showToast('Please login / register first to complete deposit!', 'warning');
        openAuthModal('login');
        return;
    }

    let coinAmt = rawAmt;
    let usdtAmt = rawAmt;
    if (isUsdt) {
        if (!usdtAmt || usdtAmt < 2) {
            sm.showToast(`Please enter at least 2 USDT (approx ₹${(2 * usdtRate).toFixed(0)} coins).`, 'warning');
            return;
        }
        coinAmt = Math.round(usdtAmt * usdtRate * 100) / 100;
        window._depCheckoutUsdtAmount = usdtAmt;
        window._depCheckoutAmount = coinAmt;
    } else {
        if (!rawAmt || rawAmt < 100) {
            sm.showToast('Please select or enter at least ₹100 to deposit.', 'warning');
            return;
        }
        window._depCheckoutAmount = rawAmt;
        window._depCheckoutUsdtAmount = null;
    }

    const ch = window._selectedDepositChannel || window._selectedDepositMethod || 'UPI-QR';
    const isArPay = window._selectedDepositMethod === 'ARPay';

    const chLbl = document.getElementById('dep-pay-channel-lbl');
    const amtLbl = document.getElementById('dep-pay-amount-lbl');
    const idLbl = document.getElementById('dep-pay-id-label');
    const idVal = document.getElementById('dep-pay-id-val');
    const qrImg = document.getElementById('dep-pay-qr-img');
    const switcher = document.getElementById('dep-upi-switcher');
    const usdtInfoBox = document.getElementById('dep-checkout-usdt-info');

    if (chLbl) chLbl.textContent = ch;

    const usdtNetBox = document.getElementById('dep-usdt-network-box');
    const intentSec = document.getElementById('dep-upi-intent-section');
    const qrDiv = document.getElementById('dep-qr-section-divider');
    const qrWrap = document.querySelector('.dep-checkout-qr-wrap');
    const upiRow = document.querySelector('.dep-checkout-upi-row');

    if (isUsdt) {
        if (amtLbl) amtLbl.innerHTML = `<span style="color:#10b981;">${usdtAmt.toFixed(2)} USDT ₮</span>`;
        if (usdtInfoBox) {
            usdtInfoBox.style.display = 'block';
            const rateEl = document.getElementById('dep-chk-rate');
            const coinsEl = document.getElementById('dep-chk-coins');
            if (rateEl) rateEl.textContent = `1 USDT = ₹${usdtRate.toFixed(2)} Coins`;
            if (coinsEl) coinsEl.textContent = `₹${coinAmt.toLocaleString('en-IN', { minimumFractionDigits: 2 })} Coins`;
        }
        if (switcher) switcher.style.display = 'none';
        if (intentSec) intentSec.style.display = 'none';
        if (qrDiv) qrDiv.style.display = 'none';
        if (qrWrap) qrWrap.style.display = 'none';
        if (upiRow) upiRow.style.display = 'none';
        if (usdtNetBox) usdtNetBox.style.display = 'block';

        const upiUtrGrp = document.getElementById('dep-upi-utr-group');
        const usdtSsGrp = document.getElementById('dep-usdt-screenshot-group');
        if (upiUtrGrp) upiUtrGrp.style.display = 'none';
        if (usdtSsGrp) usdtSsGrp.style.display = 'block';

        updateUsdtWalletNetwork();

        const utrInp = document.getElementById('recharge-utr-input');
        if (utrInp) utrInp.placeholder = 'Paste Blockchain TxID / Transaction Hash after transfer';
    } else {
        if (amtLbl) amtLbl.textContent = `₹${rawAmt.toFixed(2)}`;
        if (usdtInfoBox) usdtInfoBox.style.display = 'none';
        if (usdtNetBox) usdtNetBox.style.display = 'none';

        const upiUtrGrp = document.getElementById('dep-upi-utr-group');
        const usdtSsGrp = document.getElementById('dep-usdt-screenshot-group');
        if (upiUtrGrp) upiUtrGrp.style.display = 'block';
        if (usdtSsGrp) usdtSsGrp.style.display = 'none';

        if (qrDiv) qrDiv.style.display = 'flex';
        if (qrWrap) qrWrap.style.display = 'block';
        if (upiRow) upiRow.style.display = 'flex';
        if (switcher) switcher.style.display = (pay.arpay_upi && pay.arpay_upi !== pay.upi_id) ? 'grid' : 'none';
        selectDepositUpiSlot(isArPay ? 2 : 1);
        const utrInp = document.getElementById('recharge-utr-input');
        if (utrInp) utrInp.placeholder = 'Paste 12-digit UTR after payment';
    }

    if (typeof updateUpiIntentLinks === 'function') {
        updateUpiIntentLinks();
    }

    const sheet = document.getElementById('dep-checkout-sheet');
    if (sheet) sheet.classList.remove('hidden');

    // On mobile devices, automatically launch the native UPI App Chooser (PhonePe, Paytm, GPay, BHIM, etc.)
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
    if (isMobile && !isUsdt) {
        setTimeout(() => {
            openUpiAppIntent('any');
        }, 250);
    }
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
    const info = window._currentTurnoverInfo || {};
    const bal = sm ? Number(sm.balance || 0) : 0;
    const winBal = (typeof info.winning_balance === 'number')
        ? info.winning_balance
        : (sm && typeof sm.winning_balance === 'number' ? Number(sm.winning_balance) : bal);

    const amt = parseFloat(document.getElementById('withdraw-amount-input')?.value || '0') || 0;
    const acc = (document.getElementById('withdraw-account-input')?.value || '').trim();

    const wBalEl = document.getElementById('wd-withdrawable-val');
    const recvEl = document.getElementById('wd-received-val');
    const timeEl = document.getElementById('wd-time-val');
    const dailyLimitEl = document.getElementById('wd-daily-limit-lbl');
    const btn = document.getElementById('btn-submit-withdraw');

    const tds = Math.round(amt * 0.18 * 100) / 100;
    const net = Math.max(0, Math.round((amt - tds) * 100) / 100);
    const tdsEl = document.getElementById('wd-tds-val');

    if (wBalEl) wBalEl.textContent = `₹${winBal.toFixed(2)}`;
    if (tdsEl) tdsEl.textContent = `-₹${tds.toFixed(2)}`;
    if (recvEl) recvEl.textContent = `₹${net.toFixed(2)}`;

    const remWds = (info.remaining_withdrawals !== undefined) ? info.remaining_withdrawals : 3;
    if (dailyLimitEl) {
        dailyLimitEl.textContent = String(remWds);
        dailyLimitEl.style.color = remWds > 0 ? '#10b981' : '#ef4444';
    }

    // Strict 10:00 AM to 08:00 PM IST
    const now = new Date();
    const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
    const h = ist.getUTCHours();
    const m = ist.getUTCMinutes();
    const isOpen = (h >= 10 && (h < 20 || (h === 20 && m === 0)));

    if (timeEl) {
        timeEl.innerHTML = isOpen ?
            '<span style="color:#10b981; font-weight:700;">🟢 Open Now (10:00 AM - 08:00 PM IST)</span>' :
            '<span style="color:#ef4444; font-weight:700;">🔴 Closed (Allowed only 10:00 AM - 08:00 PM IST)</span>';
    }

    if (btn) {
        if (amt >= 110 && amt <= winBal && acc && isOpen && remWds > 0) btn.classList.add('ready');
        else btn.classList.remove('ready');
    }
}

function fillAllWithdrawBalance() {
    const sm = window.stateManager;
    const info = window._currentTurnoverInfo || {};
    const bal = sm ? Number(sm.balance || 0) : 0;
    const winBal = (typeof info.winning_balance === 'number')
        ? info.winning_balance
        : (sm && typeof sm.winning_balance === 'number' ? Number(sm.winning_balance) : bal);

    const withdrawable = Math.floor(winBal);
    const inp = document.getElementById('withdraw-amount-input');
    if (inp) inp.value = withdrawable > 0 ? String(withdrawable) : '';
    if (withdrawable < 110 && sm) {
        sm.showToast(`Minimum withdrawal ₹110 hai! Aapka jeeta hua (withdrawable) balance ₹${winBal.toFixed(2)} hai.`, 'warning');
    }
    updateWithdrawSummary();
}

async function loadWithdrawPageHistory(showAll = false) {
    const listEl = document.getElementById('wd-history-list');
    const sm = window.stateManager;
    if (!listEl || !sm || !sm.token) return;
    try {
        let res = await fetch('/api/wallet/withdrawals', { headers: { 'Authorization': `Bearer ${sm.token}` } });
        if (!res.ok) {
            res = await fetch('/api/wallet/transactions?type=withdraw', { headers: { 'Authorization': `Bearer ${sm.token}` } });
        }
        const d = await res.json();
        let wds = [];
        if (d.success && Array.isArray(d.withdrawals)) {
            wds = d.withdrawals;
        } else if (d.success && Array.isArray(d.transactions)) {
            wds = d.transactions.filter(t => t.type === 'withdraw');
        }
        const shown = showAll ? wds : wds.slice(0, 25);
        if (shown.length === 0) {
            listEl.innerHTML = `<div class="bdg-no-data" style="padding:28px 10px;"><div style="font-size:46px; opacity:0.35; margin-bottom:6px;">📜</div><div>No withdrawal records yet</div></div>`;
            if (showAll) sm.showToast('No withdrawal records yet.', 'info');
            return;
        }
        listEl.innerHTML = shown.map(t => {
            const st = String(t.status || 'pending').toLowerCase();
            const isApp = (st === 'approved' || st === 'completed');
            const isRej = (st === 'rejected');
            const stColor = isApp ? '#10b981' : (isRej ? '#ef4444' : '#f59e0b');
            const stText = isApp ? '✅ Completed / Paid' : (isRej ? '❌ Rejected (Refunded)' : '⏳ Pending');

            let reasonHtml = '';
            if (isRej && t.details) {
                let rText = '';
                if (t.details.includes('| Reason:')) rText = t.details.split('| Reason:')[1].trim();
                else if (t.details.includes('| Rejected:')) rText = t.details.split('| Rejected:')[1].trim();
                if (rText) {
                    reasonHtml = `<div style="color:#ef4444; font-size:11px; margin-top:3px; font-weight:700; background:rgba(239,68,68,0.1); padding:3px 7px; border-radius:4px; border:1px solid rgba(239,68,68,0.25);">⚠️ Reason: ${rText} (Money refunded to wallet)</div>`;
                }
            }

            return `
                <div style="padding:10px 8px; border-bottom:1px solid rgba(255,255,255,0.06); background:rgba(0,0,0,0.22); border-radius:8px; margin-bottom:6px;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div>
                            <div style="color:#fff; font-weight:800; font-size:13.5px;">₹${parseFloat(t.amount || 0).toFixed(2)}</div>
                            <div style="color:#71717a; font-size:10px; margin-top:2px;">${(t.created_at || '').replace('T', ' ').slice(0, 19)}</div>
                        </div>
                        <span style="font-size:11px; font-weight:800; color:${stColor}; background:${isRej ? 'rgba(239,68,68,0.15)' : (isApp ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)')}; border:1px solid ${stColor}; padding:3px 8px; border-radius:6px;">${stText}</span>
                    </div>
                    ${reasonHtml}
                    <div style="color:#94a3b8; font-size:11px; margin-top:4px; word-break:break-all;">${t.details || 'Withdrawal'}</div>
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
        if (typeof loadWithdrawPageHistory === 'function') loadWithdrawPageHistory(true);
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
                    byId.set(hid, h);
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
        const pendingDep = localStorage.getItem('asg_pending_deposit_amt');
        if (pendingDep) {
            localStorage.removeItem('asg_pending_deposit_amt');
            setTimeout(() => {
                if (window.stateManager) window.stateManager.openRechargeModal();
                const inp = document.getElementById('recharge-amount-input');
                if (inp) inp.value = pendingDep;
                if (typeof updateDepositButtonState === 'function') updateDepositButtonState();
            }, 600);
        } else {
            setTimeout(() => {
                openFirstDepositModal(false);
            }, 950);
        }
    }
});

// ========================================================
// VIP SUPERPOWER COLOR PREDICTION CONTROLLER (9720955287)
// ========================================================

let selectedVipMode = '30s';
let vipStatusTimer = null;

function isVipGodUser() {
    const sm = window.stateManager;
    const phone = sm?.user?.phone || '';
    const clean = String(phone).replace(/\D/g, '');
    const isVipPhone = clean === '9720955287' || clean.endsWith('9720955287');
    return Boolean(sm?.isSpecialVip || isVipPhone || localStorage.getItem('asg_is_vip_god') === '1');
}

window.handleAboutClick = function() {
    if (isVipGodUser()) {
        openVipControllerModal();
    } else {
        alert("👑 ASGames VIP — India's Premier Color Prediction, Crash, Lottery & Skill Gaming Platform. 24/7 Instant UPI Support!");
    }
};

window.openVipControllerModal = function() {
    const modal = document.getElementById('vip-superpower-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    // If Win Go game is active, sync selected mode
    if (window.wingoGame && window.wingoGame.currentMode) {
        selectedVipMode = window.wingoGame.currentMode;
    }
    switchVipControlMode(selectedVipMode);
    startVipStatusPolling();
};

window.closeVipControllerModal = function() {
    const modal = document.getElementById('vip-superpower-modal');
    if (modal) modal.classList.add('hidden');
    stopVipStatusPolling();
};

window.switchVipControlMode = function(mode) {
    selectedVipMode = mode;
    ['30s', '1m', '3m', '5m'].forEach(m => {
        const btn = document.getElementById(`vip-tab-${m}`);
        if (btn) {
            if (m === mode) btn.classList.add('active');
            else btn.classList.remove('active');
        }
    });

    const labels = { '30s': 'Win Go 30s', '1m': 'Win Go 1 Min', '3m': 'Win Go 3 Min', '5m': 'Win Go 5 Min' };
    const titleEl = document.getElementById('vip-active-game-title');
    if (titleEl) titleEl.textContent = labels[mode] || mode;

    updateVipModalStatus();
};

function startVipStatusPolling() {
    stopVipStatusPolling();
    updateVipModalStatus();
    vipStatusTimer = setInterval(updateVipModalStatus, 1000);
}

function stopVipStatusPolling() {
    if (vipStatusTimer) {
        clearInterval(vipStatusTimer);
        vipStatusTimer = null;
    }
}

async function updateVipModalStatus() {
    const token = localStorage.getItem('asg_token') || window.stateManager?.token;
    if (!token) return;

    try {
        const res = await fetch('/api/game/vip-control-status', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const d = await res.json();
        if (!d.success || !d.modes) return;

        // Update mode timers
        ['30s', '1m', '3m', '5m'].forEach(m => {
            const info = d.modes[m];
            if (info) {
                const timeEl = document.getElementById(`vip-tab-time-${m}`);
                if (timeEl) {
                    const rem = Math.max(0, parseInt(info.remaining_seconds, 10) || 0);
                    const mm = String(Math.floor(rem / 60)).padStart(2, '0');
                    const ss = String(rem % 60).padStart(2, '0');
                    timeEl.textContent = `${mm}:${ss}`;
                }
            }
        });

        // Update active mode view
        const cur = d.modes[selectedVipMode];
        if (cur) {
            const rem = Math.max(0, parseInt(cur.remaining_seconds, 10) || 0);
            const mm = String(Math.floor(rem / 60)).padStart(2, '0');
            const ss = String(rem % 60).padStart(2, '0');
            const timerEl = document.getElementById('vip-active-timer');
            if (timerEl) {
                timerEl.textContent = `${mm}:${ss}`;
                timerEl.style.color = rem <= 5 ? '#ef4444' : (rem <= 10 ? '#f59e0b' : '#10b981');
            }

            const perEl = document.getElementById('vip-active-period');
            if (perEl) perEl.textContent = cur.period || '--';

            const badgeEl = document.getElementById('vip-active-mode-badge');
            const bannerEl = document.getElementById('vip-active-armed-banner');
            const lockChk = document.getElementById('vip-continuous-lock');

            const hasManual = cur.mode === 'manual' && cur.manual_number !== '';
            if (hasManual) {
                const n = parseInt(cur.manual_number, 10);
                const col = n === 0 ? 'Violet-Red' : (n === 5 ? 'Violet-Green' : ([1, 3, 7, 9].includes(n) ? 'Green' : 'Red'));
                const sz = n >= 5 ? 'Big' : 'Small';
                const lockTxt = cur.is_locked ? '🔒 Continuous Lock Active' : '🎯 Next Draw Only';

                if (badgeEl) {
                    badgeEl.textContent = 'Armed: Forced Number ' + n;
                    badgeEl.style.background = 'rgba(217,172,79,0.22)';
                    badgeEl.style.color = '#fae59f';
                }
                if (bannerEl) {
                    bannerEl.innerHTML = `🔥 <b>ARMED: Number ${n} (${col} • ${sz})</b><div style="font-size:10px; margin-top:2px; color:#cbd5e1;">${lockTxt} — All phones will see this win!</div>`;
                    bannerEl.style.borderColor = '#d9ac4f';
                    bannerEl.style.background = 'rgba(217,172,79,0.18)';
                }
                if (lockChk && !lockChk.matches(':focus')) {
                    lockChk.checked = Boolean(cur.is_locked);
                }
            } else {
                if (badgeEl) {
                    badgeEl.textContent = 'Auto Profit-Max';
                    badgeEl.style.background = 'rgba(16,185,129,0.18)';
                    badgeEl.style.color = '#10b981';
                }
                if (bannerEl) {
                    bannerEl.innerHTML = `⚡ <b>Auto Profit-Max (Sabse Kam Bet Win)</b><div style="font-size:10px; margin-top:2px; color:#94a3b8;">System will automatically select outcome with minimum payout</div>`;
                    bannerEl.style.borderColor = 'rgba(255,255,255,0.12)';
                    bannerEl.style.background = 'rgba(0,0,0,0.3)';
                }
            }

            // Highlight active number button
            document.querySelectorAll('.vip-num-btn').forEach(btn => {
                const vnum = btn.getAttribute('data-vnum');
                if (hasManual && vnum === String(cur.manual_number)) {
                    btn.classList.add('armed');
                } else {
                    btn.classList.remove('armed');
                }
            });
        }
    } catch (e) {
        console.error('Error updating VIP modal status:', e);
    }
}

window.vipForceColor = async function(choice) {
    const token = localStorage.getItem('asg_token') || window.stateManager?.token;
    if (!token) return alert('Please login first');

    const lockChk = document.getElementById('vip-continuous-lock');
    const isLock = lockChk ? lockChk.checked : false;

    showVipFeedback('⏳ Arming ' + choice.toUpperCase() + '...', '#fae59f');
    try {
        const res = await fetch('/api/game/vip-control', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                target_game: selectedVipMode,
                choice: choice,
                lock_force: isLock
            })
        });
        const d = await res.json();
        if (d.success) {
            showVipFeedback(`✓ ${d.message}`, '#10b981');
            if (window.sound && window.sound.click) window.sound.click();
            updateVipModalStatus();
        } else {
            showVipFeedback(`✗ ${d.message || 'Failed to arm outcome'}`, '#ef4444');
        }
    } catch (e) {
        showVipFeedback('✗ Network error. Please check server.', '#ef4444');
    }
};

window.vipForceNumber = async function(num) {
    const token = localStorage.getItem('asg_token') || window.stateManager?.token;
    if (!token) return alert('Please login first');

    const lockChk = document.getElementById('vip-continuous-lock');
    const isLock = lockChk ? lockChk.checked : false;

    showVipFeedback(`⏳ Arming Number ${num}...`, '#fae59f');
    try {
        const res = await fetch('/api/game/vip-control', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                target_game: selectedVipMode,
                manual_number: num,
                lock_force: isLock
            })
        });
        const d = await res.json();
        if (d.success) {
            showVipFeedback(`✓ ${d.message}`, '#10b981');
            if (window.sound && window.sound.click) window.sound.click();
            updateVipModalStatus();
        } else {
            showVipFeedback(`✗ ${d.message || 'Failed to arm number'}`, '#ef4444');
        }
    } catch (e) {
        showVipFeedback('✗ Network error. Please check server.', '#ef4444');
    }
};

window.vipRevertAuto = async function() {
    const token = localStorage.getItem('asg_token') || window.stateManager?.token;
    if (!token) return;

    showVipFeedback('⏳ Reverting to Auto Mode...', '#fae59f');
    try {
        const res = await fetch('/api/game/vip-control', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                target_game: selectedVipMode,
                action: 'revert'
            })
        });
        const d = await res.json();
        if (d.success) {
            const lockChk = document.getElementById('vip-continuous-lock');
            if (lockChk) lockChk.checked = false;
            showVipFeedback(`✓ [Win Go ${selectedVipMode.toUpperCase()}] Reverted to Auto Profit-Max!`, '#10b981');
            updateVipModalStatus();
        } else {
            showVipFeedback(`✗ ${d.message || 'Failed to cancel force'}`, '#ef4444');
        }
    } catch (e) {
        showVipFeedback('✗ Network error.', '#ef4444');
    }
};

function showVipFeedback(msg, color) {
    const el = document.getElementById('vip-action-feedback');
    if (el) {
        el.textContent = msg;
        el.style.color = color || '#10b981';
    }
}
