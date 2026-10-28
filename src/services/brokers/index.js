const zerodhaKite = require('../zerodhaKite');
const config = require('../../config');

class BrokerManager {
  constructor() {
    this.activeBroker = 'ZERODHA_KITE';
  }

  /**
   * Get Active Broker Adapter instance
   */
  getAdapter() {
    return zerodhaKite;
  }

  async login() {
    // Kite handles session via accessToken or headless auto-login
    return true;
  }

  async searchScrip(symbol, exchange = 'NSE') {
    return this.getAdapter().resolveInstrument(symbol, exchange);
  }

  async getLTP(symbol, exchange = 'NSE') {
    return this.getAdapter().getLTP(symbol, exchange);
  }

  async placeOrder(orderParams) {
    return this.getAdapter().placeOrder(orderParams);
  }
}

module.exports = new BrokerManager();
