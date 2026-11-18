// Aviator Crash Game - ASGames Authentic Canvas Implementation

class AviatorGame {
    constructor(stateManager) {
        this.sm = stateManager;
        this.canvas = null;
        this.ctx = null;

        this.state = 'idle'; // 'idle', 'betting', 'flying', 'crashed'
        this.multiplier = 1.00;
        this.crashPoint = 2.00;
        this.startTime = 0;
        this.animationId = null;

        // Bet state
        this.betAmount = 50;
        this.isBetPlaced = false;
        this.isCashedOut = false;
        this.autoCashout = 0; // 0 = off
        this.sessionWagered = 0;
        this.sessionPaidOut = 0;
        this.currentBetHistoryId = null;

        this.history = [1.84, 3.42, 1.15, 6.78, 2.10, 1.05, 14.50, 2.45];

        this.init();
    }

    init() {
        this.canvas = document.getElementById('aviator-canvas');
        if (this.canvas) {
            this.ctx = this.canvas.getContext('2d');
            this.resizeCanvas();
            window.addEventListener('resize', () => this.resizeCanvas());
        }
        this.renderHistory();
        this.startNextRoundCountdown(3);
    }

    resizeCanvas() {
        if (!this.canvas) return;
        const rect = this.canvas.getBoundingClientRect();
        this.canvas.width = rect.width * (window.devicePixelRatio || 1);
        this.canvas.height = rect.height * (window.devicePixelRatio || 1);
        if (this.ctx) {
            this.ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
        }
    }

    startNextRoundCountdown(seconds = 5) {
        this.state = 'betting';
        this.multiplier = 1.00;
        this.isCashedOut = false;
        let countdown = seconds;

        this.updateBtnState();
        this.drawIdleScreen(`Next round in ${countdown}s...`);

        const timer = setInterval(() => {
            countdown--;
            if (countdown > 0) {
                this.drawIdleScreen(`Next round in ${countdown}s...`);
                if (window.sound) window.sound.tick('aviator');
            } else {
                clearInterval(timer);
                this.launchFlight();
            }
        }, 1000);
    }

    generateCrashPoint(mode = 'smart_profit') {
        // 1. Standard 96% RTP Pareto Crash Formula (Fair Casino Mode)
        if (mode === 'random') {
            const u = Math.min(0.992, Math.max(0.001, Math.random()));
            if (Math.random() < 0.04) return 1.00; // 4% instant crash house edge
            return Math.min(50.00, Math.max(1.01, Math.floor((0.96 / (1 - u)) * 100) / 100));
        }

        // 2. SMART MAX-PROFIT ALGORITHM (Default House-Optimized Engine)
        // A) When player is NOT betting (spectating): exciting realistic flights keep history vibrant!
        if (!this.isBetPlaced) {
            const r = Math.random();
            if (r < 0.14) return +(1.02 + Math.random() * 0.25).toFixed(2);
            if (r < 0.48) return +(1.30 + Math.random() * 1.40).toFixed(2);
            if (r < 0.78) return +(2.70 + Math.random() * 4.80).toFixed(2);
            if (r < 0.94) return +(7.50 + Math.random() * 12.50).toFixed(2);
            return +(20.00 + Math.random() * 28.00).toFixed(2);
        }

        // B) When a REAL bet IS active: evaluate bet size, session P&L & auto-cashout target
        const bet = Number(this.betAmount || 10);
        const netPlayerProfit = this.sessionPaidOut - this.sessionWagered;
        const isHighBet = bet >= 500;
        const isMediumBet = bet >= 100 && bet < 500;
        const playerIsUp = netPlayerProfit > 0 || (this.sessionWagered > 0 && (this.sessionPaidOut / this.sessionWagered) > 0.78);

        let r = Math.random();
        let crash = 1.15;

        if (isHighBet || playerIsUp) {
            // High-Value Bet OR Player currently in profit -> Aggressive House Protection (~82% early crash)
            if (r < 0.28) crash = 1.00 + Math.random() * 0.12;       // 1.00x - 1.12x
            else if (r < 0.72) crash = 1.12 + Math.random() * 0.34;  // 1.12x - 1.46x
            else if (r < 0.92) crash = 1.46 + Math.random() * 0.48;  // 1.46x - 1.94x
            else crash = 1.95 + Math.random() * 1.35;                // 1.95x - 3.30x (capped)
        } else if (isMediumBet) {
            // Medium Bet (₹100 - ₹499) -> Strong ~30% house margin
            if (r < 0.20) crash = 1.00 + Math.random() * 0.14;
            else if (r < 0.62) crash = 1.14 + Math.random() * 0.42;
            else if (r < 0.88) crash = 1.56 + Math.random() * 0.74;
            else crash = 2.30 + Math.random() * 2.20;
        } else {
            // Small Bet (< ₹100) -> Balanced engaging wins + solid ~25% house margin
            if (r < 0.15) crash = 1.00 + Math.random() * 0.14;
            else if (r < 0.54) crash = 1.14 + Math.random() * 0.56;
            else if (r < 0.84) crash = 1.70 + Math.random() * 1.10;
            else crash = 2.80 + Math.random() * 3.50;
        }

        // Smart Auto-Cashout Guard: if player sets auto-cashout >= 1.6x, 70% chance to dip just below it
        if (this.autoCashout >= 1.60 && crash >= this.autoCashout && Math.random() < 0.70) {
            crash = Math.max(1.02, this.autoCashout - (0.04 + Math.random() * 0.22));
        }

        return Math.max(1.00, Math.floor(crash * 100) / 100);
    }

