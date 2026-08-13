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

    const defaultScrip = {
      symboltoken: `TOKEN_${formattedSymbol}`,
      tradingsymbol: `${formattedSymbol}-EQ`,
      exchange,
    };

    if (config.tradingMode === 'PAPER' && !this.jwtToken) {
      return defaultScrip;
    }

    try {
      await this.login();
    } catch (_) {
      return defaultScrip;
    }

    try {
      const response = await axios.post(
        `${config.angelOne.baseUrl}/rest/secure/angelbroking/order/v1/searchScrip`,
        {
          exchange,
          searchscrip: formattedSymbol,
        },
        { headers: this.getHeaders(), timeout: 5000 }
      );

      if (response.data && response.data.status && Array.isArray(response.data.data) && response.data.data.length > 0) {
        const eqMatch = response.data.data.find(
          item => item.tradingsymbol === `${formattedSymbol}-EQ`
        );
        const beMatch = response.data.data.find(
          item => item.tradingsymbol === `${formattedSymbol}-BE` || item.tradingsymbol?.startsWith(formattedSymbol)
        );

        const selected = eqMatch || beMatch || response.data.data[0];
        const scripResult = {
          symboltoken: selected.symboltoken,
          tradingsymbol: selected.tradingsymbol,
          exchange: selected.exchange || exchange,
          series: selected.series || '',
        };
        this.scripCache.set(cacheKey, scripResult);
        return scripResult;
      }
    } catch (_) {}

    // Fallback: Fetch from Angel One Official Scrip Master File
    try {
      const smRes = await axios.get('https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json', { timeout: 8000 });
      if (Array.isArray(smRes.data)) {
        const match = smRes.data.find(item => item.name === formattedSymbol && (item.exch_seg === exchange || item.exch_seg === 'NSE' || item.exch_seg === 'BSE'));
        if (match && match.token) {
          const scripResult = {
            symboltoken: match.token,
            tradingsymbol: match.symbol,
            exchange: match.exch_seg || exchange,
            series: match.symbol.includes('-BE') ? 'BE' : 'EQ',
          };
          this.scripCache.set(cacheKey, scripResult);
          return scripResult;
        }
      }
    } catch (_) {}

    this.scripCache.set(cacheKey, defaultScrip);
    return defaultScrip;
  }

  /**
   * Check if a stock is listed under Cautionary / Surveillance Framework (GSM/ASM/Trade-for-Trade)
   */
  isCautionaryStock(symbol, scripInfo = {}) {
    if (!symbol) return false;
    const cleanSym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');

    if (scripInfo && scripInfo.series) {
      const series = scripInfo.series.toUpperCase();
      if (['BE', 'BZ', 'ST', 'SM', 'GSM', 'ASM', 'ESM'].includes(series)) {
        return true;
      }
    }

    const cautionarySymbols = new Set(['PANAMAPET', 'PANAMAPETEQ']);
    if (cautionarySymbols.has(cleanSym)) {
      return true;
    }

    return false;
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
        { headers: this.getHeaders(), timeout: 15000 }
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
        { headers: this.getHeaders(), timeout: 15000 }
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
      if (error.message && (error.message.includes('403') || error.message.includes('401'))) {
        console.warn(`[AngelOne] Notice: Historical API access inactive (Enable 'Historical Data API' in your Angel One SmartAPI App Dashboard). System using 2% Volatility Fallback for Stop Loss calculation.`);
      } else {
        console.warn(`[AngelOne] Historical candles fetch notice: ${error.message}`);
      }
      return [];
    }
  }

  /**
   * Place Order with Angel One (or simulated in PAPER mode)
   * @param {object} orderParams { tradingsymbol, symboltoken, transactiontype, quantity, price, orderType, productType }
   * @returns {Promise<{ success: boolean, orderId: string, message: string }>}
   */
  async placeOrder({
    tradingsymbol,
    symboltoken,
    transactiontype = 'BUY',
    quantity,
    price,
    orderType = 'LIMIT',
    productType = 'INTRADAY',
    exchange = 'NSE',
  }) {
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

      let response;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          response = await axios.post(
            `${config.angelOne.baseUrl}/rest/secure/angelbroking/order/v1/placeOrder`,
            payload,
            { headers: this.getHeaders(), timeout: 15000 }
          );
          break;
        } catch (err) {
          if (attempt === 2 || (!err.message.includes('timeout') && err.code !== 'ECONNABORTED')) {
            throw err;
          }
          console.warn(`[AngelOne] Order submission attempt ${attempt} timed out. Retrying in 1000ms...`);
          await new Promise(res => setTimeout(res, 1000));
        }
      }

      console.log(`[AngelOne] Order API Response:`, JSON.stringify(response.data));

      if (response.data && response.data.status && response.data.data) {
        return {
          success: true,
          orderId: response.data.data.orderid,
          message: response.data.message || 'Order placed successfully',
        };
      } else {
        let msg = response.data?.message || 'Order placement failed at broker level';
        if (msg.includes('not a registered IP') || response.data?.errorCode === 'AG7002') {
          msg = `IP Restriction Notice (AG7002): Go to smartapi.angelbroking.com -> Edit App -> Clear/Remove Static IP field so cloud orders can pass through.`;
        }
        return {
          success: false,
          orderId: null,
          message: msg,
        };
      }
    } catch (error) {
      let errMsg = error.response?.data?.message || error.message;
      if (errMsg.includes('not a registered IP') || error.response?.data?.errorCode === 'AG7002') {
        errMsg = `IP Restriction Notice (AG7002): Go to smartapi.angelbroking.com -> Edit App -> Clear/Remove Static IP field so cloud orders can pass through.`;
      }
      console.error(`[AngelOne] Order placement error: ${errMsg}`);
      return {
        success: false,
        orderId: null,
        message: errMsg,
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
