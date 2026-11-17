// Ludo Supreme Cash Game Engine - ASGames Authentic 15x15 Canvas Board
// Player (Red) vs AI Bot (Yellow) with Entry Fee, 1.9x Cash Prize, Captures & Admin Rigging Control

class LudoGame {
    constructor(stateManager) {
        this.sm = stateManager;
        this.canvas = null;
        this.ctx = null;
        this.boardSize = 360;
        this.cellSize = 24;

        this.entryFee = 50;
        this.isPlaying = false;
        this.turn = 'player'; // 'player' | 'bot'
        this.diceValue = 6;
        this.isRolling = false;
        this.waitingForTokenPick = false;
        this.turnsLeft = 24; // Rapid 24-turn Ludo Cash Match (like Zupee Ludo Supreme)
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

        // Player (Red) starts at track index 40 ([6,13]) -> travels 50 steps -> home column [7,13]..[7,8]
        // Bot (Yellow) starts at track index 14 ([8,2]) -> travels 50 steps -> home column [7,1]..[7,6]
        this.playerStartIdx = 39; // [6,13]
        this.botStartIdx = 13;    // [8,1]

        this.playerHomePath = [[7,13],[7,12],[7,11],[7,10],[7,9],[7,8]];
        this.botHomePath    = [[7,1],[7,2],[7,3],[7,4],[7,5],[7,6]];

        this.safeTrackIndices = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

        this.resetTokens();
        this.init();
    }

    resetTokens() {
        // Each token has progress: 0 = on start tile, 1..50 = outer track, 51..56 = home path (56 = HOME CROWN!)
        this.playerTokens = [
            { id: 0, progress: 0, homeBase: [1.5, 10.5] },
            { id: 1, progress: 0, homeBase: [3.5, 10.5] },
            { id: 2, progress: -1, homeBase: [1.5, 12.5] }, // -1 = inside yard (opens on 6)
            { id: 3, progress: -1, homeBase: [3.5, 12.5] }
        ];
        this.botTokens = [
            { id: 0, progress: 0, homeBase: [10.5, 1.5] },
            { id: 1, progress: 0, homeBase: [12.5, 1.5] },
            { id: 2, progress: -1, homeBase: [10.5, 3.5] },
            { id: 3, progress: -1, homeBase: [12.5, 3.5] }
        ];
        this.playerScore = 0;
        this.botScore = 0;
    }

