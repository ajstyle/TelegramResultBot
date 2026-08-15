const axios = require('axios');
const config = require('../config');

/**
 * Zerodha Kite Connect API Integration Service Module
 * Handles instrument token mapping, live & paper order placement on Zerodha Kite, and quote retrieval.
 */
class ZerodhaKiteService {
  constructor() {
    this.instrumentCache = new Map();
  }

  /**
   * Get headers required for Kite Connect API requests
   */
  getHeaders() {
    return {
      'X-Kite-Version': '3',
      'Authorization': `token ${config.kite.apiKey}:${config.kite.accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    };
  }

  /**
   * Get request config options including optional Static Proxy Agent (Fixie / QuotaGuard)
   */
  getRequestConfig(extraOptions = {}) {
    const options = {
      headers: this.getHeaders(),
      timeout: 10000,
      ...extraOptions,
    };

    if (config.kite.proxyUrl) {
      try {
        const { HttpsProxyAgent } = require('https-proxy-agent');
        options.httpsAgent = new HttpsProxyAgent(config.kite.proxyUrl);
      } catch (e) {
        console.warn(`[ZerodhaKite] Static proxy agent initialization notice: ${e.message}`);
      }
    }

    return options;
  }

  /**
   * Resolve trading symbol and exchange for Zerodha Kite
   * @param {string} symbol Ticker symbol e.g., 'TCS', 'SHALPAINTS'
   * @param {string} exchange Exchange e.g., 'NSE' or 'BSE'
   */
  async resolveInstrument(symbol, exchange = 'NSE') {
    const formattedSymbol = symbol.toUpperCase().trim();
    const cacheKey = `${exchange}:${formattedSymbol}`;

    if (this.instrumentCache.has(cacheKey)) {
      return this.instrumentCache.get(cacheKey);
    }

    const defaultInstrument = {
      tradingsymbol: formattedSymbol,
      exchange,
      exchangeSymbol: `${exchange}:${formattedSymbol}`,
    };

    this.instrumentCache.set(cacheKey, defaultInstrument);
    return defaultInstrument;
  }

  /**
   * Get Last Traded Price (LTP) from Zerodha Kite
   * @param {string} symbol e.g., 'TCS'
   * @param {string} exchange e.g., 'NSE'
   * @returns {Promise<number|null>}
   */
  async getLTP(symbol, exchange = 'NSE') {
    if (!config.kite.apiKey || !config.kite.accessToken) {
      return null;
    }

    try {
      const inst = await this.resolveInstrument(symbol, exchange);
      const url = `${config.kite.baseUrl}/v3/quote/ltp?i=${encodeURIComponent(inst.exchangeSymbol)}`;
      const response = await axios.get(url, this.getRequestConfig({ timeout: 5000 }));

      if (response.data && response.data.status === 'success' && response.data.data) {
        const item = response.data.data[inst.exchangeSymbol];
        if (item && item.last_price) {
          return parseFloat(item.last_price);
        }
      }
    } catch (error) {
      console.warn(`[ZerodhaKite] getLTP error for ${symbol}: ${error.message}`);
    }
    return null;
  }

  /**
   * Place an order on Zerodha Kite (Supports Live API & Paper Mode simulation)
   * @param {object} params
   * @param {string} params.symbol e.g., 'SHALPAINTS'
   * @param {string} params.action 'BUY' or 'SELL'
   * @param {number} params.quantity Number of shares
   * @param {number} [params.price] Limit price (optional for MARKET)
   * @param {string} [params.exchange] 'NSE' or 'BSE'
   * @param {string} [params.product] 'MIS' (Intraday) or 'CNC' (Delivery)
   * @param {string} [params.orderType] 'MARKET' or 'LIMIT'
   * @returns {Promise<object>} Order response
   */
  async placeOrder(params) {
    const {
      symbol,
      action = 'BUY',
      quantity = 1,
      price = 0,
      exchange = 'NSE',
      product = 'MIS',
      orderType = 'MARKET',
    } = params;

    const formattedSymbol = symbol.toUpperCase().trim();
    const isLiveMode = config.tradingMode === 'LIVE' && config.kite.apiKey && config.kite.accessToken;

    if (!isLiveMode) {
      // Paper Trading Simulation Mode
      const mockOrderId = `KITE_PAPER_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      console.log(`[ZerodhaKite] Simulated PAPER order placed for ${formattedSymbol} | Order ID: ${mockOrderId}`);
      return {
        success: true,
        orderId: mockOrderId,
        status: 'COMPLETE',
        symbol: formattedSymbol,
        action,
        quantity,
        price,
        exchange,
        broker: 'Zerodha Kite',
        isSimulated: true,
      };
    }

    try {
      const inst = await this.resolveInstrument(formattedSymbol, exchange);

      const payload = new URLSearchParams();
      payload.append('tradingsymbol', inst.tradingsymbol);
      payload.append('exchange', inst.exchange);
      payload.append('transaction_type', action.toUpperCase());
      payload.append('order_type', orderType.toUpperCase());
      payload.append('quantity', quantity.toString());
      payload.append('product', product.toUpperCase());
      payload.append('validity', 'DAY');

      if (orderType.toUpperCase() === 'LIMIT' && price > 0) {
        payload.append('price', price.toString());
      }

      const response = await axios.post(
        `${config.kite.baseUrl}/orders/regular`,
        payload.toString(),
        this.getRequestConfig()
      );

      if (response.data && response.data.status === 'success' && response.data.data?.order_id) {
        const orderId = response.data.data.order_id;
        console.log(`[ZerodhaKite] LIVE order placed successfully for ${formattedSymbol} | Order ID: ${orderId}`);
        return {
          success: true,
          orderId: orderId,
          status: 'OPEN',
          symbol: formattedSymbol,
          action,
          quantity,
          price,
          exchange,
          broker: 'Zerodha Kite',
          isSimulated: false,
        };
      } else {
        throw new Error(response.data?.message || 'Order placement failed on Zerodha Kite');
      }
    } catch (error) {
      const errMsg = error.response?.data?.message || error.message;
      console.error(`[ZerodhaKite] Order placement notice for ${formattedSymbol}: ${errMsg}`);

      if (errMsg.includes('No IPs configured')) {
        if (config.tradingMode !== 'LIVE') {
          const mockOrderId = `KITE_PAPER_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
          console.log(`[ZerodhaKite] Seamless PAPER mode fallback executed for ${formattedSymbol} | Order ID: ${mockOrderId}`);
          return {
            success: true,
            orderId: mockOrderId,
            status: 'COMPLETE',
            symbol: formattedSymbol,
            action,
            quantity,
            price,
            exchange,
            broker: 'Zerodha Kite (Paper)',
            isSimulated: true,
          };
        }
        throw new Error(`Zerodha IP Whitelist Required: Zerodha requires server IP whitelisting for Live order placement. Add your IP in Zerodha Developer Console Profile.`);
      }

      throw new Error(`Zerodha Order Error: ${errMsg}`);
    }
  }
}

module.exports = new ZerodhaKiteService();