    async fetchServerCrashPoint() {
        let mode = 'smart_profit';
        try {
            const res = await fetch('/api/game/all-rigging', { cache: 'no-store' });
            const d = await res.json();
            if (d.success) {
                mode = d.aviator_mode || 'smart_profit';
                if (mode === 'manual' && d.aviator_crash >= 1.00) {
                    return parseFloat(d.aviator_crash);
                }
                if (mode === 'early_crash' || mode === 'house_edge') {
                    return this.isBetPlaced
                        ? +(1.02 + Math.random() * 0.24).toFixed(2)
                        : +(1.35 + Math.random() * 2.80).toFixed(2);
                }
                if (mode === 'high_flight' || mode === 'super') {
                    return +(8.00 + Math.random() * 22.0).toFixed(2);
                }
            }
        } catch (e) {}
        return this.generateCrashPoint(mode);
    }

    async launchFlight() {
        this.state = 'flying';
        this.crashPoint = await this.fetchServerCrashPoint();
        this.multiplier = 1.00;
        this.startTime = performance.now();
        this.updateBtnState();

        const loop = (timestamp) => {
            if (this.state !== 'flying') return;

            const elapsedSec = (timestamp - this.startTime) / 1000;
            // Exponential climbing formula
            this.multiplier = Math.max(1.00, Math.pow(Math.E, 0.07 * elapsedSec) + (elapsedSec * 0.15));
            this.multiplier = Math.floor(this.multiplier * 100) / 100;

            // Check auto cashout ONLY if target was strictly below crashPoint
            if (this.isBetPlaced && !this.isCashedOut && this.autoCashout > 1.0 && this.autoCashout < this.crashPoint && this.multiplier >= this.autoCashout) {
                this.multiplier = this.autoCashout;
                this.cashOut();
            }

            // Check crash
            if (this.multiplier >= this.crashPoint) {
                this.crash();
                return;
            }

            this.drawFlightScreen();
            this.updateMultiplierDisplay();
            this.updateBtnState();

            this.animationId = requestAnimationFrame(loop);
        };

        this.animationId = requestAnimationFrame(loop);
    }

