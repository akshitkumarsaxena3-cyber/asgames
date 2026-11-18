// Ludo Supreme Cash Game Engine - ASGames Authentic 15x15 Canvas Board
// Supports 2-Player (1v1, 1.9x Prize) & 4-Player (4-Way, 3.6x Prize)
// Modes: Cash Match (VS AI Opponents + Admin Rigging) & Pass-and-Play (2 or 4 Friends Together!)

class LudoGame {
    constructor(stateManager) {
        this.sm = stateManager;
        this.canvas = null;
        this.ctx = null;
        this.boardSize = 360;
        this.cellSize = 24;

        this.playerCount = 4;     // 2 or 4 players
        this.playMode = 'cash';   // 'cash' (1 human vs bots for cash) | 'friends' (all humans pass & play)
        this.entryFee = 50;
        this.isPlaying = false;
        this.turnIdx = 0;
        this.diceValue = 6;
        this.isRolling = false;
        this.waitingForTokenPick = false;
        this.turnsLeft = 24;
        this.rigMode = 'fair';

        // 52-step outer loop coordinates [col, row] on 15x15 grid
        this.track = [
            [1,6],[2,6],[3,6],[4,6],[5,6],
            [6,5],[6,4],[6,3],[6,2],[6,1],[6,0],
            [7,0],[8,0],
            [8,1],[8,2],[8,3],[8,4],[8,5],
            [9,6],[10,6],[11,6],[12,6],[13,6],[14,6],
            [14,7],[14,8],
            [13,8],[12,8],[11,8],[10,8],[9,8],
            [8,9],[8,10],[8,11],[8,12],[8,13],[8,14],
            [7,14],[6,14],
            [6,13],[6,12],[6,11],[6,10],[6,9],
            [5,8],[4,8],[3,8],[2,8],[1,8],[0,8],
            [0,7],[0,6]
        ];

        this.safeTrackIndices = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

        // Full 4-Player Board Config (Clockwise: Red -> Green -> Yellow -> Blue)
        this.playerConfigs = {
            red: {
                key: 'red',
                name: 'RED',
                emoji: '🔴',
                fill: '#dc2626',
                ring: '#ffffff',
                glow: 'rgba(239, 68, 68, 0.55)',
                startIdx: 39,
                homePath: [[7,13],[7,12],[7,11],[7,10],[7,9],[7,8]],
                yardSpots: [[1.5,10.5],[3.5,10.5],[1.5,12.5],[3.5,12.5]],
                finishPos: { x: 7, y: 7.45 }
            },
            green: {
                key: 'green',
                name: 'GREEN',
                emoji: '🟢',
                fill: '#10b981',
                ring: '#ffffff',
                glow: 'rgba(16, 185, 129, 0.55)',
                startIdx: 0,
                homePath: [[1,7],[2,7],[3,7],[4,7],[5,7],[6,7]],
                yardSpots: [[1.5,1.5],[3.5,1.5],[1.5,3.5],[3.5,3.5]],
                finishPos: { x: 6.55, y: 7 }
            },
            yellow: {
                key: 'yellow',
                name: 'YELLOW',
                emoji: '🟡',
                fill: '#f59e0b',
                ring: '#78350f',
                glow: 'rgba(245, 158, 11, 0.55)',
                startIdx: 13,
                homePath: [[7,1],[7,2],[7,3],[7,4],[7,5],[7,6]],
                yardSpots: [[10.5,1.5],[12.5,1.5],[10.5,3.5],[12.5,3.5]],
                finishPos: { x: 7, y: 6.55 }
            },
            blue: {
                key: 'blue',
                name: 'BLUE',
                emoji: '🔵',
                fill: '#2563eb',
                ring: '#ffffff',
                glow: 'rgba(59, 130, 246, 0.55)',
                startIdx: 26,
                homePath: [[13,7],[12,7],[11,7],[10,7],[9,7],[8,7]],
                yardSpots: [[10.5,10.5],[12.5,10.5],[10.5,12.5],[12.5,12.5]],
                finishPos: { x: 7.45, y: 7 }
            }
        };

        this.activePlayers = ['red', 'green', 'yellow', 'blue'];
        this.tokens = {};
        this.scores = {};

        this.resetTokens();
        this.init();
    }

