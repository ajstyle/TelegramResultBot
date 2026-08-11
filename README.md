# Telegram Stock Trading Assistant 🚀

A modular, production-ready Telegram Stock Trading Assistant built with **Node.js**, **Express**, **MongoDB**, **Telegram Bot API**, **Tesseract OCR**, **Angel One SmartAPI** (supporting PAPER and LIVE trading modes), **Pluggable Fundamentals Engine**, **ATR Risk Engine**, and **Decision Engine**.

---

## 📌 Architecture & Features

```
Telegram Screenshot → Listener → OCR → Signal Parser → Angel One Scrip Lookup → Market Data → Fundamentals Analysis → Risk Engine (ATR SL & Sizing) → Decision Engine → MongoDB Record → Telegram Interactive Confirmation → Angel One Order Placement
```

- **Telegram Listener**: Ingests high-resolution screenshots & text recommendations. Abstracted for easy migration to user-session listeners (Pyrogram/Telethon).
- **Pluggable OCR**: Default implementation powered by `tesseract.js`. Easily swappable with AWS Textract or Google Vision.
- **Signal Parser**: Independent regex parser supporting variations like `BUY TCS @ 3520`, `BUY TCS ENTRY 3520`, `BUY: TCS 3520`, `SELL RELIANCE 1450`.
- **Angel One SmartAPI**: TOTP authentication, dynamic scrip lookup (`TCS` → `TCS-EQ` → `symboltoken`), LTP fetching, historical candle data, order placement, and order status tracking.
- **Pluggable Fundamentals Engine**: Modular adapter returning PE, PB, ROE, ROCE, Debt-to-Equity, Sales/Profit Growth, and a 0–100 scoring system (Strong, Good, Neutral, Weak). Never fabricates missing data.
- **Risk Engine**: 14-period ATR calculation, ATR-based Stop Loss (`Entry ± ATR × Multiplier`), risk-per-trade position sizing (`Quantity = floor((Capital × RiskPerTrade) / RiskPerShare)`).
- **Decision Engine**: Combines OCR confidence, fundamental score, valuation, risk/reward, and ATR into a unified recommendation (`BUY`/`SELL`/`REJECT`) with warning flags.
- **MongoDB Audit Record**: Stores trade state (`ANALYZED`, `CONFIRMED`, `ORDER_PLACED`, `REJECTED`, `CANCELLED`, `COMPLETED`).
- **Explicit Telegram Confirmation**: Renders interactive inline buttons (`[ ✅ CONFIRM BUY ]`, `[ ❌ CANCEL ]`). Orders are **NEVER** placed automatically without explicit user confirmation.
- **Trading Modes**: Defaults to `TRADING_MODE=PAPER` for risk-free simulation. Switch to `TRADING_MODE=LIVE` for real execution.

---

## 🛠️ Quick Start & Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

```bash
cp .env.example .env
```

Edit `.env` to configure your credentials:

```env
# Trading Mode: PAPER or LIVE
TRADING_MODE=PAPER

# MongoDB
MONGODB_URI=mongodb://localhost:27017/telegram_trading_bot

# Telegram
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
AUTHORIZED_TELEGRAM_CHAT_IDS=123456789

# Angel One SmartAPI
ANGEL_API_KEY=your_angel_api_key
ANGEL_CLIENT_CODE=your_angel_client_code
ANGEL_PIN=your_angel_pin
ANGEL_TOTP_SECRET=your_angel_totp_secret

# Risk Engine
ACCOUNT_CAPITAL=100000
RISK_PER_TRADE=0.01
ATR_MULTIPLIER=2
```

### 3. Run Unit Tests

```bash
npm test
```

### 4. Start Server & Telegram Bot

```bash
npm start
```

For development mode with auto-reload:

```bash
npm run dev
```

---

## 📊 Sample Telegram Input & Output

### Input Recommendation Screenshot / Text
```
BUY TCS @ 3520
```

### Generated Telegram Confirmation Message
```
📊 TRADE ANALYSIS 📝 [PAPER MODE]

Stock: TCS
Action: BUY

Entry: ₹3520
LTP: ₹3518

Fundamental Score: 84/100 (Strong)
ATR: ₹48.5

Stop Loss: ₹3423 (ATR Calculated)
Risk/Share: ₹97
Quantity: 10 shares
Confidence: HIGH

⚠️ Order has NOT been placed.
Trade ID: 66bb89a1c92f1b402ef190e4

[ ✅ CONFIRM BUY ]   [ ❌ CANCEL ]
```

---

## 🔌 API Endpoints

- `GET /health` - Health check & current trading mode.
- `GET /api/trades` - List recent trades.
- `GET /api/trades/:id` - Fetch details for a specific trade.
- `POST /api/trades/:id/confirm` - Trigger order placement.
- `POST /api/trades/:id/cancel` - Cancel trade record.
- `GET /api/trades/:id/status` - Fetch live broker order status.

---

## 🔒 Security & Capital Protection

1. **No Automatic Orders**: Every trade requires explicit inline button click in Telegram.
2. **Authorized Chat Validation**: Only Telegram users/chats listed in `AUTHORIZED_TELEGRAM_CHAT_IDS` can confirm trades.
3. **Duplicate Prevention**: Trades transition from `ANALYZED` → `ORDER_PLACED` atomically; duplicate button clicks are blocked.
4. **Secret Protection**: API Keys, PINs, TOTP secrets, and JWT tokens are never logged or sent to Telegram.
