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
const technicalRoutes = require('./api/technicalRoutes');
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
app.use('/api/technical', technicalRoutes);
app.use('/technical', technicalRoutes);

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
 * GET /kite/callback
 * Zerodha Kite Connect login callback & auto access token exchange endpoint
 */
app.get('/kite/callback', async (req, res) => {
  const requestToken = req.query.request_token || '';
  if (requestToken) {
    let accessToken = null;
    let errorMsg = null;

    if (config.kite.apiKey && config.kite.apiSecret) {
      try {
        const crypto = require('crypto');
        const axios = require('axios');
        const checksum = crypto.createHash('sha256')
          .update(config.kite.apiKey + requestToken + config.kite.apiSecret)
          .digest('hex');

        const params = new URLSearchParams();
        params.append('api_key', config.kite.apiKey);
        params.append('request_token', requestToken);
        params.append('checksum', checksum);

        const tokenRes = await axios.post('https://api.kite.trade/session/token', params.toString(), {
          headers: {
            'X-Kite-Version': '3',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          timeout: 10000,
        });

        if (tokenRes.data && tokenRes.data.status === 'success' && tokenRes.data.data?.access_token) {
          accessToken = tokenRes.data.data.access_token;
          config.kite.accessToken = accessToken;
          try {
            const fs = require('fs');
            const envPath = path.join(__dirname, '../.env');
            if (fs.existsSync(envPath)) {
              let envContent = fs.readFileSync(envPath, 'utf8');
              if (envContent.includes('KITE_ACCESS_TOKEN=')) {
                envContent = envContent.replace(/KITE_ACCESS_TOKEN=.*/g, `KITE_ACCESS_TOKEN=${accessToken}`);
              } else {
                envContent += `\nKITE_ACCESS_TOKEN=${accessToken}\n`;
              }
              fs.writeFileSync(envPath, envContent, 'utf8');
              console.log(`[ZerodhaKite Callback] ✅ Automatically updated KITE_ACCESS_TOKEN in .env file!`);
            }
          } catch (fsErr) {
            console.warn(`[ZerodhaKite Callback] Notice writing .env: ${fsErr.message}`);
          }
        }
      } catch (err) {
        errorMsg = err.response?.data?.message || err.message;
      }
    }

    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Zerodha Kite Token Exchange</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
          .card { background: #1e293b; border-radius: 12px; padding: 32px; border: 1px stroke #334155; box-shadow: 0 10px 25px rgba(0,0,0,0.5); max-width: 550px; text-align: center; }
          h2 { color: #10b981; margin-top: 0; }
          code { background: #090d16; color: #38bdf8; padding: 10px 16px; border-radius: 6px; font-size: 15px; display: inline-block; margin: 10px 0; word-break: break-all; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>🪁 Zerodha Kite Login Successful!</h2>
          ${accessToken ? `
            <p>Your generated <code>KITE_ACCESS_TOKEN</code> is:</p>
            <code>${accessToken}</code>
            <p style="color: #10b981; font-weight: bold; margin-top: 15px;">✅ Copy this KITE_ACCESS_TOKEN into your .env file!</p>
          ` : `
            <p>Your Zerodha <code>request_token</code> is:</p>
            <code>${requestToken}</code>
            ${errorMsg ? `<p style="color: #ef4444; font-size: 13px;">Auto-exchange notice: ${errorMsg}</p>` : ''}
          `}
        </div>
      </body>
      </html>
    `);
  }
  res.send('Zerodha Kite Callback Endpoint Active. Waiting for request_token...');
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