    crash() {
        this.state = 'crashed';
        this.multiplier = this.crashPoint;
        if (this.animationId) cancelAnimationFrame(this.animationId);

        // Sound (ONLY when Aviator is open)
        if (window.sound) window.sound.loss('aviator');

        // History (strictly past 10 rounds)
        this.history.unshift(this.crashPoint);
        if (this.history.length > 10) this.history.length = 10;
        this.renderHistory();

        // If user bet was active and not cashed out, bet is lost
        if (this.isBetPlaced && !this.isCashedOut) {
            this.isBetPlaced = false;
            const hid = this.currentBetHistoryId || ('AVI' + Date.now() + Math.floor(Math.random() * 999));
            this.currentBetHistoryId = null;
            if (this.sm.recordGameHistory) {
                this.sm.recordGameHistory({
                    id: hid,
                    game: 'Aviator',
                    detail: `Flew away @ ${this.crashPoint.toFixed(2)}x`,
                    bet_amount: this.betAmount,
                    win_amount: 0,
                    status: 'Lost'
                });
            }
            this.sm.showToast(`FLEW AWAY at ${this.crashPoint.toFixed(2)}x! Bet lost.`, 'error');
        }

        this.drawCrashedScreen();
        this.updateMultiplierDisplay();
        this.updateBtnState();

        setTimeout(() => {
            this.startNextRoundCountdown(4);
        }, 2500);
    }

    drawIdleScreen(text) {
        if (!this.ctx || !this.canvas) return;
        const rect = this.canvas.getBoundingClientRect();
        const w = rect.width;
        const h = rect.height;

        this.ctx.clearRect(0, 0, w, h);
        this.drawGrid(w, h);

        this.ctx.fillStyle = '#f5c443';
        this.ctx.font = 'bold 22px Poppins, sans-serif';
        this.ctx.textAlign = 'center';
        this.ctx.fillText(text, w / 2, h / 2 - 10);

        this.ctx.fillStyle = '#94a3b8';
        this.ctx.font = '14px Poppins, sans-serif';
        this.ctx.fillText('Place your bet before takeoff!', w / 2, h / 2 + 20);
    }

    drawFlightScreen() {
        if (!this.ctx || !this.canvas) return;
        const rect = this.canvas.getBoundingClientRect();
        const w = rect.width;
        const h = rect.height;

        this.ctx.clearRect(0, 0, w, h);
        this.drawGrid(w, h);

        // Calculate plane position along bezier curve
        const progress = Math.min(1, (this.multiplier - 1.0) / Math.max(2, this.crashPoint));
        const startX = 30;
        const startY = h - 30;
        const endX = startX + (w - 80) * Math.min(0.9, 0.2 + progress * 0.7);
        const endY = startY - (h - 90) * Math.min(0.85, 0.15 + Math.pow(progress, 0.7) * 0.75);

        // Draw glowing red trail fill under curve
        const gradient = this.ctx.createLinearGradient(0, endY, 0, h);
        gradient.addColorStop(0, 'rgba(239, 68, 68, 0.45)');
        gradient.addColorStop(1, 'rgba(239, 68, 68, 0.0)');

        this.ctx.beginPath();
        this.ctx.moveTo(startX, startY);
        this.ctx.quadraticCurveTo((startX + endX) / 2, startY, endX, endY);
        this.ctx.lineTo(endX, startY);
        this.ctx.closePath();
        this.ctx.fillStyle = gradient;
        this.ctx.fill();

        // Draw trail curve line
        this.ctx.beginPath();
        this.ctx.moveTo(startX, startY);
        this.ctx.quadraticCurveTo((startX + endX) / 2, startY, endX, endY);
        this.ctx.strokeStyle = '#ef4444';
        this.ctx.lineWidth = 3;
        this.ctx.shadowColor = '#ef4444';
        this.ctx.shadowBlur = 12;
        this.ctx.stroke();
        this.ctx.shadowBlur = 0; // reset

        // Draw Plane
        this.drawPlane(endX, endY, progress);
    }

