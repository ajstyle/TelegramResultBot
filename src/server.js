const express = require('express');
const cors = require('cors');
const http = require('http');
const https = require('https');
const config = require('./config');
const { connectDB } = require('./db');
const tradeStore = require('./services/tradeStore');
const { initTelegramBot } = require('./bot/telegram');
const angelOne = require('./services/angelOne');
const bseNseMonitor = require('./services/ingestion/bseNseMonitor');

const valuationRouter = require('./api/valuationRouter');
const qualityRouter = require('./api/qualityRouter');
const healthRoutes = require('./api/healthRoutes');
const path = require('path');

const app = express();

app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api/valuation', valuationRouter);
app.use('/valuation', valuationRouter);
app.use('/stocks', valuationRouter);
app.use('/api/quality', qualityRouter);
app.use('/quality', qualityRouter);
app.use('/api/health', healthRoutes);

// Global Exception & Rejection Guard to prevent process termination on Render Cloud
process.on('unhandledRejection', (reason) => {
  console.warn('[Server Guard] Caught unhandled promise rejection:', reason ? (reason.message || reason) : 'Unknown rejection');
});

process.on('uncaughtException', (err) => {
  console.error('[Server Guard] Caught uncaught exception:', err ? err.message : 'Unknown exception');
});

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

// --- SERVER INITIALIZATION & RENDER KEEP-ALIVE ---

function startRenderSelfPing(port) {
  // Periodic 5-minute heartbeat logger and Render Cloud keep-alive ping
  setInterval(() => {
    try {
      const memUsage = Math.round(process.memoryUsage().rss / (1024 * 1024));
      const uptimeMins = Math.floor(process.uptime() / 60);
      const uptimeHours = (uptimeMins / 60).toFixed(1);

      console.log(
        `[Heartbeat] 🟢 24/7 Engine Active | Uptime: ${uptimeHours}h (${uptimeMins}m) | RAM: ${memUsage}MB | Mode: ${config.tradingMode}`
      );

      http.get(`http://localhost:${port}/health`, (res) => {}).on('error', () => {});

      const externalUrl = process.env.RENDER_EXTERNAL_URL;
      if (externalUrl && externalUrl.startsWith('http')) {
        const client = externalUrl.startsWith('https') ? https : http;
        client.get(`${externalUrl}/health`, (res) => {}).on('error', (e) => {
          console.warn(`[Render Keep-Alive] Notice pinging ${externalUrl}: ${e.message}`);
        });
      }
    } catch (_) {}
  }, 300000); // Every 5 mins (300,000ms)
}

async function startServer() {
  const warnings = config.validate();

  console.log('\n=============================================================');
  console.log('   INDIAN STOCK EARNINGS INTELLIGENCE & TRADING PLATFORM    ');
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

  // Start Telegram Listener & Ingestion Engine
  if (config.nodeEnv !== 'test') {
    initTelegramBot();
    bseNseMonitor.start();
  }

  // Start Express HTTP Server
  const server = app.listen(config.port, () => {
    const serverUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${config.port}`;
    console.log(`[Express] HTTP Server running on ${serverUrl}`);
    if (config.nodeEnv !== 'test') {
      startRenderSelfPing(config.port);
      console.log(`[Render Keep-Alive] Self-Ping pinging /health every 3 mins to prevent container sleep.`);
    }
  });

  const gracefulShutdown = signal => {
    console.log(`[Server] Received ${signal}. Shutting down gracefully...`);
    try {
      bseNseMonitor.stop();
    } catch (_) {}
    server.close(() => {
      console.log('[Server] HTTP server closed. Exiting cleanly.');
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 3000);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = app;
