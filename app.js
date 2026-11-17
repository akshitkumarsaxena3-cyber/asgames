// ASGames Application Controller & State Manager

class StateManager {
    constructor() {
        this.balance = parseFloat(localStorage.getItem('asg_balance')) || 1000.00;
        this.uid = localStorage.getItem('asg_uid') || Math.floor(100000 + Math.random() * 900000);
        this.vipLevel = 3;
        this.transactions = JSON.parse(localStorage.getItem('asg_tx')) || [];
        this.userBets = JSON.parse(localStorage.getItem('asg_bets')) || [];
        this.checkinDay = parseInt(localStorage.getItem('asg_checkin_day')) || 1;
        this.lastCheckinDate = localStorage.getItem('asg_checkin_date') || '';
        this.hasFreeSpin = localStorage.getItem('asg_free_spin') !== '0';

        this.currentTab = 'home';
        this.currentGame = 'wingo'; // 'home', 'wingo', 'aviator', 'mines', 'k3'

        // Save UID
        localStorage.setItem('asg_uid', this.uid);

        this.init();
    }

    init() {
        this.updateBalanceUI();
        this.setupEventListeners();
        this.startWinningTicker();
        this.initGames();
        this.renderActivityTab();
        this.renderPromotionTab();
        this.renderAccountTab();
        this.renderTransactions();
    }

    saveState() {
        localStorage.setItem('asg_balance', this.balance.toFixed(2));
        localStorage.setItem('asg_tx', JSON.stringify(this.transactions.slice(0, 50)));
        localStorage.setItem('asg_bets', JSON.stringify(this.userBets.slice(0, 50)));
    }

