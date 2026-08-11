const express = require('express');
const cors = require('cors');
const config = require('./config');
const { connectDB } = require('./db');
const tradeStore = require('./services/tradeStore');
const { initTelegramBot } = require('./bot/telegram');
const angelOne = require('./services/angelOne');

const app = express();

app.use(express.json());
app.use(cors());

// --- REST API ENDPOINTS ---

/**
 * GET /health
 * Application health check
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    tradingMode: config.tradingMode,
    timestamp: new Date().toISOString(),
    env: config.nodeEnv,
  });
});

/**
 * GET /api/trades
 * Retrieve list of trades
 */
app.get('/api/trades', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '50', 10);
    const trades = await tradeStore.find(limit);
    res.json({ success: true, count: trades.length, data: trades });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/trades/:id
 * Fetch single trade record
 */
app.get('/api/trades/:id', async (req, res) => {
  try {
    const trade = await tradeStore.findById(req.params.id);
    if (!trade) {
      return res.status(404).json({ success: false, message: 'Trade record not found' });
    }
    res.json({ success: true, data: trade });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/trades/:id/confirm
 * Manually trigger order confirmation via API
 */
app.post('/api/trades/:id/confirm', async (req, res) => {
  try {
    const trade = await tradeStore.findById(req.params.id);
    if (!trade) {
      return res.status(404).json({ success: false, message: 'Trade record not found' });
    }

    if (trade.status !== 'ANALYZED') {
      return res.status(400).json({
        success: false,
        message: `Trade cannot be confirmed because current status is '${trade.status}'`,
      });
    }

    // Resolve scrip & place order
    const scripInfo = await angelOne.searchScrip(trade.symbol, 'NSE');
    const orderResult = await angelOne.placeOrder({
      tradingsymbol: scripInfo.tradingsymbol,
      symboltoken: scripInfo.symboltoken,
      transactiontype: trade.action,
      quantity: trade.quantity,
      price: trade.entry,
      orderType: 'LIMIT',
      productType: 'DELIVERY',
      exchange: 'NSE',
    });

    if (orderResult.success) {
      trade.status = 'ORDER_PLACED';
      trade.angelOrderId = orderResult.orderId;
      await trade.save();
      return res.json({ success: true, message: 'Order placed successfully', data: trade });
    } else {
      trade.status = 'REJECTED';
      await trade.save();
      return res.status(400).json({ success: false, message: orderResult.message, data: trade });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/trades/:id/cancel
 * Cancel a trade record
 */
app.post('/api/trades/:id/cancel', async (req, res) => {
  try {
    const trade = await tradeStore.findById(req.params.id);
    if (!trade) {
      return res.status(404).json({ success: false, message: 'Trade record not found' });
    }

    if (trade.angelOrderId && trade.status === 'ORDER_PLACED') {
      await angelOne.cancelOrder(trade.angelOrderId);
    }

    trade.status = 'CANCELLED';
    await trade.save();

    res.json({ success: true, message: 'Trade cancelled', data: trade });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/trades/:id/status
 * Get order status from broker
 */
app.get('/api/trades/:id/status', async (req, res) => {
  try {
    const trade = await tradeStore.findById(req.params.id);
    if (!trade) {
      return res.status(404).json({ success: false, message: 'Trade record not found' });
    }

    if (!trade.angelOrderId) {
      return res.json({ success: true, status: trade.status, brokerStatus: null });
    }

    const brokerStatus = await angelOne.getOrderStatus(trade.angelOrderId);
    res.json({
      success: true,
      tradeId: trade._id,
      status: trade.status,
      angelOrderId: trade.angelOrderId,
      brokerStatus,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/dashboard
 * Performance Dashboard Summary
 */
app.get('/api/dashboard', async (req, res) => {
  try {
    const trades = await tradeStore.find(1000);
    const totalTrades = trades.length;
    const executedTrades = trades.filter(t => t.status === 'ORDER_PLACED' || t.status === 'COMPLETED').length;
    const rejectedTrades = trades.filter(t => t.status === 'REJECTED' || t.status === 'CANCELLED').length;

    const avgDecisionScore = totalTrades > 0
      ? Math.round(trades.reduce((sum, t) => sum + (t.decision?.score || 0), 0) / totalTrades)
      : 0;

    const avgFundamentalScore = totalTrades > 0
      ? Math.round(trades.reduce((sum, t) => sum + (t.fundamentals?.score || 0), 0) / totalTrades)
      : 0;

    res.json({
      success: true,
      data: {
        tradingMode: config.tradingMode,
        accountCapital: config.risk.accountCapital,
        totalTrades,
        executedTrades,
        rejectedTrades,
        avgDecisionScore,
        avgFundamentalScore,
        autoExecuteEnabled: config.telegram.autoExecute,
        targetChannel: config.telegram.targetChannel || 'ALL',
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// --- SERVER INITIALIZATION ---

async function startServer() {
  const warnings = config.validate();

  console.log('\n=============================================================');
  console.log('       TELEGRAM STOCK TRADING ASSISTANT SERVER             ');
  console.log('=============================================================');
  console.log(` Mode:           [ ${config.tradingMode} TRADING ]`);
  console.log(` Environment:    ${config.nodeEnv}`);
  console.log(` Port:           ${config.port}`);
  console.log(` Capital:        ₹${config.risk.accountCapital}`);
  console.log(` Risk per trade: ${config.risk.riskPerTrade * 100}%`);
  console.log(` ATR Multiplier: ${config.risk.atrMultiplier}x`);
  console.log('-------------------------------------------------------------');

  if (config.tradingMode === 'LIVE') {
    console.log('\x1b[31m%s\x1b[0m', ' ⚠️  WARNING: LIVE TRADING MODE IS ACTIVE!');
    console.log('\x1b[31m%s\x1b[0m', ' Real capital will be used for Angel One orders upon explicit Telegram confirmation.');
  } else {
    console.log('\x1b[32m%s\x1b[0m', ' 📝 PAPER TRADING MODE ACTIVE: Simulated orders only.');
  }

  if (warnings.length > 0) {
    console.log('\nConfiguration Notices:');
    warnings.forEach(w => console.log(` - ⚠️  ${w}`));
  }
  console.log('=============================================================\n');

  // Connect MongoDB
  await connectDB();

  // Start Telegram Listener
  if (config.nodeEnv !== 'test') {
    initTelegramBot();
  }

  // Start Express HTTP Server
  const server = app.listen(config.port, () => {
    console.log(`[Express] HTTP Server running on http://localhost:${config.port}`);
  });

  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = app;
