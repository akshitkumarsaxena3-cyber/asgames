// AS King Live Number & Matka Engine (Faridabad, Gaziabad, Gali, Disawar + Local AS GAMES)
// Single Digit / Haruf (Andar / Bahar) = 1 ka 9 (9x Return) | Jodi (00 - 99) = 1 ka 90 (90x Return)

class ASKingGame {
    constructor(stateManager) {
        this.sm = stateManager;
        this.selectedMarket = 'asgames';
        this.betType = 'bahar'; // 'bahar' (Single 0-9 -> 9x) | 'andar' (Single 0-9 -> 9x) | 'jodi' (00-99 -> 90x)
        this.selectedNumber = '5';
        this.betAmount = 50;
        this.markets = [];
        this.myBets = [];
        this.pollTimer = null;
        this.init();
    }

    init() {
        this.renderNumberPicker();
        this.updatePayoutPreview();
        this.fetchMarkets();
        this.pollTimer = setInterval(() => {
            if (window.isGameScreenOpen && window.isGameScreenOpen('king')) {
                this.fetchMarkets();
            }
        }, 12000);
    }

    async fetchMarkets() {
        try {
            const headers = {};
            if (this.sm && this.sm.token) headers['Authorization'] = `Bearer ${this.sm.token}`;
            const res = await fetch('/api/king/markets', { headers });
            const d = await res.json();
            if (!d.success) return;
            this.markets = d.markets || [];
            this.myBets = d.my_bets || [];
            this.renderMarketsBoard();
            this.renderMyBets();
        } catch (e) {}
    }

    selectMarket(key) {
        this.selectedMarket = key;
        this.renderMarketsBoard();
        this.updatePayoutPreview();
        if (window.sound) window.sound.click('king');
    }

    setBetType(type) {
        this.betType = type;
        document.querySelectorAll('.king-type-pill').forEach(el => {
            el.classList.toggle('active', el.dataset.ktype === type);
        });
        if (type === 'jodi') {
            this.selectedNumber = '47';
        } else {
            this.selectedNumber = '5';
        }
        this.renderNumberPicker();
        this.updatePayoutPreview();
        if (window.sound) window.sound.click('king');
    }