    drawPlane(x, y, progress) {
        this.ctx.save();
        this.ctx.translate(x, y);
        const angle = -Math.PI / 8 - progress * 0.1;
        this.ctx.rotate(angle);

        // Jet fuselage
        this.ctx.fillStyle = '#ff2b4e';
        this.ctx.beginPath();
        this.ctx.ellipse(0, 0, 22, 7, 0, 0, Math.PI * 2);
        this.ctx.fill();

        // Wings
        this.ctx.fillStyle = '#b91c1c';
        this.ctx.beginPath();
        this.ctx.moveTo(-5, -2);
        this.ctx.lineTo(-12, -18);
        this.ctx.lineTo(-2, -18);
        this.ctx.lineTo(5, -2);
        this.ctx.fill();

        // Cockpit window
        this.ctx.fillStyle = '#67e8f9';
        this.ctx.beginPath();
        this.ctx.ellipse(10, -2, 5, 3, 0, 0, Math.PI * 2);
        this.ctx.fill();

        // Jet fire flame
        this.ctx.fillStyle = '#f59e0b';
        this.ctx.beginPath();
        this.ctx.moveTo(-22, 0);
        this.ctx.lineTo(-32 - Math.random() * 8, -4);
        this.ctx.lineTo(-26, 0);
        this.ctx.lineTo(-32 - Math.random() * 8, 4);
        this.ctx.closePath();
        this.ctx.fill();

        this.ctx.restore();
    }

    drawCrashedScreen() {
        if (!this.ctx || !this.canvas) return;
        const rect = this.canvas.getBoundingClientRect();
        const w = rect.width;
        const h = rect.height;

        this.ctx.clearRect(0, 0, w, h);
        this.drawGrid(w, h);

        this.ctx.fillStyle = '#ef4444';
        this.ctx.font = 'bold 26px Poppins, sans-serif';
        this.ctx.textAlign = 'center';
        this.ctx.fillText('FLEW AWAY!', w / 2, h / 2 - 12);

        this.ctx.fillStyle = '#fff';
        this.ctx.font = 'bold 36px Poppins, sans-serif';
        this.ctx.fillText(`${this.crashPoint.toFixed(2)}x`, w / 2, h / 2 + 35);
    }

