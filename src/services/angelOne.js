const axios = require('axios');
const OTPAuth = require('otpauth');
const config = require('../config');

class AngelOneService {
  constructor() {
    this.jwtToken = null;
    this.refreshToken = null;
    this.feedToken = null;
    this.tokenExpiry = 0;
    this.scripCache = new Map();
  }

  /**
   * Generate current TOTP code using secret
   * @returns {string}
   */
  generateTOTP() {
    if (!config.angelOne.totpSecret) {
      throw new Error('ANGEL_TOTP_SECRET is not configured in .env');
    }
    const totp = new OTPAuth.TOTP({
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(config.angelOne.totpSecret.replace(/\s+/g, '')),
    });
    return totp.generate();
  }

  /**
   * Login to Angel One SmartAPI to generate JWT session
   */
  async login() {
    if (config.tradingMode === 'PAPER' && !config.angelOne.apiKey) {
      console.log('[AngelOne] PAPER Mode: Operating without active Angel One API connection.');
      return true;
    }

    if (this.jwtToken && Date.now() < this.tokenExpiry) {
      return true;
    }

    try {
      const totpCode = this.generateTOTP();
      const payload = {
        clientcode: config.angelOne.clientCode,
        password: config.angelOne.pin,
        totp: totpCode,
      };

      const response = await axios.post(
        `${config.angelOne.baseUrl}/rest/auth/angelbroking/user/v1/loginByPassword`,
        payload,
        {
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-UserType': 'USER',
            'X-SourceID': 'WEB',
            'X-ClientLocalIP': '127.0.0.1',
            'X-ClientPublicIP': '127.0.0.1',
            'X-MACAddress': '00-00-00-00-00-00',
            'X-PrivateKey': config.angelOne.apiKey,
          },
          timeout: 10000,
        }
      );

      if (response.data && response.data.status && response.data.data) {
        this.jwtToken = response.data.data.jwtToken;
        this.refreshToken = response.data.data.refreshToken;
        this.feedToken = response.data.data.feedToken;
        // Token valid for ~24 hours, set expiry to 20 hours
        this.tokenExpiry = Date.now() + 20 * 60 * 60 * 1000;
        console.log('[AngelOne] Successfully authenticated session.');
        return true;
      } else {
        throw new Error(response.data?.message || 'Login failed');
      }
    } catch (error) {
      console.error(`[AngelOne] Login error: ${error.response?.data?.message || error.message}`);
      if (config.tradingMode === 'PAPER') {
        console.log('[AngelOne] Fallback to simulated PAPER session.');
        return true;
      }
      throw error;
    }
  }

  /**
   * Helper headers for API requests
   */
  getHeaders() {
    return {
      'Authorization': `Bearer ${this.jwtToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-UserType': 'USER',
      'X-SourceID': 'WEB',
      'X-ClientLocalIP': '127.0.0.1',
      'X-ClientPublicIP': '127.0.0.1',
      'X-MACAddress': '00-00-00-00-00-00',
      'X-PrivateKey': config.angelOne.apiKey,
    };
  }

  /**
   * Search Scrip dynamically to convert symbol (e.g. TCS) -> symboltoken (e.g. 11536)
   * @param {string} symbol e.g., 'TCS', 'RELIANCE'
   * @param {string} exchange e.g., 'NSE'
   * @returns {Promise<{ symboltoken: string, tradingsymbol: string, exchange: string }>}
   */
  async searchScrip(symbol, exchange = 'NSE') {
    const formattedSymbol = symbol.toUpperCase().trim();
    const cacheKey = `${exchange}:${formattedSymbol}`;

    if (this.scripCache.has(cacheKey)) {
      return this.scripCache.get(cacheKey);
    }

    if (config.tradingMode === 'PAPER' && !this.jwtToken) {
      const mockResult = {
        symboltoken: `MOCK_${formattedSymbol}_TOKEN`,
        tradingsymbol: `${formattedSymbol}-EQ`,
        exchange,
      };
      this.scripCache.set(cacheKey, mockResult);
      return mockResult;
    }

    await this.login();

    try {
      const response = await axios.post(
        `${config.angelOne.baseUrl}/rest/secure/angelbroking/order/v1/searchScrip`,
        {
          exchange,
          searchscrip: formattedSymbol,
        },
        { headers: this.getHeaders(), timeout: 10000 }
      );

      if (response.data && response.data.status && Array.isArray(response.data.data) && response.data.data.length > 0) {
        // Priority 1: Exact match for TRADING-EQ (e.g., RELIANCE-EQ, TCS-EQ)
        const eqMatch = response.data.data.find(
          item => item.tradingsymbol === `${formattedSymbol}-EQ`
        );

        // Priority 2: Any scrip ending in -EQ
        const anyEqMatch = response.data.data.find(
          item => item.tradingsymbol && item.tradingsymbol.endsWith('-EQ')
        );

        const selected = eqMatch || anyEqMatch || response.data.data[0];
        const scripResult = {
          symboltoken: selected.symboltoken,
          tradingsymbol: selected.tradingsymbol,
          exchange: selected.exchange || exchange,
        };
        this.scripCache.set(cacheKey, scripResult);
        return scripResult;
      }
      throw new Error(`Scrip not found for symbol: ${formattedSymbol}`);
    } catch (error) {
      console.warn(`[AngelOne] Scrip lookup failed for ${formattedSymbol}: ${error.message}`);
      return {
        symboltoken: `TOKEN_${formattedSymbol}`,
        tradingsymbol: `${formattedSymbol}-EQ`,
        exchange,
      };
    }
  }

  /**
   * Get Last Traded Price (LTP)
   * @param {string} exchange e.g., 'NSE'
   * @param {string} tradingsymbol e.g., 'TCS-EQ'
   * @param {string} symboltoken
   * @returns {Promise<number>}
   */
  async getLTP(exchange, tradingsymbol, symboltoken) {
    if (config.tradingMode === 'PAPER' && !this.jwtToken) {
      return null; // Will fallback to entry price if null
    }

    await this.login();

    try {
      const response = await axios.post(
        `${config.angelOne.baseUrl}/rest/secure/angelbroking/order/v1/getLtpData`,
        { exchange, tradingsymbol, symboltoken },
        { headers: this.getHeaders(), timeout: 10000 }
      );

      if (response.data && response.data.status && response.data.data) {
        return parseFloat(response.data.data.ltp);
      }
      return null;
    } catch (error) {
      console.warn(`[AngelOne] LTP fetch failed for ${tradingsymbol}: ${error.message}`);
      return null;
    }
  }

  /**
   * Get Historical Candles (Daily) for ATR calculation
   * @param {string} exchange e.g., 'NSE'
   * @param {string} symboltoken
   * @param {number} days e.g., 30
   * @returns {Promise<Array<{ high: number, low: number, close: number }>>}
   */
  async getHistoricalCandles(exchange, symboltoken, days = 30) {
    if (config.tradingMode === 'PAPER' && !this.jwtToken) {
      return [];
    }

    await this.login();

    try {
      const toDate = new Date();
      const fromDate = new Date();
      fromDate.setDate(toDate.getDate() - days);

      const formatDate = d => d.toISOString().split('T')[0] + ' 09:15';

      const response = await axios.post(
        `${config.angelOne.baseUrl}/rest/secure/angelbroking/historical/v1/getCandleData`,
        {
          exchange,
          symboltoken,
          interval: 'ONE_DAY',
          fromdate: formatDate(fromDate),
          todate: formatDate(toDate),
        },
        { headers: this.getHeaders(), timeout: 10000 }
      );

      if (response.data && response.data.status && Array.isArray(response.data.data)) {
        // [timestamp, open, high, low, close, volume]
        return response.data.data.map(candle => ({
          high: parseFloat(candle[2]),
          low: parseFloat(candle[3]),
          close: parseFloat(candle[4]),
        }));
      }
      return [];
    } catch (error) {
      console.warn(`[AngelOne] Historical candles fetch failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Place Order with Angel One (or simulated in PAPER mode)
   * @param {object} orderParams { tradingsymbol, symboltoken, transactiontype, quantity, price, orderType, productType }
   * @returns {Promise<{ success: boolean, orderId: string, message: string }>}
   */
  async placeOrder(orderParams) {
    const { tradingsymbol, symboltoken, transactiontype, quantity, price, orderType = 'LIMIT', productType = 'DELIVERY', exchange = 'NSE' } = orderParams;

    if (config.tradingMode === 'PAPER') {
      const mockOrderId = `PAPER_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      console.log(`[AngelOne] PAPER ORDER PLACED: ${transactiontype} ${quantity} ${tradingsymbol} @ ₹${price} (Order ID: ${mockOrderId})`);
      return {
        success: true,
        orderId: mockOrderId,
        message: 'Order simulated successfully in PAPER mode.',
      };
    }

    await this.login();

    try {
      const payload = {
        variety: 'NORMAL',
        tradingsymbol,
        symboltoken,
        transactiontype, // BUY or SELL
        exchange,
        ordertype: orderType, // LIMIT or MARKET
        producttype: productType, // DELIVERY or INTRADAY
        duration: 'DAY',
        price: price.toString(),
        squareoff: '0',
        stoploss: '0',
        quantity: quantity.toString(),
      };

      console.log(`[AngelOne] Submitting LIVE order to Angel One: ${transactiontype} ${quantity} ${tradingsymbol} @ ₹${price}...`);

      const response = await axios.post(
        `${config.angelOne.baseUrl}/rest/secure/angelbroking/order/v1/placeOrder`,
        payload,
        { headers: this.getHeaders(), timeout: 10000 }
      );

      console.log(`[AngelOne] Order API Response:`, JSON.stringify(response.data));

      if (response.data && response.data.status && response.data.data) {
        return {
          success: true,
          orderId: response.data.data.orderid,
          message: response.data.message || 'Order placed successfully',
        };
      } else {
        return {
          success: false,
          orderId: null,
          message: response.data?.message || 'Order placement failed at broker level',
        };
      }
    } catch (error) {
      console.error(`[AngelOne] Order placement error: ${error.response?.data?.message || error.message}`);
      return {
        success: false,
        orderId: null,
        message: error.response?.data?.message || error.message,
      };
    }
  }

  /**
   * Get Status of Order
   * @param {string} orderId
   * @returns {Promise<{ status: string, message: string }>}
   */
  async getOrderStatus(orderId) {
    if (orderId && orderId.startsWith('PAPER_')) {
      return { status: 'COMPLETED', message: 'Simulated Paper Trade Executed' };
    }

    await this.login();

    try {
      const response = await axios.get(
        `${config.angelOne.baseUrl}/rest/secure/angelbroking/order/v1/details/${orderId}`,
        { headers: this.getHeaders(), timeout: 10000 }
      );

      if (response.data && response.data.status && response.data.data) {
        return {
          status: response.data.data.status,
          message: response.data.data.textmessage || 'Order details fetched',
        };
      }
      return { status: 'UNKNOWN', message: 'Could not retrieve status' };
    } catch (error) {
      return { status: 'ERROR', message: error.message };
    }
  }

  /**
   * Cancel Order
   * @param {string} orderId
   * @param {string} variety
   */
  async cancelOrder(orderId, variety = 'NORMAL') {
    if (orderId && orderId.startsWith('PAPER_')) {
      return { success: true, message: 'Simulated Paper Order Cancelled' };
    }

    await this.login();

    try {
      const response = await axios.post(
        `${config.angelOne.baseUrl}/rest/secure/angelbroking/order/v1/cancelOrder`,
        { variety, orderid: orderId },
        { headers: this.getHeaders(), timeout: 10000 }
      );

      return {
        success: response.data?.status || false,
        message: response.data?.message || 'Cancel request sent',
      };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }
}

module.exports = new AngelOneService();
