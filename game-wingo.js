// Win Go Game Engine - ASGames Authentic Implementation

class WinGoGame {
    constructor(stateManager) {
        this.sm = stateManager;
        this.currentMode = '30s'; // '30s', '1m', '3m', '5m'
        this.modeDurations = {
            '30s': 30,
            '1m': 60,
            '3m': 180,
            '5m': 300
        };

        this.remainingSeconds = 30;
        this.currentPeriod = this.generatePeriodNumber();
        this.isLocked = false;
        this.timerInterval = null;

        // Betting State for Modal
        this.pendingBet = null;
        this.contractMoney = 10;
        this.multiplier = 1;
        this.quantity = 1;

        // History data per mode
        this.history = {
            '30s': this.generateInitialHistory(25),
            '1m': this.generateInitialHistory(25),
            '3m': this.generateInitialHistory(25),
            '5m': this.generateInitialHistory(25)
        };

        // User Bets
        this.userBets = []; // { id, mode, period, selectType, selectValue, amount, multiplier, totalBet, time, status, winAmount }

        this.init();
    }

    generatePeriodNumber() {
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        const sec = Math.floor((now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()) / 30);
        return `${y}${m}${d}100${String(sec).padStart(4, '0')}`;
    }

    generateInitialHistory(count) {
        const list = [];
        let basePeriod = parseInt(this.generatePeriodNumber()) - count;
        for (let i = 0; i < count; i++) {
            const num = Math.floor(Math.random() * 10);
            const period = String(basePeriod + i);
            list.unshift({
                period: period,
                number: num,
                color: this.getColorForNumber(num),
                size: num >= 5 ? 'Big' : 'Small'
            });
        }
        return list;
    }

    getColorForNumber(num) {
        if (num === 0) return 'red-violet';
        if (num === 5) return 'green-violet';
        if ([1, 3, 7, 9].includes(num)) return 'green';
        return 'red';
    }

    init() {
        this.startTimer();

        // Server synchronization
        setInterval(async () => {
            try {
                const res = await fetch('/api/game/current');
                const d = await res.json();
                if (d.success && this.currentMode === '30s') {
                    this.currentPeriod = d.period;
                    this.remainingSeconds = d.remainingSeconds;
                    this.isLocked = d.isLocked;
                    this.updateTimerDisplay();
                    if (this.isLocked) this.handleBettingLock();
                    else this.handleBettingUnlock();
                }
            } catch (e) {}
        }, 3000);
    }

    switchMode(mode) {
        if (!this.modeDurations[mode]) return;
        this.currentMode = mode;
        this.remainingSeconds = this.modeDurations[mode];
        this.currentPeriod = this.generatePeriodNumber();
        this.isLocked = false;
        this.renderAll();
    }

    startTimer() {
        if (this.timerInterval) clearInterval(this.timerInterval);
        this.remainingSeconds = this.modeDurations[this.currentMode];

        this.timerInterval = setInterval(() => {
            this.remainingSeconds--;

            // Update UI timer
            this.updateTimerDisplay();

            // Lock during last 5 seconds
            if (this.remainingSeconds <= 5 && !this.isLocked) {
                this.isLocked = true;
                this.handleBettingLock();
            }

            // Urgent beeps in last 5 seconds (ONLY when Win Go is open)
            if (this.remainingSeconds <= 5 && this.remainingSeconds > 0) {
                if (window.sound) window.sound.urgentTick('wingo');
            } else if (this.remainingSeconds > 5) {
                if (window.sound && this.remainingSeconds % 5 === 0) window.sound.tick('wingo');
            }

            // Draw period end
            if (this.remainingSeconds <= 0) {
                this.drawPeriodResult();
                this.remainingSeconds = this.modeDurations[this.currentMode];
                this.currentPeriod = String(parseInt(this.currentPeriod) + 1);
                this.isLocked = false;
                this.handleBettingUnlock();
            }
        }, 1000);
    }