    drawGrid(w, h) {
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        this.ctx.lineWidth = 1;
        for (let x = 40; x < w; x += 50) {
            this.ctx.beginPath();
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, h);
            this.ctx.stroke();
        }
        for (let y = 30; y < h; y += 40) {
            this.ctx.beginPath();
            this.ctx.moveTo(0, y);
            this.ctx.lineTo(w, y);
            this.ctx.stroke();
        }
    }

    updateMultiplierDisplay() {
        const multEl = document.getElementById('aviator-multiplier');
        if (multEl) {
            multEl.textContent = `${this.multiplier.toFixed(2)}x`;
            if (this.state === 'crashed') {
                multEl.style.color = '#ef4444';
            } else if (this.multiplier >= 10.0) {
                multEl.style.color = '#a855f7';
            } else if (this.multiplier >= 2.0) {
                multEl.style.color = '#10b981';
            } else {
                multEl.style.color = '#ffffff';
            }
        }
    }

    updateBtnState() {
        const btn = document.getElementById('aviator-action-btn');
        if (!btn) return;

        if (this.state === 'betting') {
            if (this.isBetPlaced) {
                btn.className = 'btn-aviator btn-waiting';
                btn.innerHTML = `<span>WAITING FOR TAKEOFF</span><small>Bet: ₹${this.betAmount}</small>`;
                btn.disabled = true;
            } else {
                btn.className = 'btn-aviator btn-bet';
                btn.innerHTML = `<span>PLACE BET</span><small>₹${this.betAmount}</small>`;
                btn.disabled = false;
            }
        } else if (this.state === 'flying') {
            if (this.isBetPlaced && !this.isCashedOut) {
                const currentProfit = (this.betAmount * this.multiplier).toFixed(2);
                btn.className = 'btn-aviator btn-cashout pulse';
                btn.innerHTML = `<span>CASH OUT</span><small>₹${currentProfit} (${this.multiplier.toFixed(2)}x)</small>`;
                btn.disabled = false;
            } else {
                btn.className = 'btn-aviator btn-disabled';
                btn.innerHTML = `<span>FLYING...</span><small>${this.multiplier.toFixed(2)}x</small>`;
                btn.disabled = true;
            }
        } else if (this.state === 'crashed') {
            btn.className = 'btn-aviator btn-crashed';
            btn.innerHTML = `<span>ROUND ENDED</span><small>Flew away</small>`;
            btn.disabled = true;
        }
    }

    handleActionClick() {
        if (this.state === 'betting') {
            this.placeBet();
        } else if (this.state === 'flying' && this.isBetPlaced && !this.isCashedOut) {
            this.cashOut();
        }
    }

    placeBet() {
        if (this.isBetPlaced) return;
        if (this.sm.balance < this.betAmount) {
            this.sm.showToast('Insufficient balance for Aviator bet!', 'error');
            return;
        }

        this.sm.deductBalance(this.betAmount, 'Aviator Bet');
        this.sessionWagered += this.betAmount;
        this.isBetPlaced = true;
        this.isCashedOut = false;
        this.currentBetHistoryId = 'AVI' + Date.now() + Math.floor(Math.random() * 999);
        if (this.sm.recordGameHistory) {
            this.sm.recordGameHistory({
                id: this.currentBetHistoryId,
                game: 'Aviator',
                detail: `Bet Placed • Waiting for takeoff`,
                bet_amount: this.betAmount,
                win_amount: 0,
                status: 'Pending'
            });
        }
        if (window.sound) window.sound.chip();
        this.sm.showToast(`Aviator Bet ₹${this.betAmount} placed!`, 'success');
        this.updateBtnState();
    }

    cashOut() {
        if (!this.isBetPlaced || this.isCashedOut) return;
        this.isCashedOut = true;
        this.isBetPlaced = false;

        const wonAmount = Math.floor(this.betAmount * this.multiplier * 100) / 100;
        this.sessionPaidOut += wonAmount;
        this.sm.addBalance(wonAmount, `Aviator Cashout @ ${this.multiplier.toFixed(2)}x`);
        const hid = this.currentBetHistoryId || ('AVI' + Date.now() + Math.floor(Math.random() * 999));
        this.currentBetHistoryId = null;
        if (this.sm.recordGameHistory) {
            this.sm.recordGameHistory({
                id: hid,
                game: 'Aviator',
                detail: `Cashout @ ${this.multiplier.toFixed(2)}x`,
                bet_amount: this.betAmount,
                win_amount: wonAmount,
                status: 'Won'
            });
        }

        if (window.sound) window.sound.win();
        this.sm.showWinModal(wonAmount, `Aviator Cashout @ ${this.multiplier.toFixed(2)}x!`);
        this.updateBtnState();
    }

    setBetAmount(amt) {
        if (this.isBetPlaced && this.state === 'flying') return;
        this.betAmount = Math.max(10, amt);
        const input = document.getElementById('aviator-bet-input');
        if (input) input.value = this.betAmount;
        this.updateBtnState();
    }

    renderHistory() {
        const container = document.getElementById('aviator-history-pills');
        if (!container) return;
        container.innerHTML = this.history.map(item => {
            let color = 'pill-blue';
            if (item >= 10.0) color = 'pill-purple';
            else if (item >= 2.0) color = 'pill-green';
            return `<span class="aviator-pill ${color}">${item.toFixed(2)}x</span>`;
        }).join('');
    }
}

window.AviatorGame = AviatorGame;
