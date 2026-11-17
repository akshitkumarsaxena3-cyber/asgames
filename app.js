// ASGames Full-Stack Application Controller & State Manager

class StateManager {
    constructor() {
        this.token = localStorage.getItem('asg_token') || null;
        this.user = null;
        this.balance = parseFloat(localStorage.getItem('asg_balance')) || 100.00;
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
        const ref = searchParams.get('r') || searchParams.get('invitationCode') || hashParams.get('invitationCode') || hashParams.get('r');

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
                this.uid = data.user.id;
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
        if (!authBtn) return;

        if (isLoggedIn && this.user) {
            const maskedPhone = this.user.phone.replace(/(\d{3})\d{4}(\d{3})/, '$1****$2');
            authBtn.textContent = `📱 ${maskedPhone} (Logout)`;
            authBtn.onclick = () => {
                if (confirm('Do you want to log out?')) {
                    localStorage.removeItem('asg_token');
                    location.reload();
                }
            };
        } else {
            authBtn.textContent = 'Login / Register';
            authBtn.onclick = () => openAuthModal();
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

    addBalance(amount, desc) {
        this.balance += amount;
        localStorage.setItem('asg_balance', this.balance);
        this.updateBalanceUI('up');
        this.syncGameDelta(amount);
    }

    deductBalance(amount, desc) {
        this.balance = Math.max(0, this.balance - amount);
        localStorage.setItem('asg_balance', this.balance);
        this.updateBalanceUI('down');
        this.syncGameDelta(-amount);
    }

    saveUserBet(bet) {
        this.userBets.unshift(bet);
        this.renderAccountTab();
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
        // Tab switching
        document.querySelectorAll('.tabbar-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const tab = item.dataset.tab;
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
                        body: JSON.stringify({ amount: amt, utr, channel: 'UPI' })
                    });
                    const d = await res.json();
                    if (d.success) {
                        this.showToast('Deposit submitted! Waiting for admin approval.', 'success');
                        this.closeRechargeModal();
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
                if (!this.token) {
                    this.showToast('Please login first to withdraw funds!', 'warning');
                    openAuthModal();
                    return;
                }
                const amtInput = document.getElementById('withdraw-amount-input');
                const accInput = document.getElementById('withdraw-account-input');
                const amt = parseFloat(amtInput ? amtInput.value : 0);
                const account = accInput ? accInput.value.trim() : '';

                if (!amt || amt < 110) {
                    this.showToast('Minimum withdrawal is ₹110', 'warning');
                    return;
                }
                if (amt > this.balance) {
                    this.showToast('Insufficient wallet balance!', 'error');
                    return;
                }
                if (!account) {
                    this.showToast('Please enter your UPI ID or Bank Account', 'warning');
                    return;
                }

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
                        this.showToast('Withdrawal submitted! Admin will verify and process.', 'success');
                        this.closeWithdrawModal();
                        this.fetchUserProfile();
                    } else {
                        this.showToast(d.message, 'error');
                    }
                } catch (e) {
                    this.showToast('Error submitting withdrawal', 'error');
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

        const targetView = document.getElementById(`tab-${tabName}`);
        if (targetView) targetView.classList.remove('hidden');

        if (tabName === 'home') {
            const homeMain = document.getElementById('home-main-content');
            if (homeMain) homeMain.classList.remove('hidden');
        }

        if (tabName === 'activity') this.renderActivityTab();
        if (tabName === 'promotion') this.renderPromotionTab();
        if (tabName === 'account') this.renderAccountTab();
        if (tabName === 'wallet') this.renderTransactions();
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

    openGameView(gameName) {
        const labels = {
            wingo: 'Loading Win Go Live Arena...',
            aviator: 'Connecting Aviator Flight Radar...',
            mines: 'Preparing 5x5 Diamond Vault...',
            k3: 'Warming Up K3 Dice Table...',
            ludo: 'Loading Ludo Supreme Cash Board...'
        };
        this.showSplashLoader(labels[gameName] || 'Loading Game Engine...', 420);

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
        if (window.sound) window.sound.click();
    }

    closeRechargeModal() {
        const modal = document.getElementById('recharge-modal');
        if (modal) modal.classList.add('hidden');
    }

    openWithdrawModal() {
        const modal = document.getElementById('withdraw-modal');
        if (modal) modal.classList.remove('hidden');
        if (window.sound) window.sound.click();
    }

    closeWithdrawModal() {
        const modal = document.getElementById('withdraw-modal');
        if (modal) modal.classList.add('hidden');
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
        const uidEl = document.getElementById('promo-uid');
        const codeEl = document.getElementById('promo-code');
        const linkEl = document.getElementById('promo-link');
        const claimBtn = document.getElementById('btn-claim-commission');
        const subList = document.getElementById('subordinates-list');

        const currentOrigin = window.location.origin;
        const link = `${currentOrigin}/?r=${this.inviteCode}`;

        if (uidEl) uidEl.textContent = this.uid;
        if (codeEl) codeEl.textContent = this.inviteCode;
        if (linkEl) linkEl.value = link;

        const copyBtn = document.getElementById('btn-copy-promo');
        if (copyBtn) {
            copyBtn.onclick = () => {
                navigator.clipboard.writeText(link).then(() => {
                    this.showToast('Invitation link copied to clipboard!', 'success');
                }).catch(() => {
                    this.showToast(`Code: ${this.inviteCode}`, 'success');
                });
            };
        }

        // Fetch live referral stats from server
        if (this.token) {
            try {
                const res = await fetch('/api/referral/stats', {
                    headers: { 'Authorization': `Bearer ${this.token}` }
                });
                const d = await res.json();
                if (d.success) {
                    if (claimBtn) {
                        claimBtn.textContent = `CLAIM ₹${d.unclaimedCommission.toFixed(2)}`;
                        claimBtn.disabled = d.unclaimedCommission <= 0;
                        claimBtn.onclick = async () => {
                            const cRes = await fetch('/api/referral/claim', {
                                method: 'POST',
                                headers: { 'Authorization': `Bearer ${this.token}` }
                            });
                            const cd = await cRes.json();
                            if (cd.success) {
                                this.showToast(cd.message, 'success');
                                this.fetchUserProfile();
                                this.renderPromotionTab();
                            } else {
                                this.showToast(cd.message, 'info');
                            }
                        };
                    }

                    if (subList) {
                        if (d.subordinates && d.subordinates.length > 0) {
                            subList.innerHTML = d.subordinates.map(s => `
                                <div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid rgba(255,255,255,0.05);">
                                    <span>📱 ${s.phone}</span>
                                    <span style="color:#94a3b8; font-size:10px;">${s.date}</span>
                                </div>
                            `).join('');
                        } else {
                            subList.innerHTML = `<p style="color:#94a3b8;">No subordinates registered yet. Share your invite link to build your team!</p>`;
                        }
                    }
                }
            } catch (e) {}
        }
    }

    renderAccountTab() {
        const uidEl = document.getElementById('account-uid');
        if (uidEl) uidEl.textContent = this.uid;

        const countEl = document.getElementById('stat-total-bets');
        const rateEl = document.getElementById('stat-win-rate');
        const wonEl = document.getElementById('stat-total-won');

        if (countEl) countEl.textContent = this.userBets.length;
        if (rateEl) rateEl.textContent = '52%';
        if (wonEl) wonEl.textContent = `₹${this.balance.toFixed(0)}`;
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
        fdb_no_remind: 'No more reminders today'
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
        fdb_no_remind: 'आज दोबारा न दिखाएं'
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

    // Update all language pills across header & auth screen
    document.querySelectorAll('.lang-flag').forEach(el => {
        el.textContent = currentLang === 'hi' ? '🇮🇳' : '🇺🇸';
    });
    document.querySelectorAll('.lang-code').forEach(el => {
        el.textContent = currentLang === 'hi' ? 'हिंदी' : 'EN';
    });

    // Update Auth Subheader title according to active tab
    const title = document.getElementById('auth-modal-title');
    if (title) {
        if (currentAuthView === 'login') title.textContent = dict.login_title;
        else if (currentAuthView === 'forgot') title.textContent = dict.forgot_title;
        else title.textContent = dict.reg_title;
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

async function submitForgotPassword() {
    const phone = (document.getElementById('forgot-phone')?.value || '').trim();
    const newPass = (document.getElementById('forgot-password')?.value || '').trim();
    const confirmPass = (document.getElementById('forgot-password-confirm')?.value || '').trim();

    if (!phone || phone.length < 10) {
        alert('Please enter a valid 10-digit registered mobile number.');
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
            body: JSON.stringify({ phone, new_password: newPass })
        });
        const d = await res.json();
        if (d.success) {
            alert('Password reset successfully! Please log in with your new password.');
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
        alert('Please enter your mobile number and password');
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
    const password = (document.getElementById('reg-password')?.value || '').trim();
    const confirmPassword = (document.getElementById('reg-password-confirm')?.value || '').trim();
    const invite = (document.getElementById('reg-invite')?.value || '').trim();
    const agree = document.getElementById('reg-agree');

    if (!phone || phone.length < 10) {
        alert(currentLang === 'hi' ? 'कृपया 10 अंकों का सही मोबाइल नंबर डालें' : 'Please enter a valid 10-digit mobile number');
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
            body: JSON.stringify({ phone, password, invite_code: invite })
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
    }
}

function goFdbActivity() {
    closeFirstDepositModal();
    if (window.stateManager) {
        window.stateManager.switchTab('activity');
    }
}

// Global initialization
window.addEventListener('DOMContentLoaded', () => {
    window.stateManager = new StateManager();
    applyLanguage(currentLang);
    window.stateManager.showSplashLoader('Loading ASGames VIP...', 850);

    // Automatically show Extra First Deposit Bonus modal right after login!
    if (localStorage.getItem('asg_token')) {
        setTimeout(() => {
            openFirstDepositModal(false);
        }, 950);
    }
});