    updateTimerDisplay() {
        const m = Math.floor(this.remainingSeconds / 60);
        const s = this.remainingSeconds % 60;
        const timeStr = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        
        const timerEl = document.getElementById('wingo-timer');
        if (timerEl) {
            timerEl.textContent = timeStr;
            if (this.remainingSeconds <= 5) {
                timerEl.classList.add('urgent-pulse');
            } else {
                timerEl.classList.remove('urgent-pulse');
            }
        }

        const periodEl = document.getElementById('wingo-period');
        if (periodEl) {
            periodEl.textContent = this.currentPeriod;
        }

        const digitsEl = document.getElementById('wingo-timer-digits');
        if (digitsEl) {
            const digits = timeStr.replace(':', '').split('');
            digitsEl.innerHTML = `
                <span class="timer-box">${digits[0]}</span>
                <span class="timer-box">${digits[1]}</span>
                <span class="timer-sep">:</span>
                <span class="timer-box">${digits[2]}</span>
                <span class="timer-box">${digits[3]}</span>
            `;
        }
    }

    handleBettingLock() {
        const lockOverlay = document.getElementById('wingo-lock-overlay');
        if (lockOverlay) {
            lockOverlay.classList.remove('hidden');
        }
        // If modal open, disable bet button
        const confirmBtn = document.getElementById('wingo-modal-confirm');
        if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.textContent = 'Locked for Draw...';
        }
    }

    handleBettingUnlock() {
        const lockOverlay = document.getElementById('wingo-lock-overlay');
        if (lockOverlay) {
            lockOverlay.classList.add('hidden');
        }
        const confirmBtn = document.getElementById('wingo-modal-confirm');
        if (confirmBtn) {
            confirmBtn.disabled = false;
            this.updateModalTotal();
        }
    }

    drawPeriodResult() {
        const resultNumber = Math.floor(Math.random() * 10);
        const color = this.getColorForNumber(resultNumber);
        const size = resultNumber >= 5 ? 'Big' : 'Small';

        const record = {
            period: this.currentPeriod,
            number: resultNumber,
            color: color,
            size: size
        };

        this.history[this.currentMode].unshift(record);
        if (this.history[this.currentMode].length > 50) {
            this.history[this.currentMode].pop();
        }

        // Show Draw Animation popup/toast
        this.showDrawReveal(record);

        // Check user bets on this period
        this.evaluateUserBets(record);

        // Refresh tables
        this.renderHistory();
        this.renderMyBets();
    }

    showDrawReveal(record) {
        const revealEl = document.getElementById('wingo-draw-reveal');
        if (!revealEl) return;

        let colorBadge = '';
        if (record.color === 'green') colorBadge = '<span class="badge-ball bg-green">Green</span>';
        else if (record.color === 'red') colorBadge = '<span class="badge-ball bg-red">Red</span>';
        else if (record.color === 'red-violet') colorBadge = '<span class="badge-ball bg-red-violet">0 Red+Violet</span>';
        else if (record.color === 'green-violet') colorBadge = '<span class="badge-ball bg-green-violet">5 Green+Violet</span>';

        revealEl.innerHTML = `
            <div class="reveal-content animate-pop">
                <div class="reveal-title">Period ${record.period} Result</div>
                <div class="ball-result ball-${record.color}">${record.number}</div>
                <div class="reveal-meta">
                    ${colorBadge}
                    <span class="badge-ball bg-${record.size.toLowerCase()}">${record.size}</span>
                </div>
            </div>
        `;
        revealEl.classList.remove('hidden');

        setTimeout(() => {
            revealEl.classList.add('hidden');
        }, 3200);
    }

    openBetModal(type, value) {
        if (this.isLocked) {
            this.sm.showToast('Betting is locked for current draw!', 'warning');
            return;
        }

        this.pendingBet = {
            type: type, // 'color', 'number', 'size'
            value: value, // 'green', 'violet', 'red', 0-9, 'big', 'small'
            mode: this.currentMode,
            period: this.currentPeriod
        };

        const modal = document.getElementById('wingo-bet-modal');
        const titleEl = document.getElementById('wingo-modal-title');
        const badgeEl = document.getElementById('wingo-modal-badge');

        let displayValue = String(value).toUpperCase();
        let colorClass = 'bg-primary';

        if (type === 'color') {
            colorClass = `bg-${value}`;
            displayValue = `Select ${value.toUpperCase()}`;
        } else if (type === 'number') {
            const c = this.getColorForNumber(value);
            colorClass = `bg-${c}`;
            displayValue = `Select Number ${value}`;
        } else if (type === 'size') {
            colorClass = value === 'big' ? 'bg-big' : 'bg-small';
            displayValue = `Select ${value.toUpperCase()}`;
        }

        if (titleEl) titleEl.textContent = `Win Go ${this.currentMode} - Bet`;
        if (badgeEl) {
            badgeEl.className = `modal-bet-badge ${colorClass}`;
            badgeEl.textContent = displayValue;
        }

        this.contractMoney = 10;
        this.multiplier = 1;
        this.quantity = 1;
        this.updateModalButtons();
        this.updateModalTotal();

        if (modal) modal.classList.remove('hidden');
        if (window.sound) window.sound.click();
    }

    closeBetModal() {
        const modal = document.getElementById('wingo-bet-modal');
        if (modal) modal.classList.add('hidden');
        this.pendingBet = null;
    }

    setContractMoney(amount) {
        this.contractMoney = amount;
        this.updateModalButtons();
        this.updateModalTotal();
        if (window.sound) window.sound.click();
    }

    setMultiplier(mult) {
        this.multiplier = mult;
        this.updateModalButtons();
        this.updateModalTotal();
        if (window.sound) window.sound.click();
    }

    changeQuantity(delta) {
        this.quantity = Math.max(1, this.quantity + delta);
        const qtyInput = document.getElementById('wingo-modal-qty');
        if (qtyInput) qtyInput.value = this.quantity;
        this.updateModalTotal();
        if (window.sound) window.sound.click();
    }

    setQuantityFromInput(val) {
        let num = parseInt(val) || 1;
        this.quantity = Math.max(1, num);
        this.updateModalTotal();
    }

    updateModalButtons() {
        // Contract money buttons active state
        document.querySelectorAll('.btn-money').forEach(b => {
            const amt = parseInt(b.dataset.amount);
            if (amt === this.contractMoney) b.classList.add('active');
            else b.classList.remove('active');
        });

        // Multiplier chips active state
        document.querySelectorAll('.btn-mult').forEach(b => {
            const m = parseInt(b.dataset.mult);
            if (m === this.multiplier) b.classList.add('active');
            else b.classList.remove('active');
        });

        const qtyInput = document.getElementById('wingo-modal-qty');
        if (qtyInput) qtyInput.value = this.quantity;
    }

    updateModalTotal() {
        const total = this.contractMoney * this.multiplier * this.quantity;
        const totalEl = document.getElementById('wingo-modal-total');
        if (totalEl) totalEl.textContent = `₹${total.toLocaleString('en-IN')}`;

        const confirmBtn = document.getElementById('wingo-modal-confirm');
        if (confirmBtn && !this.isLocked) {
            confirmBtn.textContent = `Bet ₹${total.toLocaleString('en-IN')}`;
        }
    }

    async confirmBet() {
        if (!this.pendingBet) return;
        if (this.isLocked) {
            this.sm.showToast('Time is over for this issue! Waiting for next round.', 'warning');
            return;
        }

        if (this._placingBet) return;
        const totalBet = this.contractMoney * this.multiplier * this.quantity;
        if (this.sm.balance < totalBet) {
            this.sm.showToast('Insufficient balance! Please recharge.', 'error');
            return;
        }

        this._placingBet = true;
        let serverDeducted = false;

        // If user is authenticated, sync bet with backend server (server deducts ONCE!)
        if (this.sm.token) {
            try {
                const res = await fetch('/api/game/bet', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.sm.token}`
                    },
                    body: JSON.stringify({
                        period_id: this.currentPeriod,
                        select_type: this.pendingBet.type,
                        select_value: this.pendingBet.value,
                        amount: totalBet
                    })
                });
                const d = await res.json();
                if (!d.success) {
                    this._placingBet = false;
                    this.sm.showToast(d.message, 'error');
                    return;
                }
                serverDeducted = true;
                const serverBal = typeof d.balance === 'number' ? d.balance
                    : (typeof d.newBalance === 'number' ? d.newBalance
                    : (typeof d.new_balance === 'number' ? d.new_balance : Math.max(0, this.sm.balance - totalBet)));
                this.sm.setLocalBalance(serverBal, 'down');
            } catch (e) {
                console.log('Server bet sync offline, falling back to local simulation:', e);
            }
        }

        // Only deduct via sync-game-delta if /api/game/bet did NOT already deduct on server!
        if (!serverDeducted) {
            this.sm.deductBalance(totalBet, `Win Go ${this.currentMode} Issue #${this.currentPeriod}`);
        }

        // Register user bet
        const betRecord = {
            id: 'BET' + Date.now(),
            mode: this.currentMode,
            period: this.currentPeriod,
            selectType: this.pendingBet.type,
            selectValue: this.pendingBet.value,
            contractMoney: this.contractMoney,
            multiplier: this.multiplier,
            quantity: this.quantity,
            totalBet: totalBet,
            serverSynced: serverDeducted,
            time: new Date().toLocaleTimeString(),
            status: 'Pending',
            winAmount: 0
        };

        this.userBets.unshift(betRecord);
        this.sm.saveUserBet(betRecord);
        if (this.sm.recordGameHistory) {
            this.sm.recordGameHistory({
                id: betRecord.id,
                game: 'Win Go',
                detail: `${this.currentMode} • #${this.currentPeriod} • ${String(betRecord.selectValue).toUpperCase()}`,
                bet_amount: totalBet,
                win_amount: 0,
                status: 'Pending'
            });
        }

        this._placingBet = false;
        if (window.sound) window.sound.chip('wingo');
        this.sm.showToast(`Bet ₹${totalBet} placed on ${String(this.pendingBet.value).toUpperCase()}!`, 'success');
        this.closeBetModal();
        this.renderMyBets();
    }

    evaluateUserBets(drawResult) {
        let totalWinThisRound = 0;
        let wonAny = false;

        this.userBets.forEach(bet => {
            if (bet.period === drawResult.period && bet.status === 'Pending') {
                let isWin = false;
                let multiplier = 0;

                const num = drawResult.number;
                const col = drawResult.color;
                const size = drawResult.size.toLowerCase();

                // 1. Color bet
                if (bet.selectType === 'color') {
                    if (bet.selectValue === 'green') {
                        if (col === 'green') {
                            isWin = true;
                            multiplier = 2.0;
                        } else if (col === 'green-violet') {
                            isWin = true;
                            multiplier = 1.5;
                        }
                    } else if (bet.selectValue === 'red') {
                        if (col === 'red') {
                            isWin = true;
                            multiplier = 2.0;
                        } else if (col === 'red-violet') {
                            isWin = true;
                            multiplier = 1.5;
                        }
                    } else if (bet.selectValue === 'violet') {
                        if (col === 'red-violet' || col === 'green-violet') {
                            isWin = true;
                            multiplier = 4.5;
                        }
                    }
                }
                // 2. Number bet
                else if (bet.selectType === 'number') {
                    if (parseInt(bet.selectValue) === num) {
                        isWin = true;
                        multiplier = 9.0;
                    }
                }
                // 3. Big / Small bet
                else if (bet.selectType === 'size') {
                    if (bet.selectValue === size) {
                        isWin = true;
                        multiplier = 2.0;
                    }
                }

                if (isWin) {
                    // Payout after platform service fee (2%)
                    const grossWin = bet.totalBet * multiplier;
                    const netWin = Math.floor(grossWin * 0.98 * 100) / 100;
                    bet.status = 'Won';
                    bet.winAmount = netWin;
                    totalWinThisRound += netWin;
                    wonAny = true;
                    // If serverSynced, backend drawPeriod already credited DB — skip double syncGameDelta!
                    this.sm.addBalance(netWin, `Win Go Win Period #${drawResult.period}`, Boolean(bet.serverSynced));
                    if (this.sm.recordGameHistory) {
                        this.sm.recordGameHistory({
                            id: bet.id,
                            game: 'Win Go',
                            detail: `${bet.mode} • #${drawResult.period} • Pick: ${String(bet.selectValue).toUpperCase()} (Result: ${drawResult.number})`,
                            bet_amount: bet.totalBet,
                            win_amount: netWin,
                            status: 'Won'
                        });
                    }
                } else {
                    bet.status = 'Lost';
                    bet.winAmount = 0;
                    if (this.sm.recordGameHistory) {
                        this.sm.recordGameHistory({
                            id: bet.id,
                            game: 'Win Go',
                            detail: `${bet.mode} • #${drawResult.period} • Pick: ${String(bet.selectValue).toUpperCase()} (Result: ${drawResult.number})`,
                            bet_amount: bet.totalBet,
                            win_amount: 0,
                            status: 'Lost'
                        });
                    }
                }
            }
        });

        if (wonAny) {
            if (window.sound) window.sound.win('wingo');
            this.sm.showWinModal(totalWinThisRound, `Win Go ${this.currentMode} Issue #${drawResult.period}`);
            setTimeout(() => this.sm.fetchUserProfile(), 1200);
        } else {
            // Check if user had any lost bets this round
            const hadBet = this.userBets.some(b => b.period === drawResult.period);
            if (hadBet && window.sound) window.sound.loss('wingo');
        }
    }

    renderAll() {
        this.updateTimerDisplay();
        this.renderHistory();
        this.renderTrend();
        this.renderMyBets();
    }

    renderHistory() {
        const tbody = document.getElementById('wingo-history-tbody');
        if (!tbody) return;

        const list = this.history[this.currentMode] || [];
        tbody.innerHTML = list.slice(0, 15).map(item => {
            let colorBalls = '';
            if (item.color === 'green') {
                colorBalls = `<span class="dot-ball dot-green"></span>`;
            } else if (item.color === 'red') {
                colorBalls = `<span class="dot-ball dot-red"></span>`;
            } else if (item.color === 'red-violet') {
                colorBalls = `<span class="dot-ball dot-red"></span><span class="dot-ball dot-violet"></span>`;
            } else if (item.color === 'green-violet') {
                colorBalls = `<span class="dot-ball dot-green"></span><span class="dot-ball dot-violet"></span>`;
            }

            const sizeClass = item.size === 'Big' ? 'text-big' : 'text-small';

            return `
                <tr>
                    <td class="period-id">${item.period.slice(-5)}</td>
                    <td>
                        <span class="number-ball ball-${item.color}">${item.number}</span>
                    </td>
                    <td class="${sizeClass} font-bold">${item.size}</td>
                    <td><div class="dots-wrapper">${colorBalls}</div></td>
                </tr>
            `;
        }).join('');
    }

    renderTrend() {
        const trendContainer = document.getElementById('wingo-trend-grid');
        if (!trendContainer) return;

        const list = (this.history[this.currentMode] || []).slice(0, 20).reverse();
        trendContainer.innerHTML = list.map(item => `
            <div class="trend-col">
                <span class="trend-num ball-${item.color}">${item.number}</span>
                <span class="trend-size ${item.size === 'Big' ? 'text-big' : 'text-small'}">${item.size[0]}</span>
            </div>
        `).join('');
    }

    renderMyBets() {
        const container = document.getElementById('wingo-mybets-list');
        if (!container) return;

        const bets = this.userBets.filter(b => b.mode === this.currentMode).slice(0, 15);
        if (bets.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">🎲</div>
                    <p>No bets yet on Win Go ${this.currentMode}</p>
                </div>
            `;
            return;
        }

        container.innerHTML = bets.map(b => {
            const statusClass = b.status === 'Won' ? 'badge-won' : (b.status === 'Lost' ? 'badge-lost' : 'badge-pending');
            const resultAmount = b.status === 'Won' ? `+₹${b.winAmount.toFixed(2)}` : (b.status === 'Lost' ? `-₹${b.totalBet.toFixed(2)}` : 'Waiting...');

            return `
                <div class="bet-card">
                    <div class="bet-card-header">
                        <span class="bet-period">Issue #${b.period.slice(-5)}</span>
                        <span class="bet-status ${statusClass}">${b.status}</span>
                    </div>
                    <div class="bet-card-body">
                        <div class="bet-detail">
                            <span class="label">Select:</span>
                            <span class="val-badge badge-${b.selectValue}">${String(b.selectValue).toUpperCase()}</span>
                        </div>
                        <div class="bet-detail">
                            <span class="label">Amount:</span>
                            <span>₹${b.totalBet.toLocaleString('en-IN')}</span>
                        </div>
                        <div class="bet-detail">
                            <span class="label">Profit:</span>
                            <span class="${b.status === 'Won' ? 'text-win' : (b.status === 'Lost' ? 'text-loss' : '')}">${resultAmount}</span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }
}

window.WinGoGame = WinGoGame;
