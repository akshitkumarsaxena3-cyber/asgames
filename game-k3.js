// K3 Dice Lottery Game Engine - ASGames Authentic Implementation

class K3Game {
    constructor(stateManager) {
        this.sm = stateManager;
        this.remainingSeconds = 30;
        this.currentPeriod = this.generatePeriod();
        this.isLocked = false;
        this.timer = null;

        this.dice = [1, 2, 3];
        this.history = this.generateInitialHistory(15);
        this.userBets = []; // { period, type, value, amount }

        this.init();
    }

    generatePeriod() {
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        const sec = Math.floor((now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()) / 30);
        return `${y}${m}${d}300${String(sec).padStart(4, '0')}`;
    }

    generateInitialHistory(count) {
        const list = [];
        let base = parseInt(this.generatePeriod()) - count;
        for (let i = 0; i < count; i++) {
            const d1 = Math.floor(Math.random() * 6) + 1;
            const d2 = Math.floor(Math.random() * 6) + 1;
            const d3 = Math.floor(Math.random() * 6) + 1;
            const sum = d1 + d2 + d3;
            list.unshift({
                period: String(base + i),
                dice: [d1, d2, d3],
                sum: sum,
                size: sum >= 11 ? 'Big' : 'Small',
                parity: sum % 2 === 1 ? 'Odd' : 'Even'
            });
        }
        return list;
    }

    init() {
        this.startTimer();
        this.renderHistory();
        this.renderDice([3, 4, 5]);
    }

    startTimer() {
        if (this.timer) clearInterval(this.timer);
        this.remainingSeconds = 30;

        this.timer = setInterval(() => {
            this.remainingSeconds--;
            this.updateDisplay();

            if (this.remainingSeconds <= 5 && !this.isLocked) {
                this.isLocked = true;
            }

            if (this.remainingSeconds <= 0) {
                this.rollDiceAndDraw();
                this.remainingSeconds = 30;
                this.currentPeriod = String(parseInt(this.currentPeriod) + 1);
                this.isLocked = false;
            }
        }, 1000);
    }

    updateDisplay() {
        const timeEl = document.getElementById('k3-timer');
        if (timeEl) {
            timeEl.textContent = `00:${String(this.remainingSeconds).padStart(2, '0')}`;
        }
        const periodEl = document.getElementById('k3-period');
        if (periodEl) {
            periodEl.textContent = this.currentPeriod;
        }
    }

    async rollDiceAndDraw() {
        if (window.sound) window.sound.diceRoll('k3');

        // Animate rolling
        const cup = document.getElementById('k3-cup');
        if (cup) cup.classList.add('shaking');

        // Fetch Admin Control settings for K3
        let k3Mode = 'random';
        let k3Manual = '1,2,3';
        try {
            const res = await fetch('/api/game/all-rigging');
            const d = await res.json();
            if (d.success) {
                k3Mode = d.k3_mode || 'random';
                k3Manual = d.k3_dice || '1,2,3';
            }
        } catch (e) {}

        setTimeout(() => {
            if (cup) cup.classList.remove('shaking');
            let d1 = Math.floor(Math.random() * 6) + 1;
            let d2 = Math.floor(Math.random() * 6) + 1;
            let d3 = Math.floor(Math.random() * 6) + 1;

            if (k3Mode === 'manual') {
                const parts = k3Manual.split(',').map(n => Math.max(1, Math.min(6, parseInt(n) || 1)));
                if (parts.length === 3) [d1, d2, d3] = parts;
            } else if (k3Mode === 'small') {
                // Ensure sum <= 10
                d1 = Math.floor(Math.random() * 3) + 1;
                d2 = Math.floor(Math.random() * 3) + 1;
                d3 = Math.floor(Math.random() * 3) + 1;
            } else if (k3Mode === 'big') {
                // Ensure sum >= 11
                d1 = Math.floor(Math.random() * 3) + 4;
                d2 = Math.floor(Math.random() * 3) + 4;
                d3 = Math.floor(Math.random() * 3) + 4;
            }

            this.dice = [d1, d2, d3];
            const sum = d1 + d2 + d3;
            const size = sum >= 11 ? 'Big' : 'Small';
            const parity = sum % 2 === 1 ? 'Odd' : 'Even';

            this.renderDice(this.dice);

            const record = {
                period: this.currentPeriod,
                dice: [d1, d2, d3],
                sum: sum,
                size: size,
                parity: parity
            };

            this.history.unshift(record);
            if (this.history.length > 30) this.history.pop();
            this.renderHistory();
            this.evaluateBets(record);
        }, 800);
    }

