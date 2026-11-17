// Mines 5x5 Game Engine - ASGames Authentic Implementation

class MinesGame {
    constructor(stateManager) {
        this.sm = stateManager;
        this.gridSize = 25;
        this.mineCount = 3;
        this.betAmount = 20;

        this.isPlaying = false;
        this.minePositions = new Set();
        this.revealedCount = 0;
        this.currentMultiplier = 1.0;
        this.tiles = [];

        this.init();
    }

    init() {
        this.renderGrid();
        this.updateMultiplierDisplay();
        this.updateControls();
    }

    setMineCount(count) {
        if (this.isPlaying) return;
        this.mineCount = parseInt(count);
        this.updateControls();
    }

    setBetAmount(amt) {
        if (this.isPlaying) return;
        this.betAmount = Math.max(10, amt);
        const input = document.getElementById('mines-bet-input');
        if (input) input.value = this.betAmount;
    }

    startGame() {
        if (this.isPlaying) return;
        if (this.sm.balance < this.betAmount) {
            this.sm.showToast('Insufficient balance for Mines!', 'error');
            return;
        }

        // Deduct balance
        this.sm.deductBalance(this.betAmount, `Mines Game (${this.mineCount} Mines)`);

        this.isPlaying = true;
        this.revealedCount = 0;
        this.currentMultiplier = 1.0;
        this.minePositions.clear();

        // Place random mines
        while (this.minePositions.size < this.mineCount) {
            const pos = Math.floor(Math.random() * this.gridSize);
            this.minePositions.add(pos);
        }

        this.renderGrid();
        this.updateMultiplierDisplay();
        this.updateControls();

        if (window.sound) window.sound.chip();
        this.sm.showToast(`Game started! Find the gems, avoid ${this.mineCount} bombs.`, 'info');
    }

    calculateMultiplier(revealed) {
        if (revealed === 0) return 1.0;
        // Combinatorial fair multiplier with 3% house edge
        let prob = 1.0;
        for (let i = 0; i < revealed; i++) {
            prob *= (25 - this.mineCount - i) / (25 - i);
        }
        const mult = (0.97 / prob);
        return Math.floor(mult * 100) / 100;
    }

    handleTileClick(index) {
        if (!this.isPlaying) return;
        const tileEl = document.getElementById(`mine-tile-${index}`);
        if (!tileEl || tileEl.classList.contains('revealed')) return;

        tileEl.classList.add('revealed');

        // Check if bomb
        if (this.minePositions.has(index)) {
            // Hit Bomb!
            tileEl.classList.add('is-bomb');
            tileEl.innerHTML = '💣';
            if (window.sound) window.sound.bomb();
            this.gameOver(false);
            return;
        }

        // Safe Diamond Gem!
        this.revealedCount++;
        this.currentMultiplier = this.calculateMultiplier(this.revealedCount);

        tileEl.classList.add('is-gem');
        tileEl.innerHTML = '💎';
        if (window.sound) window.sound.gem();

        this.updateMultiplierDisplay();
        this.updateControls();

        // Check if all gems found
        if (this.revealedCount === (this.gridSize - this.mineCount)) {
            this.cashOut();
        }
    }

    cashOut() {
        if (!this.isPlaying || this.revealedCount === 0) return;

        const winAmount = Math.floor(this.betAmount * this.currentMultiplier * 100) / 100;
        this.sm.addBalance(winAmount, `Mines Cashout @ ${this.currentMultiplier}x`);

        if (window.sound) window.sound.win();
        this.sm.showWinModal(winAmount, `Mines Cashout @ ${this.currentMultiplier}x (${this.revealedCount} Gems)!`);

        this.gameOver(true);
    }

    gameOver(isWin) {
        this.isPlaying = false;

        // Reveal remaining bombs and gems
        for (let i = 0; i < this.gridSize; i++) {
            const tileEl = document.getElementById(`mine-tile-${i}`);
            if (tileEl && !tileEl.classList.contains('revealed')) {
                tileEl.classList.add('revealed', 'dimmed');
                if (this.minePositions.has(i)) {
                    tileEl.classList.add('is-bomb');
                    tileEl.innerHTML = '💣';
                } else {
                    tileEl.classList.add('is-gem');
                    tileEl.innerHTML = '💎';
                }
            }
        }

        if (!isWin) {
            this.sm.showToast(`Boom! You hit a bomb. Round lost.`, 'error');
        }

        this.updateControls();
    }

    updateMultiplierDisplay() {
        const multEl = document.getElementById('mines-current-mult');
        const profitEl = document.getElementById('mines-current-profit');

        if (multEl) {
            multEl.textContent = `${this.currentMultiplier.toFixed(2)}x`;
        }
        if (profitEl) {
            const profit = (this.betAmount * this.currentMultiplier).toFixed(2);
            profitEl.textContent = `₹${profit}`;
        }
    }

    updateControls() {
        const startBtn = document.getElementById('mines-start-btn');
        const cashoutBtn = document.getElementById('mines-cashout-btn');
        const mineSelect = document.getElementById('mines-count-select');
        const betInput = document.getElementById('mines-bet-input');

        if (startBtn && cashoutBtn) {
            if (this.isPlaying) {
                startBtn.classList.add('hidden');
                cashoutBtn.classList.remove('hidden');
                const winAmount = (this.betAmount * this.currentMultiplier).toFixed(2);
                cashoutBtn.innerHTML = `<span>CASH OUT</span><small>₹${winAmount} (${this.currentMultiplier.toFixed(2)}x)</small>`;
                cashoutBtn.disabled = (this.revealedCount === 0);
            } else {
                startBtn.classList.remove('hidden');
                cashoutBtn.classList.add('hidden');
                startBtn.innerHTML = `<span>START GAME</span><small>Bet: ₹${this.betAmount}</small>`;
                startBtn.disabled = false;
            }
        }

        if (mineSelect) mineSelect.disabled = this.isPlaying;
        if (betInput) betInput.disabled = this.isPlaying;
    }

    renderGrid() {
        const grid = document.getElementById('mines-grid');
        if (!grid) return;

        grid.innerHTML = '';
        for (let i = 0; i < this.gridSize; i++) {
            const tile = document.createElement('div');
            tile.id = `mine-tile-${i}`;
            tile.className = 'mine-tile';
            tile.addEventListener('click', () => this.handleTileClick(i));
            grid.appendChild(tile);
        }
    }
}

window.MinesGame = MinesGame;