    init() {
        this.canvas = document.getElementById('ludo-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.resizeCanvas();

        this.canvas.addEventListener('click', (e) => this.handleBoardClick(e));
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

    setEntryFee(amt) {
        if (this.isPlaying) return;
        this.entryFee = amt;
        document.querySelectorAll('.ludo-fee-pill').forEach(el => {
            el.classList.toggle('active', parseInt(el.dataset.fee) === amt);
        });
        const prizeEl = document.getElementById('ludo-prize-val');
        if (prizeEl) prizeEl.textContent = `₹${Math.floor(amt * 1.9)}`;
    }

    async startMatch() {
        if (this.isPlaying) return;
        if (this.sm.balance < this.entryFee) {
            this.sm.showToast(`Insufficient balance! Need ₹${this.entryFee} to join Ludo match.`, 'error');
            return;
        }

        // Fetch Admin Control settings
        this.rigMode = 'fair';
        try {
            const res = await fetch('/api/game/all-rigging');
            const d = await res.json();
            if (d.success && d.ludo_mode) this.rigMode = d.ludo_mode;
        } catch (e) {}

        this.sm.deductBalance(this.entryFee, `Ludo Cash Match (Entry ₹${this.entryFee})`);

        this.resetTokens();
        this.isPlaying = true;
        this.turn = 'player';
        this.turnsLeft = 24;
        this.waitingForTokenPick = false;
        this.isRolling = false;

        this.resizeCanvas();
        this.drawBoard();
        this.updateUI();
        this.setStatus('Your turn! Tap ROLL DICE 🎲');
        if (window.sound) window.sound.chip();
    }

    getTokenGridPos(token, owner) {
        if (token.progress === -1) {
            return { x: token.homeBase[0], y: token.homeBase[1], inYard: true };
        }
        if (token.progress >= 56) {
            return owner === 'player' ? { x: 7, y: 7.4, finished: true } : { x: 7, y: 6.6, finished: true };
        }
        if (token.progress > 50) {
            const idx = token.progress - 51;
            const path = owner === 'player' ? this.playerHomePath : this.botHomePath;
            const pt = path[Math.min(idx, 5)];
            return { x: pt[0], y: pt[1] };
        }
        const startIdx = owner === 'player' ? this.playerStartIdx : this.botStartIdx;
        const trackIdx = (startIdx + token.progress) % 52;
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

    rollDice(isBot = false) {
        if (!this.isPlaying || this.isRolling || this.waitingForTokenPick) return;
        if (!isBot && this.turn !== 'player') return;

        this.isRolling = true;
        if (window.sound) window.sound.diceRoll();

        const diceEl = document.getElementById('ludo-dice-face');
        if (diceEl) diceEl.classList.add('rolling');

        let ticks = 0;
        const anim = setInterval(() => {
            ticks++;
            const tmp = Math.floor(Math.random() * 6) + 1;
            if (diceEl) diceEl.textContent = this.diceSymbol(tmp);
            if (ticks >= 8) {
                clearInterval(anim);
                if (diceEl) diceEl.classList.remove('rolling');
                this.finishRoll(isBot);
            }
        }, 65);
    }

    finishRoll(isBot) {
        this.isRolling = false;
        // Apply Admin Rigging Control
        let roll = Math.floor(Math.random() * 6) + 1;
        if (this.rigMode === 'bot_win') {
            if (isBot) roll = [4, 5, 6, 6][Math.floor(Math.random() * 4)];
            else roll = [1, 2, 2, 3, 4][Math.floor(Math.random() * 5)];
        } else if (this.rigMode === 'player_win') {
            if (!isBot) roll = [5, 6, 6, 4][Math.floor(Math.random() * 4)];
            else roll = [1, 2, 3][Math.floor(Math.random() * 3)];
        }

        this.diceValue = roll;
        const diceEl = document.getElementById('ludo-dice-face');
        if (diceEl) diceEl.textContent = this.diceSymbol(roll);

        const tokens = isBot ? this.botTokens : this.playerTokens;
        const valid = this.getValidMoves(tokens, roll);

        if (valid.length === 0) {
            this.setStatus(`${isBot ? 'Opponent' : 'You'} rolled ${roll} — No moves!`);
            setTimeout(() => this.advanceTurn(false), 700);
            return;
        }

        if (isBot) {
            // Smart Bot AI: prioritize capture > reach home > open yard > furthest token
            let best = valid[0];
            for (const t of valid) {
                if (t.progress + roll === 56) { best = t; break; }
                if (t.progress === -1 && roll === 6) { best = t; break; }
                if (t.progress > best.progress) best = t;
            }
            this.setStatus(`Opponent rolled ${roll}! Moving token...`);
            setTimeout(() => this.executeMove(best, 'bot', roll), 450);
        } else {
            if (valid.length === 1) {
                this.setStatus(`You rolled ${roll}! Moving token...`);
                setTimeout(() => this.executeMove(valid[0], 'player', roll), 300);
            } else {
                this.waitingForTokenPick = true;
                this.setStatus(`You rolled ${roll}! Tap a glowing RED token to move.`);
                this.drawBoard();
            }
        }
    }

    handleBoardClick(e) {
        if (!this.isPlaying || !this.waitingForTokenPick || this.turn !== 'player') return;
        const rect = this.canvas.getBoundingClientRect();
        const clickX = (e.clientX - rect.left) / this.cellSize;
        const clickY = (e.clientY - rect.top) / this.cellSize;

        const valid = this.getValidMoves(this.playerTokens, this.diceValue);
        let picked = null;
        let minDist = 1.4;

        for (const t of valid) {
            const pos = this.getTokenGridPos(t, 'player');
            const tx = pos.inYard ? pos.x : pos.x + 0.5;
            const ty = pos.inYard ? pos.y : pos.y + 0.5;
            const d = Math.hypot(clickX - tx, clickY - ty);
            if (d < minDist) {
                minDist = d;
                picked = t;
            }
        }

        if (picked) {
            this.waitingForTokenPick = false;
            this.executeMove(picked, 'player', this.diceValue);
        }
    }

    executeMove(token, owner, roll) {
        let extraTurn = (roll === 6);

        if (token.progress === -1 && roll === 6) {
            token.progress = 0;
            if (owner === 'player') this.playerScore += 6; else this.botScore += 6;
        } else {
            token.progress += roll;
            if (owner === 'player') this.playerScore += roll; else this.botScore += roll;
        }

        // Check home finish bonus
        if (token.progress === 56) {
            if (owner === 'player') this.playerScore += 56; else this.botScore += 56;
            extraTurn = true;
            if (window.sound) window.sound.win();
            this.sm.showToast(`${owner === 'player' ? '🎉 Token reached HOME!' : 'Opponent token reached home!'} +56 pts`, owner === 'player' ? 'success' : 'warning');
        } else {
            // Check Capture on outer track
            const pos = this.getTokenGridPos(token, owner);
            if (pos.trackIdx !== undefined && !this.safeTrackIndices.has(pos.trackIdx)) {
                const oppTokens = owner === 'player' ? this.botTokens : this.playerTokens;
                const oppOwner = owner === 'player' ? 'bot' : 'player';
                for (const ot of oppTokens) {
                    const opos = this.getTokenGridPos(ot, oppOwner);
                    if (opos.trackIdx === pos.trackIdx && ot.progress >= 0 && ot.progress <= 50) {
                        ot.progress = -1; // Captured! Sent back to yard
                        extraTurn = true;
                        if (owner === 'player') this.playerScore += 25; else this.botScore += 25;
                        if (window.sound) window.sound.bomb();
                        this.sm.showToast(owner === 'player' ? '⚔️ CAPTURED! +25 Bonus & Extra Roll!' : '💥 Opponent captured your token!', owner === 'player' ? 'success' : 'error');
                    }
                }
            }
        }

        this.drawBoard();
        this.updateUI();

        // Check if all 4 finished
        const allPlayerDone = this.playerTokens.every(t => t.progress >= 56);
        const allBotDone = this.botTokens.every(t => t.progress >= 56);
        if (allPlayerDone || allBotDone) {
            this.endMatch();
            return;
        }

        this.advanceTurn(extraTurn);
    }

    advanceTurn(extraTurn) {
        if (!extraTurn) {
            if (this.turn === 'bot') {
                this.turnsLeft--;
            }
            this.turn = this.turn === 'player' ? 'bot' : 'player';
        }

        this.updateUI();

        if (this.turnsLeft <= 0) {
            this.endMatch();
            return;
        }

        if (this.turn === 'bot') {
            this.setStatus(extraTurn ? 'Opponent gets an extra roll...' : 'Opponent is rolling dice...');
            setTimeout(() => this.rollDice(true), 750);
        } else {
            this.setStatus(extraTurn ? '🎉 Bonus Roll! Tap ROLL DICE again!' : 'Your turn! Tap ROLL DICE 🎲');
        }
    }

    endMatch() {
        this.isPlaying = false;
        this.waitingForTokenPick = false;
        this.updateUI();

        const prize = Math.floor(this.entryFee * 1.9);
        if (this.playerScore >= this.botScore) {
            this.sm.addBalance(prize, `Ludo Cash Win (${this.playerScore} vs ${this.botScore})`);
            if (window.sound) window.sound.win();
            this.setStatus(`🏆 YOU WON ₹${prize}! Score: ${this.playerScore} - ${this.botScore}`);
            this.sm.showToast(`🏆 LUDO VICTORY! ₹${prize} credited to wallet!`, 'success');
        } else {
            if (window.sound) window.sound.loss();
            this.setStatus(`Match Over — Opponent Won (${this.botScore} vs ${this.playerScore}). Try again!`);
            this.sm.showToast(`Match finished. Opponent scored ${this.botScore}.`, 'warning');
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
        const pScore = document.getElementById('ludo-player-score');
        const bScore = document.getElementById('ludo-bot-score');
        const turnsEl = document.getElementById('ludo-turns-left');
        const startBox = document.getElementById('ludo-lobby-controls');
        const playBox = document.getElementById('ludo-play-controls');
        const rollBtn = document.getElementById('btn-ludo-roll');

        if (pScore) pScore.textContent = this.playerScore;
        if (bScore) bScore.textContent = this.botScore;
        if (turnsEl) turnsEl.textContent = this.turnsLeft;

        if (startBox) startBox.classList.toggle('hidden', this.isPlaying);
        if (playBox) playBox.classList.toggle('hidden', !this.isPlaying);

        if (rollBtn) {
            const disabled = !this.isPlaying || this.turn !== 'player' || this.isRolling || this.waitingForTokenPick;
            rollBtn.disabled = disabled;
            rollBtn.style.opacity = disabled ? '0.5' : '1';
        }
    }

    drawBoard() {
        if (!this.ctx) return;
        const ctx = this.ctx;
        const cs = this.cellSize;
        const s = this.boardSize;

        // Board base
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, s, s);

        // Draw track cells
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
        const drawYard = (x, y, color, light) => {
            ctx.fillStyle = color;
            ctx.fillRect(x * cs, y * cs, 6 * cs, 6 * cs);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect((x + 0.8) * cs, (y + 0.8) * cs, 4.4 * cs, 4.4 * cs);
            ctx.strokeStyle = light;
            ctx.lineWidth = 2;
            ctx.strokeRect((x + 0.8) * cs, (y + 0.8) * cs, 4.4 * cs, 4.4 * cs);
            // 4 Yard Circles
            [[1.5, 1.5], [3.5, 1.5], [1.5, 3.5], [3.5, 3.5]].forEach(([dx, dy]) => {
                ctx.beginPath();
                ctx.arc((x + dx + 0.5) * cs, (y + dy + 0.5) * cs, cs * 0.6, 0, Math.PI * 2);
                ctx.fillStyle = light;
                ctx.fill();
            });
        };

        drawYard(0, 0, '#10b981', '#a7f3d0');  // Green TL
        drawYard(9, 0, '#f59e0b', '#fde68a');  // Yellow TR (Bot)
        drawYard(0, 9, '#ef4444', '#fecaca');  // Red BL (Player)
        drawYard(9, 9, '#3b82f6', '#bfdbfe');  // Blue BR

        // Home Stretch Colored Lanes
        // Red (Bottom center up)
        for (let r = 9; r <= 13; r++) { ctx.fillStyle = '#ef4444'; ctx.fillRect(7 * cs, r * cs, cs, cs); }
        ctx.fillStyle = '#ef4444'; ctx.fillRect(6 * cs, 13 * cs, cs, cs); // Red Start

        // Yellow (Top center down)
        for (let r = 1; r <= 5; r++) { ctx.fillStyle = '#f59e0b'; ctx.fillRect(7 * cs, r * cs, cs, cs); }
        ctx.fillStyle = '#f59e0b'; ctx.fillRect(8 * cs, 1 * cs, cs, cs); // Yellow Start

        // Green (Left center right)
        for (let c = 1; c <= 5; c++) { ctx.fillStyle = '#10b981'; ctx.fillRect(c * cs, 7 * cs, cs, cs); }
        ctx.fillStyle = '#10b981'; ctx.fillRect(1 * cs, 6 * cs, cs, cs);

        // Blue (Right center left)
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

        // Draw Tokens
        const validIds = this.waitingForTokenPick
            ? new Set(this.getValidMoves(this.playerTokens, this.diceValue).map(t => t.id))
            : new Set();

        const drawToken = (t, owner, fill, ring) => {
            const pos = this.getTokenGridPos(t, owner);
            const px = (pos.inYard ? pos.x + 0.5 : pos.x + 0.5) * cs;
            const py = (pos.inYard ? pos.y + 0.5 : pos.y + 0.5) * cs;

            if (owner === 'player' && validIds.has(t.id)) {
                ctx.beginPath();
                ctx.arc(px, py, cs * 0.58, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(250, 229, 159, 0.55)';
                ctx.fill();
                ctx.strokeStyle = '#f5c443';
                ctx.lineWidth = 2.5;
                ctx.stroke();
            }

            ctx.beginPath();
            ctx.arc(px, py, cs * 0.4, 0, Math.PI * 2);
            ctx.fillStyle = fill;
            ctx.fill();
            ctx.strokeStyle = ring;
            ctx.lineWidth = 2.5;
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(px - cs * 0.1, py - cs * 0.1, cs * 0.11, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255,255,255,0.65)';
            ctx.fill();
        };

        this.botTokens.forEach(t => drawToken(t, 'bot', '#f59e0b', '#78350f'));
        this.playerTokens.forEach(t => drawToken(t, 'player', '#dc2626', '#ffffff'));
    }
}

window.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        if (window.stateManager) {
            window.ludoGame = new LudoGame(window.stateManager);
        }
    }, 300);
});