    renderDice(dice) {
        const container = document.getElementById('k3-dice-container');
        if (!container) return;

        container.innerHTML = dice.map(val => `
            <div class="k3-die die-${val}">
                ${this.getDieDots(val)}
            </div>
        `).join('');

        const sumBadge = document.getElementById('k3-sum-display');
        if (sumBadge) {
            const sum = dice[0] + dice[1] + dice[2];
            const size = sum >= 11 ? 'Big' : 'Small';
            sumBadge.textContent = `Sum: ${sum} (${size})`;
        }
    }

    getDieDots(val) {
        const dots = [];
        for (let i = 0; i < val; i++) {
            dots.push('<span class="dot"></span>');
        }
        return dots.join('');
    }

    placeBet(type, value, amount = 50) {
        if (this.isLocked) {
            this.sm.showToast('K3 betting locked for draw!', 'warning');
            return;
        }
        if (this.sm.balance < amount) {
            this.sm.showToast('Insufficient balance!', 'error');
            return;
        }

        this.sm.deductBalance(amount, `K3 Bet (${type} ${value})`);
        this.userBets.unshift({
            period: this.currentPeriod,
            type: type, // 'sum', 'size', 'parity'
            value: value,
            amount: amount,
            status: 'Pending'
        });

        if (window.sound) window.sound.chip();
        this.sm.showToast(`K3 Bet ₹${amount} placed on ${value}!`, 'success');
    }

    evaluateBets(record) {
        let totalWin = 0;
        this.userBets.forEach(bet => {
            if (bet.period === record.period && bet.status === 'Pending') {
                let win = false;
                let mult = 0;

                if (bet.type === 'size' && bet.value === record.size) {
                    win = true;
                    mult = 1.96;
                } else if (bet.type === 'parity' && bet.value === record.parity) {
                    win = true;
                    mult = 1.96;
                } else if (bet.type === 'sum' && parseInt(bet.value) === record.sum) {
                    win = true;
                    // Rare sums pay higher
                    if (record.sum === 3 || record.sum === 18) mult = 200;
                    else if (record.sum === 4 || record.sum === 17) mult = 60;
                    else if (record.sum >= 9 && record.sum <= 12) mult = 7.5;
                    else mult = 15;
                }

                if (win) {
                    const payout = Math.floor(bet.amount * mult * 100) / 100;
                    bet.status = 'Won';
                    bet.payout = payout;
                    totalWin += payout;
                    this.sm.addBalance(payout, `K3 Win Period #${record.period}`);
                } else {
                    bet.status = 'Lost';
                }
            }
        });

        if (totalWin > 0) {
            if (window.sound) window.sound.win();
            this.sm.showWinModal(totalWin, `K3 Lottery Period #${record.period}`);
        }
    }

    renderHistory() {
        const tbody = document.getElementById('k3-history-tbody');
        if (!tbody) return;

        tbody.innerHTML = this.history.slice(0, 10).map(item => `
            <tr>
                <td class="period-id">${item.period.slice(-5)}</td>
                <td>
                    <div class="mini-dice-row">
                        ${item.dice.map(d => `<span class="mini-die">${d}</span>`).join('')}
                    </div>
                </td>
                <td class="font-bold">${item.sum}</td>
                <td class="${item.size === 'Big' ? 'text-big' : 'text-small'}">${item.size}</td>
                <td>${item.parity}</td>
            </tr>
        `).join('');
    }
}

window.K3Game = K3Game;