    getPrizeMultiplier() {
        return this.playerCount === 4 ? 3.6 : 1.9;
    }

    setPlayerCount(count) {
        if (this.isPlaying) return;
        this.playerCount = count === 4 ? 4 : 2;
        this.activePlayers = this.playerCount === 4
            ? ['red', 'green', 'yellow', 'blue']
            : ['red', 'yellow'];

        document.querySelectorAll('.ludo-pcount-pill').forEach(el => {
            el.classList.toggle('active', parseInt(el.dataset.pcount, 10) === this.playerCount);
        });

        this.resetTokens();
        this.updatePrizeDisplay();
        this.drawBoard();
        this.updateUI();
        if (window.sound) window.sound.click('ludo');
    }

    setPlayMode(mode) {
        if (this.isPlaying) return;
        this.playMode = mode === 'friends' ? 'friends' : 'cash';
        document.querySelectorAll('.ludo-mode-pill').forEach(el => {
            el.classList.toggle('active', el.dataset.lmode === this.playMode);
        });
        const feeSection = document.getElementById('ludo-fee-section');
        if (feeSection) feeSection.classList.toggle('hidden', this.playMode === 'friends');
        this.updatePrizeDisplay();
        this.updateUI();
        if (window.sound) window.sound.click('ludo');
    }

    setEntryFee(amt) {
        if (this.isPlaying) return;
        this.entryFee = amt;
        document.querySelectorAll('.ludo-fee-pill').forEach(el => {
            el.classList.toggle('active', parseInt(el.dataset.fee, 10) === amt);
        });
        this.updatePrizeDisplay();
    }

    updatePrizeDisplay() {
        const prizeEl = document.getElementById('ludo-prize-val');
        const startBtn = document.getElementById('btn-ludo-start');
        const mult = this.getPrizeMultiplier();
        if (prizeEl) {
            prizeEl.textContent = this.playMode === 'friends'
                ? 'FREE (Friends Mode)'
                : `₹${Math.floor(this.entryFee * mult)} (${mult}x)`;
        }
        if (startBtn) {
            startBtn.textContent = this.playMode === 'friends'
                ? `🤝 START ${this.playerCount}-PLAYER FRIENDS MATCH`
                : `🎲 START ${this.playerCount}P CASH MATCH (WIN ₹${Math.floor(this.entryFee * mult)})`;
        }
    }

    getPlayerLabel(key) {
        const cfg = this.playerConfigs[key];
        if (this.playMode === 'friends') {
            const idx = this.activePlayers.indexOf(key) + 1;
            return `${cfg.emoji} P${idx} (${cfg.name})`;
        }
        if (key === 'red') return '🔴 YOU (RED)';
        const botIdx = this.activePlayers.indexOf(key);
        return `${cfg.emoji} ${this.playerCount === 2 ? 'OPPONENT' : `BOT ${botIdx}`}`;
    }

    isHumanTurn(key) {
        if (this.playMode === 'friends') return true;
        return key === 'red';
    }

    getCurrentPlayerKey() {
        return this.activePlayers[this.turnIdx] || 'red';
    }

    resetTokens() {
        this.tokens = {};
        this.scores = {};
        this.activePlayers.forEach(key => {
            const cfg = this.playerConfigs[key];
            this.tokens[key] = [
                { id: 0, progress: 0, homeBase: cfg.yardSpots[0] },
                { id: 1, progress: 0, homeBase: cfg.yardSpots[1] },
                { id: 2, progress: -1, homeBase: cfg.yardSpots[2] },
                { id: 3, progress: -1, homeBase: cfg.yardSpots[3] }
            ];
            this.scores[key] = 0;
        });
    }

