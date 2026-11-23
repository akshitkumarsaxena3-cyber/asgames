// Invite Wheel / Lucky Spin Turntable - Authentic BDG-Style 8-Slice Canvas Wheel
// Features: Blinking LED Rim Lights, Smooth Spin Physics, Free Spins, Invite Bonus Spins & Cash Out to Wallet

class InviteWheelGame {
    constructor(stateManager) {
        this.sm = stateManager;
        this.canvas = null;
        this.ctx = null;
        this.size = 320;

        // Exact 8 slices matching the luxury Invite Wheel design (max bonus capped at ₹100)
        this.slices = [
            { label: '₹100', min: 100, max: 100, icon: '💵', color: '#fde067', weight: 4 },
            { label: '₹80',  min: 80,  max: 80,  icon: '💵', color: '#fffdf2', weight: 6 },
            { label: '₹50',  min: 50,  max: 50,  icon: '🪙', color: '#fde067', weight: 12 },
            { label: '₹75',  min: 75,  max: 75,  icon: '🪙', color: '#fffdf2', weight: 10 },
            { label: '₹60',  min: 60,  max: 60,  icon: '💵', color: '#fde067', weight: 7 },
            { label: '₹0-10',min: 2,   max: 10,  icon: '🪙', color: '#fffdf2', weight: 28 },
            { label: '₹25',  min: 25,  max: 25,  icon: '🪙', color: '#fde067', weight: 20 },
            { label: '₹35',  min: 35,  max: 35,  icon: '🪙', color: '#fffdf2', weight: 13 }
        ];

        this.rotation = 0; // radians
        this.isSpinning = false;
        this.ledPhase = 0;

        // Persistent user wheel state
        this.wheelAmount = Math.min(100, parseFloat(localStorage.getItem('asg_wheel_amt') || '0'));
        const savedSpins = localStorage.getItem('asg_wheel_spins');
        this.spinsLeft = savedSpins !== null ? parseInt(savedSpins) : 3; // 3 Free Spins for new players!
        this.history = JSON.parse(localStorage.getItem('asg_wheel_hist') || '[]');
        this.cashOutTarget = 100; // Cash out into real wallet at ₹100 (capped at ₹100)

        this.init();
    }

