// ASGames Web Audio Sound Synthesizer
// Zero external asset dependencies - runs completely offline with Web Audio API
// Audio plays ONLY when a specific game view is actively open!

window.isGameScreenOpen = function (gameName) {
    if (gameName) {
        const el = document.getElementById(`game-view-${gameName}`);
        return Boolean(el && !el.classList.contains('hidden'));
    }
    return Boolean(document.querySelector('.game-view:not(.hidden)'));
};

class SoundEffects {
    constructor() {
        this.ctx = null;
        this.enabled = true;
    }

    ensureContext(gameName) {
        if (!this.enabled) return false;
        if (!window.isGameScreenOpen(gameName)) return false;
        if (!this.ctx) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (AudioContext) {
                this.ctx = new AudioContext();
            }
        }
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume().catch(() => {});
        }
        return Boolean(this.ctx);
    }

    suspendIfNoGame() {
        if (this.ctx && !window.isGameScreenOpen() && this.ctx.state === 'running') {
            this.ctx.suspend().catch(() => {});
        }
    }

    toggle() {
        this.enabled = !this.enabled;
        if (!this.enabled && this.ctx && this.ctx.state === 'running') {
            this.ctx.suspend().catch(() => {});
        }
        return this.enabled;
    }

    // Short UI click (only inside open game)
    click(gameName) {
        if (!this.ensureContext(gameName)) return;

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(300, this.ctx.currentTime + 0.05);

        gain.gain.setValueAtTime(0.15, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.05);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.05);
    }

    // Countdown tick
    tick(gameName) {
        if (!this.ensureContext(gameName)) return;

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(880, this.ctx.currentTime);
        gain.gain.setValueAtTime(0.08, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.04);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.04);
    }

    // Urgent countdown beep (last 5 seconds)
    urgentTick(gameName) {
        if (!this.ensureContext(gameName)) return;

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(1046.5, this.ctx.currentTime); // C6
        gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.08);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.08);
    }

    // Bet placed / Chip bet sound
    chip(gameName) {
        if (!this.ensureContext(gameName)) return;

        const now = this.ctx.currentTime;
        [800, 1200].forEach((freq, i) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now + i * 0.04);
            gain.gain.setValueAtTime(0.12, now + i * 0.04);
            gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.04 + 0.06);

            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(now + i * 0.04);
            osc.stop(now + i * 0.04 + 0.06);
        });
    }

    // Win chime / reward sound
    win(gameName) {
        if (!this.ensureContext(gameName)) return;

        const now = this.ctx.currentTime;
        const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
        notes.forEach((freq, idx) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, now + idx * 0.09);

            gain.gain.setValueAtTime(0.25, now + idx * 0.09);
            gain.gain.exponentialRampToValueAtTime(0.01, now + idx * 0.09 + 0.35);

            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(now + idx * 0.09);
            osc.stop(now + idx * 0.09 + 0.35);
        });
    }

    // Big jackpot fanfare
    jackpot(gameName) {
        if (!this.ensureContext(gameName)) return;

        const now = this.ctx.currentTime;
        const chord = [523.25, 659.25, 783.99, 1046.5, 1318.5];
        chord.forEach((freq, idx) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now + idx * 0.06);

            gain.gain.setValueAtTime(0.2, now + idx * 0.06);
            gain.gain.exponentialRampToValueAtTime(0.005, now + 1.2);

            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(now + idx * 0.06);
            osc.stop(now + 1.2);
        });
    }

    // Loss sound (gentle descending tone)
    loss(gameName) {
        if (!this.ensureContext(gameName)) return;

        const now = this.ctx.currentTime;
        const notes = [440, 392, 349.23];
        notes.forEach((freq, idx) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(freq, now + idx * 0.12);

            gain.gain.setValueAtTime(0.1, now + idx * 0.12);
            gain.gain.exponentialRampToValueAtTime(0.01, now + idx * 0.12 + 0.2);

            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(now + idx * 0.12);
            osc.stop(now + idx * 0.12 + 0.2);
        });
    }

    // Gem reveal in Mines
    gem(gameName) {
        if (!this.ensureContext(gameName)) return;

        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(1400, now + 0.15);

        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.2);
    }

    // Mine explosion
    bomb(gameName) {
        if (!this.ensureContext(gameName)) return;

        const now = this.ctx.currentTime;
        // White noise explosion
        const bufferSize = this.ctx.sampleRate * 0.3;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 0.08));
        }
        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(300, now);

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.4, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.ctx.destination);
        noise.start(now);
    }

    // Dice roll shake
    diceRoll(gameName) {
        if (!this.ensureContext(gameName)) return;

        const now = this.ctx.currentTime;
        for (let i = 0; i < 4; i++) {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'square';
            osc.frequency.setValueAtTime(180 + Math.random() * 80, now + i * 0.08);

            gain.gain.setValueAtTime(0.08, now + i * 0.08);
            gain.gain.exponentialRampToValueAtTime(0.005, now + i * 0.08 + 0.05);

            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(now + i * 0.08);
            osc.stop(now + i * 0.08 + 0.05);
        }
    }
}

window.sound = new SoundEffects();