    init() {
        this.canvas = document.getElementById('ludo-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.resizeCanvas();
        this.canvas.addEventListener('click', (e) => this.handleBoardClick(e));
        this.updatePrizeDisplay();
        this.drawBoard();
        this.updateUI();
    }

    resizeCanvas() {
        if (!this.canvas) return;
        const containerWidth = Math.min(390, (this.canvas.parentElement?.clientWidth || 360) - 8);
        const size = Math.floor(containerWidth / 15) * 15;
        this.boardSize = size;
        this.cellSize = size / 15;
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = size * dpr;
        this.canvas.height = size * dpr;
        this.canvas.style.width = size + 'px';
        this.canvas.style.height = size + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.drawBoard();
    }

    async startMatch() {
        if (this.isPlaying) return;

        if (this.playMode === 'cash') {
            if (this.sm.balance < this.entryFee) {
                this.sm.showToast(`Insufficient balance! Need ₹${this.entryFee} to join ${this.playerCount}P Ludo match.`, 'error');
                return;
            }
            // Fetch Admin Control settings
            this.rigMode = 'fair';
            try {
                const res = await fetch('/api/game/all-rigging');
                const d = await res.json();
                if (d.success && d.ludo_mode) this.rigMode = d.ludo_mode;
            } catch (e) {}

            this.sm.deductBalance(this.entryFee, `Ludo ${this.playerCount}P Cash Match (Entry ₹${this.entryFee})`);
        } else {
            this.rigMode = 'fair';
        }

        this.resetTokens();
        this.isPlaying = true;
        this.turnIdx = 0;
        this.turnsLeft = this.playerCount === 4 ? 18 : 24;
        this.waitingForTokenPick = false;
        this.isRolling = false;

        this.resizeCanvas();
        this.drawBoard();
        this.updateUI();
        const curKey = this.getCurrentPlayerKey();
        this.setStatus(`${this.getPlayerLabel(curKey)} turn! Tap ROLL DICE 🎲`);
        if (window.sound) window.sound.chip('ludo');
    }

    getTokenGridPos(token, ownerKey) {
        const cfg = this.playerConfigs[ownerKey];
        if (token.progress === -1) {
            return { x: token.homeBase[0], y: token.homeBase[1], inYard: true };
        }
        if (token.progress >= 56) {
            return { x: cfg.finishPos.x, y: cfg.finishPos.y, finished: true };
        }
        if (token.progress > 50) {
            const idx = token.progress - 51;
            const pt = cfg.homePath[Math.min(idx, 5)];
            return { x: pt[0], y: pt[1] };
        }
        const trackIdx = (cfg.startIdx + token.progress) % 52;
        const pt = this.track[trackIdx];
        return { x: pt[0], y: pt[1], trackIdx };
    }

    getValidMoves(tokens, roll) {
        return tokens.filter(t => {
            if (t.progress >= 56) return false;
            if (t.progress === -1) return roll === 6;
            return t.progress + roll <= 56;
        });
    }

    rollDice(isBotCall = false) {
        if (!this.isPlaying || this.isRolling || this.waitingForTokenPick) return;
        const curKey = this.getCurrentPlayerKey();
        const human = this.isHumanTurn(curKey);
        if (!isBotCall && !human) return;
        if (isBotCall && human) return;

        this.isRolling = true;
        if (window.sound) window.sound.diceRoll('ludo');

        const diceEl = document.getElementById('ludo-dice-face');
        if (diceEl) diceEl.classList.add('rolling');

        let ticks = 0;
        const anim = setInterval(() => {
            ticks++;
            const tmp = Math.floor(Math.random() * 6) + 1;
            if (diceEl) diceEl.textContent = this.diceSymbol(tmp);
            if (ticks >= 7) {
                clearInterval(anim);
                if (diceEl) diceEl.classList.remove('rolling');
                this.finishRoll(curKey, !human);
            }
        }, 60);
    }

    finishRoll(ownerKey, isBot) {
        this.isRolling = false;
        let roll = Math.floor(Math.random() * 6) + 1;

        if (this.playMode === 'cash') {
            if (this.rigMode === 'bot_win') {
                if (isBot) roll = [4, 5, 6, 6][Math.floor(Math.random() * 4)];
                else roll = [1, 2, 2, 3, 4][Math.floor(Math.random() * 5)];
            } else if (this.rigMode === 'player_win') {
                if (!isBot) roll = [5, 6, 6, 4][Math.floor(Math.random() * 4)];
                else roll = [1, 2, 3][Math.floor(Math.random() * 3)];
            }
        }

        this.diceValue = roll;
        const diceEl = document.getElementById('ludo-dice-face');
        if (diceEl) diceEl.textContent = this.diceSymbol(roll);

        const ownerTokens = this.tokens[ownerKey] || [];
        const valid = this.getValidMoves(ownerTokens, roll);
        const label = this.getPlayerLabel(ownerKey);

        if (valid.length === 0) {
            this.setStatus(`${label} rolled ${roll} — No valid moves!`);
            setTimeout(() => this.advanceTurn(false), 650);
            return;
        }

        if (isBot) {
            // Smart Bot AI: finish home > capture opponent > open yard > furthest pawn
            let best = valid[0];
            for (const t of valid) {
                if (t.progress + roll === 56) { best = t; break; }
                const nextProg = t.progress === -1 ? 0 : t.progress + roll;
                if (nextProg <= 50) {
                    const nextTrack = (this.playerConfigs[ownerKey].startIdx + nextProg) % 52;
                    if (!this.safeTrackIndices.has(nextTrack) && this.hasOpponentAt(nextTrack, ownerKey)) {
                        best = t;
                        break;
                    }
                }
                if (t.progress === -1 && roll === 6) { best = t; break; }
                if (t.progress > best.progress) best = t;
            }
            this.setStatus(`${label} rolled ${roll}! Moving pawn...`);
            setTimeout(() => this.executeMove(best, ownerKey, roll), 420);
        } else {
            if (valid.length === 1) {
                this.setStatus(`${label} rolled ${roll}! Moving pawn...`);
                setTimeout(() => this.executeMove(valid[0], ownerKey, roll), 280);
            } else {
                this.waitingForTokenPick = true;
                this.setStatus(`${label} rolled ${roll}! Tap a glowing ${this.playerConfigs[ownerKey].name} pawn.`);
                this.drawBoard();
                this.updateUI();
            }
        }
    }

    hasOpponentAt(trackIdx, ownerKey) {
        for (const otherKey of this.activePlayers) {
            if (otherKey === ownerKey) continue;
            for (const ot of (this.tokens[otherKey] || [])) {
                if (ot.progress >= 0 && ot.progress <= 50) {
                    const opos = this.getTokenGridPos(ot, otherKey);
                    if (opos.trackIdx === trackIdx) return true;
                }
            }
        }
        return false;
    }

    handleBoardClick(e) {
        const curKey = this.getCurrentPlayerKey();
        if (!this.isPlaying || !this.waitingForTokenPick || !this.isHumanTurn(curKey)) return;

        const rect = this.canvas.getBoundingClientRect();
        const clickX = (e.clientX - rect.left) / this.cellSize;
        const clickY = (e.clientY - rect.top) / this.cellSize;

        const valid = this.getValidMoves(this.tokens[curKey] || [], this.diceValue);
        let picked = null;
        let minDist = 1.5;

        for (const t of valid) {
            const pos = this.getTokenGridPos(t, curKey);
            const tx = pos.x + 0.5;
            const ty = pos.y + 0.5;
            const d = Math.hypot(clickX - tx, clickY - ty);
            if (d < minDist) {
                minDist = d;
                picked = t;
            }
        }

        if (picked) {
            this.waitingForTokenPick = false;
            this.executeMove(picked, curKey, this.diceValue);
        }
    }

    executeMove(token, ownerKey, roll) {
        let extraTurn = (roll === 6);
        const label = this.getPlayerLabel(ownerKey);

        if (token.progress === -1 && roll === 6) {
            token.progress = 0;
            this.scores[ownerKey] = (this.scores[ownerKey] || 0) + 6;
        } else {
            token.progress += roll;
            this.scores[ownerKey] = (this.scores[ownerKey] || 0) + roll;
        }

        if (token.progress === 56) {
            this.scores[ownerKey] += 56;
            extraTurn = true;
            if (window.sound) window.sound.win('ludo');
            this.sm.showToast(`🎉 ${label} reached HOME! +56 pts`, 'success');
        } else {
            const pos = this.getTokenGridPos(token, ownerKey);
            if (pos.trackIdx !== undefined && !this.safeTrackIndices.has(pos.trackIdx)) {
                for (const oppKey of this.activePlayers) {
                    if (oppKey === ownerKey) continue;
                    for (const ot of (this.tokens[oppKey] || [])) {
                        if (ot.progress >= 0 && ot.progress <= 50) {
                            const opos = this.getTokenGridPos(ot, oppKey);
                            if (opos.trackIdx === pos.trackIdx) {
                                ot.progress = -1;
                                extraTurn = true;
                                this.scores[ownerKey] += 25;
                                if (window.sound) window.sound.bomb('ludo');
                                this.sm.showToast(`⚔️ ${label} captured ${this.playerConfigs[oppKey].name}! +25 pts & Extra Roll!`, ownerKey === 'red' ? 'success' : 'warning');
                            }
                        }
                    }
                }
            }
        }

        this.drawBoard();
        this.updateUI();

        const allDone = (this.tokens[ownerKey] || []).every(t => t.progress >= 56);
        if (allDone) {
            this.endMatch(ownerKey);
            return;
        }

        this.advanceTurn(extraTurn);
    }

    advanceTurn(extraTurn) {
        if (!extraTurn) {
            const nextIdx = (this.turnIdx + 1) % this.activePlayers.length;
            if (nextIdx === 0) {
                this.turnsLeft--;
            }
            this.turnIdx = nextIdx;
        }

        this.updateUI();

        if (this.turnsLeft <= 0) {
            this.endMatch(null);
            return;
        }

        const curKey = this.getCurrentPlayerKey();
        const label = this.getPlayerLabel(curKey);
        if (!this.isHumanTurn(curKey)) {
            this.setStatus(extraTurn ? `${label} gets a bonus roll...` : `${label} is rolling dice...`);
            setTimeout(() => this.rollDice(true), 680);
        } else {
            this.setStatus(extraTurn ? `🎉 ${label} Bonus Roll! Tap ROLL DICE!` : `${label} turn! Tap ROLL DICE 🎲`);
        }
    }

    endMatch(forcedWinnerKey = null) {
        this.isPlaying = false;
        this.waitingForTokenPick = false;
        this.updateUI();

        // Rank all active players by score
        const ranked = [...this.activePlayers].sort((a, b) => (this.scores[b] || 0) - (this.scores[a] || 0));
        const winnerKey = forcedWinnerKey || ranked[0];
        const winnerLabel = this.getPlayerLabel(winnerKey);

        if (this.playMode === 'friends') {
            if (window.sound) window.sound.win('ludo');
            this.setStatus(`🏆 ${winnerLabel} WON with ${this.scores[winnerKey]} pts!`);
            this.sm.showToast(`🏆 ${winnerLabel} wins the ${this.playerCount}-Player Ludo match!`, 'success');
            return;
        }

        const prize = Math.floor(this.entryFee * this.getPrizeMultiplier());
        if (winnerKey === 'red') {
            this.sm.addBalance(prize, `Ludo ${this.playerCount}P Cash Win (${this.scores.red} pts)`);
            if (window.sound) window.sound.win('ludo');
            this.setStatus(`🏆 YOU WON ₹${prize}! Score: ${this.scores.red} pts`);
            this.sm.showWinModal(prize, `Ludo ${this.playerCount}P Cash Victory!`);
        } else {
            if (window.sound) window.sound.loss('ludo');
            this.setStatus(`Match Over — ${winnerLabel} Won (${this.scores[winnerKey]} pts). Your Score: ${this.scores.red}`);
            this.sm.showToast(`${winnerLabel} won with ${this.scores[winnerKey]} pts.`, 'warning');
        }
    }

    diceSymbol(val) {
        return ['⚀','⚁','⚂','⚃','⚄','⚅'][val - 1] || '🎲';
    }

    setStatus(msg) {
        const el = document.getElementById('ludo-status-text');
        if (el) el.textContent = msg;
    }

    updateUI() {
        const boardEl = document.getElementById('ludo-scoreboard-grid');
        const turnsEl = document.getElementById('ludo-turns-left');
        const startBox = document.getElementById('ludo-lobby-controls');
        const playBox = document.getElementById('ludo-play-controls');
        const rollBtn = document.getElementById('btn-ludo-roll');
        const curKey = this.getCurrentPlayerKey();

        if (turnsEl) turnsEl.textContent = this.turnsLeft;

        if (boardEl) {
            boardEl.style.gridTemplateColumns = this.playerCount === 4 ? 'repeat(4, 1fr)' : 'repeat(2, 1fr)';
            boardEl.innerHTML = this.activePlayers.map(key => {
                const isTurn = this.isPlaying && curKey === key;
                const boxCls = `ludo-${key}-box`;
                return `
                    <div class="ludo-player-box ${boxCls} ${isTurn ? 'ludo-active-turn' : ''}">
                        <span style="font-size:10px; font-weight:700; white-space:nowrap;">${this.getPlayerLabel(key)}</span>
                        <strong style="font-size:18px; color:#fff;">${this.scores[key] || 0}</strong>
                    </div>
                `;
            }).join('');
        }

        if (startBox) startBox.classList.toggle('hidden', this.isPlaying);
        if (playBox) playBox.classList.toggle('hidden', !this.isPlaying);

        if (rollBtn) {
            const human = this.isHumanTurn(curKey);
            const disabled = !this.isPlaying || !human || this.isRolling || this.waitingForTokenPick;
            rollBtn.disabled = disabled;
            rollBtn.style.opacity = disabled ? '0.5' : '1';
            rollBtn.textContent = human
                ? `🎲 ROLL (${this.playerConfigs[curKey].name})`
                : `⏳ ${this.playerConfigs[curKey].name} TURN...`;
        }
    }

    drawBoard() {
        if (!this.ctx) return;
        const ctx = this.ctx;
        const cs = this.cellSize;
        const s = this.boardSize;

        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, s, s);

        // Track cells
        for (let r = 0; r < 15; r++) {
            for (let c = 0; c < 15; c++) {
                ctx.fillStyle = '#f8fafc';
                ctx.fillRect(c * cs, r * cs, cs, cs);
                ctx.strokeStyle = '#cbd5e1';
                ctx.lineWidth = 0.7;
                ctx.strokeRect(c * cs, r * cs, cs, cs);
            }
        }

        // 4 Home Yards
        const drawYard = (x, y, color, light, active) => {
            ctx.fillStyle = color;
            ctx.globalAlpha = active ? 1 : 0.42;
            ctx.fillRect(x * cs, y * cs, 6 * cs, 6 * cs);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect((x + 0.8) * cs, (y + 0.8) * cs, 4.4 * cs, 4.4 * cs);
            ctx.strokeStyle = light;
            ctx.lineWidth = 2;
            ctx.strokeRect((x + 0.8) * cs, (y + 0.8) * cs, 4.4 * cs, 4.4 * cs);
            [[1.5, 1.5], [3.5, 1.5], [1.5, 3.5], [3.5, 3.5]].forEach(([dx, dy]) => {
                ctx.beginPath();
                ctx.arc((x + dx + 0.5) * cs, (y + dy + 0.5) * cs, cs * 0.6, 0, Math.PI * 2);
                ctx.fillStyle = light;
                ctx.fill();
            });
            ctx.globalAlpha = 1;
        };

        const activeSet = new Set(this.activePlayers);
        drawYard(0, 0, '#10b981', '#a7f3d0', activeSet.has('green'));
        drawYard(9, 0, '#f59e0b', '#fde68a', activeSet.has('yellow'));
        drawYard(0, 9, '#ef4444', '#fecaca', activeSet.has('red'));
        drawYard(9, 9, '#3b82f6', '#bfdbfe', activeSet.has('blue'));

        // Home Stretch Colored Lanes
        for (let r = 9; r <= 13; r++) { ctx.fillStyle = '#ef4444'; ctx.fillRect(7 * cs, r * cs, cs, cs); }
        ctx.fillStyle = '#ef4444'; ctx.fillRect(6 * cs, 13 * cs, cs, cs);

        for (let r = 1; r <= 5; r++) { ctx.fillStyle = '#f59e0b'; ctx.fillRect(7 * cs, r * cs, cs, cs); }
        ctx.fillStyle = '#f59e0b'; ctx.fillRect(8 * cs, 1 * cs, cs, cs);

        for (let c = 1; c <= 5; c++) { ctx.fillStyle = '#10b981'; ctx.fillRect(c * cs, 7 * cs, cs, cs); }
        ctx.fillStyle = '#10b981'; ctx.fillRect(1 * cs, 6 * cs, cs, cs);

        for (let c = 9; c <= 13; c++) { ctx.fillStyle = '#3b82f6'; ctx.fillRect(c * cs, 7 * cs, cs, cs); }
        ctx.fillStyle = '#3b82f6'; ctx.fillRect(13 * cs, 8 * cs, cs, cs);

        // Safe Star Zones
        const stars = [[6, 13], [8, 1], [1, 6], [13, 8], [2, 8], [6, 2], [12, 6], [8, 12]];
        ctx.fillStyle = '#64748b';
        ctx.font = `${Math.floor(cs * 0.65)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        stars.forEach(([c, r]) => {
            ctx.fillText('★', (c + 0.5) * cs, (r + 0.52) * cs);
        });

        // Center 3x3 Home Crown Triangles
        const cx = 7.5 * cs, cy = 7.5 * cs;
        const tri = (x1, y1, x2, y2, color) => {
            ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x1 * cs, y1 * cs); ctx.lineTo(x2 * cs, y2 * cs); ctx.closePath();
            ctx.fillStyle = color; ctx.fill();
        };
        tri(6, 6, 9, 6, '#f59e0b');
        tri(6, 9, 9, 9, '#ef4444');
        tri(6, 6, 6, 9, '#10b981');
        tri(9, 6, 9, 9, '#3b82f6');
        ctx.fillStyle = '#ffffff';
        ctx.font = `${Math.floor(cs * 1.1)}px sans-serif`;
        ctx.fillText('👑', cx, cy + 1);

        // Collect all tokens & group by grid cell so overlapping tokens fan out cleanly
        const curKey = this.getCurrentPlayerKey();
        const validIds = (this.waitingForTokenPick && this.isHumanTurn(curKey))
            ? new Set(this.getValidMoves(this.tokens[curKey] || [], this.diceValue).map(t => t.id))
            : new Set();

        const cellGroups = {};
        const renderList = [];
        this.activePlayers.forEach(ownerKey => {
            (this.tokens[ownerKey] || []).forEach(t => {
                const pos = this.getTokenGridPos(t, ownerKey);
                const cellKey = `${Math.round(pos.x * 10)},${Math.round(pos.y * 10)}`;
                if (!cellGroups[cellKey]) cellGroups[cellKey] = [];
                const slot = cellGroups[cellKey].length;
                cellGroups[cellKey].push(t);
                renderList.push({ t, ownerKey, pos, cellKey, slot });
            });
        });

        const offsets = [[0, 0], [-0.18, -0.15], [0.18, -0.15], [0, 0.18], [-0.18, 0.16], [0.18, 0.16]];

        // Draw non-current players first, then current player on top for easy tapping
        renderList.sort((a, b) => (a.ownerKey === curKey ? 1 : 0) - (b.ownerKey === curKey ? 1 : 0));

        renderList.forEach(({ t, ownerKey, pos, cellKey, slot }) => {
            const cfg = this.playerConfigs[ownerKey];
            const groupSize = cellGroups[cellKey].length;
            const [ox, oy] = groupSize > 1 ? (offsets[slot % offsets.length]) : [0, 0];
            const px = (pos.x + 0.5 + ox) * cs;
            const py = (pos.y + 0.5 + oy) * cs;

            if (ownerKey === curKey && validIds.has(t.id)) {
                ctx.beginPath();
                ctx.arc(px, py, cs * 0.58, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(250, 229, 159, 0.65)';
                ctx.fill();
                ctx.strokeStyle = '#f5c443';
                ctx.lineWidth = 2.6;
                ctx.stroke();
            }

            const r = groupSize > 1 ? cs * 0.34 : cs * 0.4;
            ctx.beginPath();
            ctx.arc(px, py, r, 0, Math.PI * 2);
            ctx.fillStyle = cfg.fill;
            ctx.fill();
            ctx.strokeStyle = cfg.ring;
            ctx.lineWidth = 2.2;
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(px - r * 0.25, py - r * 0.25, r * 0.28, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255,255,255,0.65)';
            ctx.fill();
        });
    }
}

window.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        if (window.stateManager) {
            window.ludoGame = new LudoGame(window.stateManager);
        }
    }, 300);
});
