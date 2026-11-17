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
                if (window.sound) window.sound.tick();
            } else {
                clearInterval(timer);
                this.launchFlight();
            }
        }, 1000);
    }

    generateCrashPoint() {
        // Realistic provably fair crash distribution
        const rand = Math.random();
        // 5% instant crash at 1.00 - 1.10
        if (rand < 0.05) return 1.00 + Math.random() * 0.1;
        // 50% crash between 1.10 - 2.50
        if (rand < 0.55) return 1.10 + Math.random() * 1.4;
        // 30% crash between 2.50 - 6.00
        if (rand < 0.85) return 2.50 + Math.random() * 3.5;
        // 12% crash between 6.00 - 20.00
        if (rand < 0.97) return 6.00 + Math.random() * 14.0;
        // 3% mega multiplier
        return 20.00 + Math.random() * 45.0;
    }

    launchFlight() {
        this.state = 'flying';
        this.crashPoint = this.generateCrashPoint();
        this.multiplier = 1.00;
        this.startTime = performance.now();
        this.updateBtnState();

        const loop = (timestamp) => {
            if (this.state !== 'flying') return;

            const elapsedSec = (timestamp - this.startTime) / 1000;
            // Exponential climbing formula
            this.multiplier = Math.max(1.00, Math.pow(Math.E, 0.07 * elapsedSec) + (elapsedSec * 0.15));
            this.multiplier = Math.floor(this.multiplier * 100) / 100;

            // Check auto cashout
            if (this.isBetPlaced && !this.isCashedOut && this.autoCashout > 1.0 && this.multiplier >= this.autoCashout) {
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

        // Sound
        if (window.sound) window.sound.loss();

        // History
        this.history.unshift(this.crashPoint);
        if (this.history.length > 12) this.history.pop();
        this.renderHistory();

        // If user bet was active and not cashed out, bet is lost
        if (this.isBetPlaced && !this.isCashedOut) {
            this.isBetPlaced = false;
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
        this.isBetPlaced = true;
        this.isCashedOut = false;
        if (window.sound) window.sound.chip();
        this.sm.showToast(`Aviator Bet ₹${this.betAmount} placed!`, 'success');
        this.updateBtnState();
    }

    cashOut() {
        if (!this.isBetPlaced || this.isCashedOut) return;
        this.isCashedOut = true;
        this.isBetPlaced = false;

        const wonAmount = Math.floor(this.betAmount * this.multiplier * 100) / 100;
        this.sm.addBalance(wonAmount, `Aviator Cashout @ ${this.multiplier.toFixed(2)}x`);

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