    init() {
        this.canvas = document.getElementById('wheel-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.resizeCanvas();
        this.updateUI();
        this.startLedLoop();
        this.startCountdownTimer();
    }

    resizeCanvas() {
        if (!this.canvas) return;
        const containerW = Math.min(340, (this.canvas.parentElement?.clientWidth || 320) - 8);
        this.size = Math.max(270, containerW);
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = this.size * dpr;
        this.canvas.height = this.size * dpr;
        this.canvas.style.width = this.size + 'px';
        this.canvas.style.height = this.size + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.drawWheel();
    }

    startLedLoop() {
        setInterval(() => {
            this.ledPhase = (this.ledPhase + 1) % 2;
            if (!this.isSpinning) this.drawWheel();
        }, 450);
    }

    startCountdownTimer() {
        let expireTs = parseInt(localStorage.getItem('asg_wheel_expire_ts') || '0', 10);
        const nowTs = Date.now();
        if (!expireTs || expireTs <= nowTs) {
            expireTs = nowTs + (72 * 3600 * 1000) - (33 * 60 * 1000); // ~71:27:00 72-hour window
            localStorage.setItem('asg_wheel_expire_ts', String(expireTs));
        }
        const updateTimer = () => {
            let diff = Math.max(0, Math.floor((expireTs - Date.now()) / 1000));
            if (diff <= 0) {
                expireTs = Date.now() + (72 * 3600 * 1000);
                localStorage.setItem('asg_wheel_expire_ts', String(expireTs));
                diff = 72 * 3600;
            }
            const h = String(Math.floor(diff / 3600)).padStart(2, '0');
            const m = String(Math.floor((diff % 3600) / 60)).padStart(2, '0');
            const s = String(diff % 60).padStart(2, '0');
            const el = document.getElementById('wheel-timer-str');
            if (el) el.textContent = `${h}:${m}:${s}`;
        };
        updateTimer();
        setInterval(updateTimer, 1000);
    }

    pickWeightedSlice() {
        const totalW = this.slices.reduce((acc, s) => acc + s.weight, 0);
        let r = Math.random() * totalW;
        for (let i = 0; i < this.slices.length; i++) {
            r -= this.slices[i].weight;
            if (r <= 0) return i;
        }
        return 5;
    }

    spin() {
        if (this.isSpinning) return;
        if (this.spinsLeft <= 0) {
            this.showInsufficientModal('spin');
            return;
        }

        this.spinsLeft--;
        localStorage.setItem('asg_wheel_spins', String(this.spinsLeft));
        this.isSpinning = true;
        this.updateUI();

        const winIdx = this.pickWeightedSlice();
        const sliceCount = this.slices.length;
        const sliceAngle = (Math.PI * 2) / sliceCount;

        // Pointer is at top (-Math.PI / 2). Calculate exact landing angle for winIdx center.
        const targetSliceCenter = winIdx * sliceAngle + sliceAngle / 2;
        const desiredMod = ((-Math.PI / 2) - targetSliceCenter) % (Math.PI * 2);
        const normalizedTarget = (desiredMod + Math.PI * 2) % (Math.PI * 2);
        const currentMod = ((this.rotation % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

        let delta = normalizedTarget - currentMod;
        if (delta < 0) delta += Math.PI * 2;
        // Add 6 full dramatic spins + tiny random jitter inside the winning slice
        const jitter = (Math.random() - 0.5) * (sliceAngle * 0.55);
        const totalSpin = (Math.PI * 2 * 6) + delta + jitter;

        const startRot = this.rotation;
        const duration = 4200; // 4.2 seconds smooth deceleration
        const startTime = performance.now();
        let lastSliceTick = -1;

        const animate = (now) => {
            const elapsed = now - startTime;
            const t = Math.min(1, elapsed / duration);
            // Quartic ease-out for authentic heavy wheel feel
            const ease = 1 - Math.pow(1 - t, 4);
            this.rotation = startRot + totalSpin * ease;

            // Play tick sound every time a slice passes top pointer
            const currentSlice = Math.floor((((-Math.PI / 2 - this.rotation) % (Math.PI * 2)) + Math.PI * 2) / sliceAngle) % sliceCount;
            if (currentSlice !== lastSliceTick) {
                lastSliceTick = currentSlice;
                if (window.sound && window.sound.tick) window.sound.tick();
            }

            this.drawWheel();

            if (t < 1) {
                requestAnimationFrame(animate);
            } else {
                this.isSpinning = false;
                this.onSpinFinish(winIdx);
            }
        };

        requestAnimationFrame(animate);
    }

    onSpinFinish(winIdx) {
        const slice = this.slices[winIdx];
        const rawPrize = slice.min === slice.max
            ? slice.min
            : Math.floor(slice.min + Math.random() * (slice.max - slice.min + 1));
        const prize = Math.min(100, rawPrize);

        this.wheelAmount = Math.min(100, Math.round((this.wheelAmount + prize) * 100) / 100);
        localStorage.setItem('asg_wheel_amt', String(this.wheelAmount));

        this.history.unshift({
            amount: prize,
            label: slice.label,
            time: new Date().toLocaleTimeString()
        });
        if (this.history.length > 20) this.history.pop();
        localStorage.setItem('asg_wheel_hist', JSON.stringify(this.history));

        this.updateUI();
        if (window.sound && window.sound.win) window.sound.win();
        this.sm.showToast(`🎉 Lucky Wheel Won ₹${prize}.00! Total: ₹${this.wheelAmount.toFixed(2)}`, 'success');
    }

    cashOut() {
        if (this.wheelAmount < this.cashOutTarget) {
            this.showInsufficientModal('cashout');
            return;
        }

        const payout = Math.min(100, this.wheelAmount);
        this.wheelAmount = 0;
        localStorage.setItem('asg_wheel_amt', '0');
        this.sm.addBalance(payout, `Invite Wheel Cash Out (₹${payout.toFixed(2)})`);
        this.updateUI();
        this.sm.showWinModal(payout, 'Invite Wheel Cash Out Credited!');
    }

    showInsufficientModal(mode = 'cashout') {
        const modal = document.getElementById('wheel-insufficient-modal');
        const titleEl = document.getElementById('wheel-insuff-title');
        const msgEl = document.getElementById('wheel-insuff-msg');
        const need = Math.max(0, this.cashOutTarget - this.wheelAmount).toFixed(2);
        if (titleEl) {
            titleEl.textContent = mode === 'spin' ? 'No free spins left' : 'Insufficient amount';
        }
        if (msgEl) {
            msgEl.textContent = mode === 'spin'
                ? `You need ₹${need} more to cash out. Invite friends to get free spins!`
                : `You need ₹${need} more to cash out`;
        }
        if (modal) modal.classList.remove('hidden');
    }

    closeInsufficientModal() {
        const modal = document.getElementById('wheel-insufficient-modal');
        if (modal) modal.classList.add('hidden');
    }

    openInviteFromWheel() {
        this.closeInsufficientModal();
        if (typeof openInvitePosterModal === 'function') {
            openInvitePosterModal(true);
        } else {
            this.claimInviteSpin();
        }
    }

    claimInviteSpin() {
        const inviteCode = this.sm.inviteCode || 'ASG84920';
        const link = `${window.location.origin}/#/register?invitationCode=${inviteCode}`;
        if (navigator.clipboard) {
            navigator.clipboard.writeText(link).catch(() => {});
        }
        // Grant +1 Free Spin on sharing invite link (cooldown 30s to prevent infinite spam)
        const lastClaim = parseInt(localStorage.getItem('asg_wheel_share_ts') || '0');
        if (Date.now() - lastClaim > 30000) {
            this.spinsLeft += 1;
            localStorage.setItem('asg_wheel_spins', String(this.spinsLeft));
            localStorage.setItem('asg_wheel_share_ts', String(Date.now()));
            this.updateUI();
            if (window.sound && window.sound.coin) window.sound.coin();
            this.sm.showToast('🎁 Invite Link Copied! +1 FREE SPIN Added!', 'success');
        } else {
            this.sm.showToast('Invite link copied! Share with friends to earn more spins.', 'info');
        }
    }

    showHistoryAlert() {
        if (this.history.length === 0) {
            alert('No spin records yet! Tap FREE SPIN to win cash.');
            return;
        }
        const lines = this.history.slice(0, 8).map(h => `• +₹${h.amount} (${h.time})`).join('\n');
        alert(`🎡 Recent Spin Winnings:\n\n${lines}`);
    }

    showRulesAlert() {
        alert(
            '🎡 INVITE WHEEL RULES:\n\n' +
            '1. Every player gets 3 FREE SPINS daily.\n' +
            '2. Spin the wheel to win cash up to ₹100 per spin!\n' +
            '3. Reach ₹100 and tap CASH OUT to transfer winnings straight to your main wallet.\n' +
            '4. Share your Invite Link to get extra Free Spins!'
        );
    }

    updateUI() {
        const amtEl = document.getElementById('wheel-my-amount');
        const spinCountEl = document.getElementById('wheel-hub-count');
        const progFill = document.getElementById('wheel-cashout-fill');
        const progText = document.getElementById('wheel-cashout-text');

        if (amtEl) amtEl.textContent = `₹${this.wheelAmount.toFixed(2)}`;
        if (spinCountEl) spinCountEl.textContent = `X${this.spinsLeft}`;

        const pct = Math.min(100, (this.wheelAmount / this.cashOutTarget) * 100);
        if (progFill) progFill.style.width = `${pct}%`;
        if (progText) {
            if (this.wheelAmount >= this.cashOutTarget) {
                progText.textContent = '🎉 Ready! Tap CASH OUT now!';
            } else {
                progText.textContent = `Only ₹${(this.cashOutTarget - this.wheelAmount).toFixed(2)} more to Cash Out ₹${this.cashOutTarget}!`;
            }
        }
    }

    drawWheel() {
        if (!this.ctx) return;
        const ctx = this.ctx;
        const s = this.size;
        const cx = s / 2;
        const cy = s / 2;
        const outerR = s / 2 - 6;
        const rimR = outerR - 14;
        const sliceCount = this.slices.length;
        const sliceAngle = (Math.PI * 2) / sliceCount;

        ctx.clearRect(0, 0, s, s);

        // 1. Outer Metallic Gold Halo Ring
        const outerGrad = ctx.createLinearGradient(0, 0, s, s);
        outerGrad.addColorStop(0, '#fff3b0');
        outerGrad.addColorStop(0.5, '#f59e0b');
        outerGrad.addColorStop(1, '#d97706');
        ctx.beginPath();
        ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
        ctx.fillStyle = outerGrad;
        ctx.fill();

        // 2. Crimson Studded Rim
        ctx.beginPath();
        ctx.arc(cx, cy, outerR - 5, 0, Math.PI * 2);
        ctx.fillStyle = '#e53935';
        ctx.fill();

        // 3. 16 Blinking LED Fairy Lights around Rim
        const numLeds = 16;
        for (let i = 0; i < numLeds; i++) {
            const a = (i / numLeds) * Math.PI * 2;
            const lx = cx + Math.cos(a) * (outerR - 10);
            const ly = cy + Math.sin(a) * (outerR - 10);
            const isLit = (i % 2 === this.ledPhase);

            ctx.beginPath();
            ctx.arc(lx, ly, isLit ? 4.2 : 3.2, 0, Math.PI * 2);
            ctx.fillStyle = isLit ? '#fffbeb' : '#fbbf24';
            if (isLit) {
                ctx.shadowColor = '#fef08a';
                ctx.shadowBlur = 8;
            }
            ctx.fill();
            ctx.shadowBlur = 0;
        }

        // 4. Inner Rotating 8-Slice Turntable
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(this.rotation);

        for (let i = 0; i < sliceCount; i++) {
            const startA = i * sliceAngle;
            const endA = startA + sliceAngle;
            const slice = this.slices[i];

            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.arc(0, 0, rimR, startA, endA);
            ctx.closePath();
            ctx.fillStyle = slice.color;
            ctx.fill();
            ctx.strokeStyle = '#f59e0b';
            ctx.lineWidth = 1.2;
            ctx.stroke();

            // Slice Label & Cash Icon
            ctx.save();
            ctx.rotate(startA + sliceAngle / 2);
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            // Rotate text tangentially so it reads cleanly around the rim like the BDG wheel
            ctx.translate(rimR * 0.74, 0);
            ctx.rotate(Math.PI / 2);
            ctx.fillStyle = '#d9480f';
            ctx.font = `800 ${Math.floor(s * 0.046)}px Poppins, sans-serif`;
            ctx.fillText(slice.label, 0, 0);

            // Cash / Coin Icon slightly inward
            ctx.font = `${Math.floor(s * 0.075)}px sans-serif`;
            ctx.fillText(slice.icon, 0, s * 0.09);
            ctx.restore();
        }
        ctx.restore();

        // 5. Inner Gold Bevel Ring around slices
        ctx.beginPath();
        ctx.arc(cx, cy, rimR, 0, Math.PI * 2);
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 3;
        ctx.stroke();

        // 6. Top Golden Winning Slice Pointer Wedge
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(cx - 14, 4);
        ctx.lineTo(cx + 14, 4);
        ctx.lineTo(cx, 32);
        ctx.closePath();
        const ptrGrad = ctx.createLinearGradient(cx, 4, cx, 32);
        ptrGrad.addColorStop(0, '#fff7cc');
        ptrGrad.addColorStop(1, '#d97706');
        ctx.fillStyle = ptrGrad;
        ctx.fill();
        ctx.strokeStyle = '#b45309';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
    }
}

window.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        if (window.stateManager) {
            window.wheelGame = new InviteWheelGame(window.stateManager);
        }
    }, 350);
});