    updateBalanceUI() {
        const balEls = document.querySelectorAll('.user-balance-val');
        balEls.forEach(el => {
            el.textContent = `₹${this.balance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        });
    }

    addBalance(amount, desc) {
        this.balance += amount;
        this.transactions.unshift({
            id: 'TX' + Date.now(),
            type: 'Credit',
            desc: desc,
            amount: amount,
            time: new Date().toLocaleTimeString(),
            date: new Date().toLocaleDateString()
        });
        this.saveState();
        this.updateBalanceUI();
        this.renderAccountTab();
        this.renderTransactions();
    }

    deductBalance(amount, desc) {
        this.balance = Math.max(0, this.balance - amount);
        this.transactions.unshift({
            id: 'TX' + Date.now(),
            type: 'Debit',
            desc: desc,
            amount: amount,
            time: new Date().toLocaleTimeString(),
            date: new Date().toLocaleDateString()
        });
        this.saveState();
        this.updateBalanceUI();
        this.renderAccountTab();
        this.renderTransactions();
    }

    saveUserBet(bet) {
        this.userBets.unshift(bet);
        this.saveState();
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
            refreshBtn.addEventListener('click', () => {
                refreshBtn.classList.add('spin-anim');
                if (window.sound) window.sound.click();
                setTimeout(() => {
                    this.updateBalanceUI();
                    refreshBtn.classList.remove('spin-anim');
                    this.showToast('Balance updated successfully!', 'success');
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

        // Recharge modal open/close
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

        // Submit Recharge (Instant Demo Credit)
        const submitRechargeBtn = document.getElementById('btn-submit-recharge');
        if (submitRechargeBtn) {
            submitRechargeBtn.addEventListener('click', () => {
                const input = document.getElementById('recharge-amount-input');
                const amt = parseFloat(input ? input.value : 0);
                if (!amt || amt < 100) {
                    this.showToast('Minimum deposit amount is ₹100', 'warning');
                    return;
                }
                this.addBalance(amt, 'Recharge via UPI Pay');
                if (window.sound) window.sound.win();
                this.showToast(`Recharge of ₹${amt} successful!`, 'success');
                this.closeRechargeModal();
            });
        }

        // Submit Withdraw
        const submitWithdrawBtn = document.getElementById('btn-submit-withdraw');
        if (submitWithdrawBtn) {
            submitWithdrawBtn.addEventListener('click', () => {
                const input = document.getElementById('withdraw-amount-input');
                const amt = parseFloat(input ? input.value : 0);
                if (!amt || amt < 110) {
                    this.showToast('Minimum withdrawal is ₹110', 'warning');
                    return;
                }
                if (amt > this.balance) {
                    this.showToast('Insufficient wallet balance!', 'error');
                    return;
                }
                this.deductBalance(amt, 'Withdrawal to Bank/UPI');
                this.showToast(`Withdrawal of ₹${amt} submitted! Processing (1-24h).`, 'success');
                this.closeWithdrawModal();
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

        // Game card clicks -> open specific game view
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

        // Update tabbar items
        document.querySelectorAll('.tabbar-item').forEach(item => {
            if (item.dataset.tab === tabName) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });

        // Hide all main tab views and game views
        document.querySelectorAll('.tab-view').forEach(view => view.classList.add('hidden'));
        document.querySelectorAll('.game-view').forEach(view => view.classList.add('hidden'));

        // Show target tab
        const targetView = document.getElementById(`tab-${tabName}`);
        if (targetView) {
            targetView.classList.remove('hidden');
        }

        // If switching to home, ensure game cards visible
        if (tabName === 'home') {
            const homeMain = document.getElementById('home-main-content');
            if (homeMain) homeMain.classList.remove('hidden');
        }

        // Refresh views
        if (tabName === 'activity') this.renderActivityTab();
        if (tabName === 'promotion') this.renderPromotionTab();
        if (tabName === 'account') this.renderAccountTab();
        if (tabName === 'wallet') this.renderTransactions();
    }

    openGameView(gameName) {
        // Hide home main content
        const homeMain = document.getElementById('home-main-content');
        if (homeMain) homeMain.classList.add('hidden');

        // Hide all other game views
        document.querySelectorAll('.game-view').forEach(view => view.classList.add('hidden'));

        // Show target game view
        const gameView = document.getElementById(`game-view-${gameName}`);
        if (gameView) {
            gameView.classList.remove('hidden');
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        // Trigger resize if aviator
        if (gameName === 'aviator' && window.aviatorGame) {
            setTimeout(() => window.aviatorGame.resizeCanvas(), 50);
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
            { name: 'Mem***VUN', amount: 4200, game: 'Win Go 1Min' },
            { name: 'Mem***DHD', amount: 8900, game: '5D Lottery' },
            { name: 'Pra*** ji', amount: 3340, game: 'Win Go 30s' },
            { name: 'Mem***ZQY', amount: 7120, game: 'Aviator' }
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
            if (ticker.children.length > 5) {
                ticker.lastElementChild.remove();
            }
            index++;
        }, 2200);
    }

    renderActivityTab() {
        // Daily Check-in rewards
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

        // Daily Check-in Button
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

        // Lucky Wheel Spin setup
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

    renderPromotionTab() {
        const uidEl = document.getElementById('promo-uid');
        const codeEl = document.getElementById('promo-code');
        const linkEl = document.getElementById('promo-link');

        const code = `ASG${this.uid}`;
        const link = `https://asgames.live/#/register?invitationCode=${code}`;

        if (uidEl) uidEl.textContent = this.uid;
        if (codeEl) codeEl.textContent = code;
        if (linkEl) linkEl.value = link;

        const copyBtn = document.getElementById('btn-copy-promo');
        if (copyBtn) {
            copyBtn.onclick = () => {
                navigator.clipboard.writeText(link).then(() => {
                    this.showToast('Invitation link copied to clipboard!', 'success');
                }).catch(() => {
                    this.showToast(`Code: ${code}`, 'success');
                });
            };
        }

        const claimCommissionBtn = document.getElementById('btn-claim-commission');
        if (claimCommissionBtn) {
            claimCommissionBtn.onclick = () => {
                const commission = 345.50;
                this.addBalance(commission, 'Agent Referral Commission');
                if (window.sound) window.sound.win();
                this.showToast(`Claimed ₹${commission} referral bonus!`, 'success');
                claimCommissionBtn.disabled = true;
                claimCommissionBtn.textContent = 'Commission Claimed ✓';
            };
        }
    }

    renderAccountTab() {
        const uidEl = document.getElementById('account-uid');
        if (uidEl) uidEl.textContent = this.uid;

        // Statistics
        const totalBetsCount = this.userBets.length;
        const wonBets = this.userBets.filter(b => b.status === 'Won');
        const winRate = totalBetsCount > 0 ? Math.round((wonBets.length / totalBetsCount) * 100) : 0;
        const totalWon = wonBets.reduce((acc, b) => acc + (b.winAmount || 0), 0);

        const countEl = document.getElementById('stat-total-bets');
        const rateEl = document.getElementById('stat-win-rate');
        const wonEl = document.getElementById('stat-total-won');

        if (countEl) countEl.textContent = totalBetsCount;
        if (rateEl) rateEl.textContent = `${winRate}%`;
        if (wonEl) wonEl.textContent = `₹${totalWon.toLocaleString('en-IN')}`;

        // Reset demo balance
        const resetBtn = document.getElementById('btn-reset-demo');
        if (resetBtn) {
            resetBtn.onclick = () => {
                if (confirm('Reset wallet balance to ₹1,000.00 demo funds?')) {
                    this.balance = 1000.00;
                    this.userBets = [];
                    this.transactions = [];
                    this.saveState();
                    this.updateBalanceUI();
                    this.renderAccountTab();
                    this.renderTransactions();
                    this.showToast('Balance reset to ₹1,000.00!', 'info');
                }
            };
        }
    }

    renderTransactions() {
        const container = document.getElementById('transactions-list');
        if (!container) return;

        if (this.transactions.length === 0) {
            container.innerHTML = `<div class="empty-state"><p>No transactions yet</p></div>`;
            return;
        }

        container.innerHTML = this.transactions.slice(0, 15).map(tx => {
            const isCredit = tx.type === 'Credit';
            return `
                <div class="tx-card">
                    <div class="tx-left">
                        <span class="tx-desc">${tx.desc}</span>
                        <span class="tx-time">${tx.date} ${tx.time}</span>
                    </div>
                    <div class="tx-amount ${isCredit ? 'text-win' : 'text-loss'}">
                        ${isCredit ? '+' : '-'}₹${tx.amount.toFixed(2)}
                    </div>
                </div>
            `;
        }).join('');
    }

    initGames() {
        // Instantiate games
        window.wingoGame = new WinGoGame(this);
        window.aviatorGame = new AviatorGame(this);
        window.minesGame = new MinesGame(this);
        window.k3Game = new K3Game(this);
    }
}

// Global initialization
window.addEventListener('DOMContentLoaded', () => {
    window.stateManager = new StateManager();
});