    selectDigit(val) {
        this.selectedNumber = String(val);
        const inp = document.getElementById('king-jodi-input');
        if (inp) inp.value = this.selectedNumber;
        document.querySelectorAll('.king-digit-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.digit === this.selectedNumber);
        });
        this.updatePayoutPreview();
        if (window.sound) window.sound.click('king');
    }

    setBetAmount(amt) {
        this.betAmount = Math.max(10, parseFloat(amt) || 10);
        const inp = document.getElementById('king-amount-input');
        if (inp) inp.value = this.betAmount;
        document.querySelectorAll('.king-amt-pill').forEach(b => {
            b.classList.toggle('active', parseInt(b.dataset.kamt, 10) === this.betAmount);
        });
        this.updatePayoutPreview();
        if (window.sound) window.sound.click('king');
    }

    updatePayoutPreview() {
        const inp = document.getElementById('king-amount-input');
        const amt = parseFloat(inp?.value || this.betAmount) || 0;
        this.betAmount = amt;
        const mult = this.betType === 'jodi' ? 90 : 9;
        const winEl = document.getElementById('king-potential-win');
        const mkLbl = document.getElementById('king-selected-mk-lbl');
        if (winEl) winEl.textContent = `₹${(amt * mult).toLocaleString('en-IN')} (${mult}x — 1 ka ${mult})`;
        if (mkLbl) {
            const mk = this.markets.find(m => m.key === this.selectedMarket);
            mkLbl.textContent = mk ? mk.name : this.selectedMarket.toUpperCase();
        }
    }

    renderMarketsBoard() {
        const board = document.getElementById('king-markets-board');
        if (!board) return;
        const list = this.markets.length > 0 ? this.markets : [
            { key: 'asgames', name: 'AS GAMES', time: 'Live 24/7', is_local: true, old_num: '47', new_num: '83' },
            { key: 'faridabad', name: 'FARIDABAD', time: '06:15 PM', is_local: false, old_num: '62', new_num: '--' },
            { key: 'gaziabad', name: 'GAZIABAD', time: '08:40 PM', is_local: false, old_num: '19', new_num: '--' },
            { key: 'gali', name: 'GALI', time: '11:30 PM', is_local: false, old_num: '74', new_num: '--' },
            { key: 'disawar', name: 'DISAWAR', time: '05:10 AM', is_local: false, old_num: '35', new_num: '--' }
        ];

        board.innerHTML = list.map(m => {
            const active = m.key === this.selectedMarket;
            const localTag = m.is_local ? `<span class="king-local-tag">👑 LOCAL VIP</span>` : `<span class="king-net-tag">🌐 LIVE NET</span>`;
            const newDisp = (m.new_num && m.new_num !== '--') ? m.new_num : '⏳';
            return `
                <div class="king-mk-card ${active ? 'active' : ''}" onclick="window.kingGame.selectMarket('${m.key}')">
                    <div class="king-mk-top">
                        <div>
                            <div class="king-mk-name">${m.name}</div>
                            <div class="king-mk-time">${m.time || ''}</div>
                        </div>
                        ${localTag}
                    </div>
                    <div class="king-mk-nums">
                        <span class="king-num-old">${m.old_num || '--'}</span>
                        <span class="king-num-arrow">➜</span>
                        <span class="king-num-new">${newDisp}</span>
                    </div>
                </div>
            `;
        }).join('');
    }

    renderNumberPicker() {
        const wrap = document.getElementById('king-picker-area');
        if (!wrap) return;
        if (this.betType === 'jodi') {
            const hotJodis = ['07', '14', '23', '38', '47', '56', '69', '74', '83', '92'];
            wrap.innerHTML = `
                <div style="font-size:11.5px; color:#cbd5e1; margin-bottom:8px;">Enter 2-Digit Jodi Number (00 to 99) — <strong style="color:#fae59f;">1 ka 90 (90x)</strong>:</div>
                <input type="text" id="king-jodi-input" maxlength="2" class="rg-input" style="text-align:center; font-size:22px; font-weight:900; letter-spacing:4px; color:#fae59f; margin-bottom:10px;" value="${this.selectedNumber}" placeholder="00 - 99" oninput="window.kingGame.selectedNumber = this.value.replace(/\\D/g,'').slice(0,2); this.value = window.kingGame.selectedNumber;">
                <div style="font-size:10.5px; color:#94a3b8; margin-bottom:6px;">Quick Popular Jodis:</div>
                <div class="king-digits-grid">
                    ${hotJodis.map(n => `<button type="button" class="king-digit-btn ${this.selectedNumber === n ? 'active' : ''}" data-digit="${n}" onclick="window.kingGame.selectDigit('${n}')">${n}</button>`).join('')}
                </div>
            `;
        } else {
            const label = this.betType === 'andar' ? 'Andar (1st Digit 0–9)' : 'Bahar (Last Digit 0–9)';
            wrap.innerHTML = `
                <div style="font-size:11.5px; color:#cbd5e1; margin-bottom:8px;">Pick ${label} — <strong style="color:#10b981;">1 ka 9 (9x Return!)</strong>:</div>
                <div class="king-digits-grid">
                    ${[0,1,2,3,4,5,6,7,8,9].map(d => `<button type="button" class="king-digit-btn ${String(d) === this.selectedNumber ? 'active' : ''}" data-digit="${d}" onclick="window.kingGame.selectDigit('${d}')">${d}</button>`).join('')}
                </div>
            `;
        }
    }

    async placeBet() {
        if (!this.sm || !this.sm.token) {
            this.sm.showToast('Please login first to place a bet!', 'warning');
            if (typeof openAuthModal === 'function') openAuthModal('login');
            return;
        }
        const amt = parseFloat(document.getElementById('king-amount-input')?.value || this.betAmount) || 0;
        if (amt < 10) {
            this.sm.showToast('Minimum bet is ₹10!', 'warning');
            return;
        }
        if (this.sm.balance < amt) {
            this.sm.showToast('Insufficient balance! Please deposit.', 'error');
            return;
        }
        const num = this.betType === 'jodi'
            ? (document.getElementById('king-jodi-input')?.value || this.selectedNumber).trim()
            : this.selectedNumber;

        try {
            const res = await fetch('/api/king/bet', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.sm.token}`
                },
                body: JSON.stringify({
                    market: this.selectedMarket,
                    bet_type: this.betType,
                    number: num,
                    amount: amt
                })
            });
            const d = await res.json();
            if (!d.success) {
                this.sm.showToast(d.message || 'Bet failed', 'error');
                return;
            }
            if (typeof d.balance === 'number') this.sm.setLocalBalance(d.balance, 'down');
            if (this.sm.recordGameHistory) {
                const mult = this.betType === 'jodi' ? 90 : 9;
                this.sm.recordGameHistory({
                    id: d.bet?.id || ('KB' + Date.now()),
                    game: 'AS King',
                    detail: `${this.selectedMarket.toUpperCase()} • ${this.betType.toUpperCase()} ${num} (${mult}x)`,
                    bet_amount: amt,
                    win_amount: 0,
                    status: 'Pending'
                });
            }
            if (window.sound) window.sound.chip('king');
            this.sm.showToast(d.message, 'success');
            this.fetchMarkets();
        } catch (e) {
            this.sm.showToast('Network error placing bet.', 'error');
        }
    }

    renderMyBets() {
        const el = document.getElementById('king-mybets-list');
        if (!el) return;
        if (!this.myBets || this.myBets.length === 0) {
            el.innerHTML = `<div style="text-align:center; color:#71717a; font-size:12px; padding:18px;">No AS King bets yet. Pick a market &amp; number above!</div>`;
            return;
        }
        el.innerHTML = this.myBets.slice(0, 20).map(b => {
            const st = String(b.status || 'pending').toLowerCase();
            const clr = st === 'won' ? '#10b981' : (st === 'lost' ? '#ef4444' : '#f59e0b');
            const valTxt = st === 'won' ? `+₹${parseFloat(b.win_amount || 0).toFixed(2)}` : (st === 'lost' ? `-₹${parseFloat(b.amount || 0).toFixed(2)}` : 'PENDING');
            return `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:9px 6px; border-bottom:1px solid rgba(255,255,255,0.06);">
                    <div>
                        <div style="color:#fae59f; font-weight:800; font-size:12.5px;">${String(b.market).toUpperCase()} • ${String(b.bet_type).toUpperCase()} [${b.number}]</div>
                        <div style="color:#94a3b8; font-size:11px;">Bet: ₹${b.amount} (${b.multiplier || 9}x)${b.result_num ? ` • Result: <strong>${b.result_num}</strong>` : ''}</div>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-size:12.5px; font-weight:800; color:${clr};">${valTxt}</div>
                        <div style="font-size:10px; color:#71717a;">${(b.created_at || '').replace('T', ' ').slice(5, 16)}</div>
                    </div>
                </div>
            `;
        }).join('');
    }
}

window.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        if (window.stateManager) {
            window.kingGame = new ASKingGame(window.stateManager);
        }
    }, 350);
});
