# 👑 ASGames - Full-Stack Color Prediction, Lottery & Gaming Platform

A complete, production-ready, full-stack **Color Prediction, Lottery, Aviator, Mines & K3 Gaming Platform** built with high-performance responsive UI, real User Authentication, a 3-Tier Referral Affiliate Network, and an advanced **Super Admin Control Center** with live outcome rigging and house-edge optimization!

---

## 🌟 Major Highlights & Modules

### 1. 👥 User Authentication (Login & Register)
- **Mobile Number & Password Login**.
- **Registration with Referral / Invite Code** (e.g. `ASG84920`).
- Auto-fills referral code from shareable invitation links (`?r=ASG...`).
- ₹100 Welcome Signup Bonus credited automatically upon registration.
- Persistent session authentication tokens.

### 2. 💰 3-Tier Referral Affiliate Network ("Get ₹500" Promotion)
- Every user gets a unique **Invitation Code** and 1-click shareable invite link.
- **3 Tiers of Perpetual Turnover Rebates**:
  - 🥇 **Tier 1 (Direct Subordinates):** **0.6%** commission on all betting turnover.
  - 🥈 **Tier 2 (Level 2 Subordinates):** **0.18%** commission.
  - 🥉 **Tier 3 (Level 3 Subordinates):** **0.05%** commission.
- **Live Team Statistics**:
  - Live count of Tier 1, Tier 2, and Tier 3 subordinates.
  - Total Team Turnover tracker.
  - Live Unclaimed Commission counter with **1-Click "Claim Cash"** button that transfers earned commissions straight into wallet balance!
  - List of joined team members with registration dates.

### 3. ⚙️ Super Admin Control Center (`/admin`)
- Secure password-protected dashboard (Default password: `admin123`).
- **🎮 Win Go Live Command & Outcome Rigging**:
  - **Live Bet Board**: Real-time wager distribution on Green, Violet, Red, Big, Small, and Numbers 0–9.
  - **1-Click Manual Outcome Force**: Click any number (0 to 9) to force the next round to land on that number!
  - **📉 Smart House-Edge Mode**: Automatically tests all possible numbers (0–9) and selects the number that results in the lowest total payout, guaranteeing maximum platform profit!
  - **🎲 Fair Random RNG Mode**: Pure unbiased random lottery draw.
- **👥 Player Database Manager**:
  - View all registered players, phone numbers, wallet balances, invite codes, and referral uplines.
  - **Add or Deduct Balance (+/- ₹)** with reason.
  - **1-Click Ban / Unban** player accounts.
- **💳 Finance Approval Queue**:
  - **Pending Deposits Queue**: Verify 12-digit UTR / transaction details -> 1-Click "Approve" (auto-credits user balance) or "Reject".
  - **Pending Withdrawals Queue**: Verify payout details -> 1-Click "Approve & Paid" or "Reject & Refund" (restores user balance).

### 4. 🎮 Playable Games
1. **Win Go (Color Prediction & Number Lottery)**:
   - Synchronized server clock (30s, 1Min, 3Min, 5Min rounds).
   - Betting on Green (2x/1.5x), Violet (4.5x), Red (2x/1.5x), Numbers 0–9 (9x), Big/Small (2x).
   - Betting freeze overlay in the last 5 seconds.
   - Parity records table, Trend chart, and "My Bets" history.
2. **Aviator (Crash Multiplier Game)**:
   - Soaring jet plane radar with real-time accelerating multiplier (1.00x to 100x+).
   - Place bet & dynamic cashout before takeoff crashes.
3. **Mines (5x5 Gem Hunt)**:
   - 25 tiles with configurable mine counts (1, 3, 5, 10, 24).
   - Uncover emerald diamonds 💎, climb multiplier ladder, avoid bombs 💣.
4. **K3 Dice Lottery**:
   - 3 3D-styled dice in an animated shaker cup.
   - Predict Sum (3–18), Big / Small, Odd / Even.

---

## 🚀 How to Run

### Local Deployment
```bash
# 1. Install dependencies
npm install

# 2. Start server
npm start
# or double click run.bat
```
- Open Player App: `http://localhost:10000`
- Open Super Admin Panel: `http://localhost:10000/admin` (Password: `admin123`)

### Deploy to Render / Cloud
Already configured with `package.json` and `server.js` for instant 1-click deployment on Render, Railway, Heroku, or VPS!
