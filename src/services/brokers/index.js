const angelOne = require('../angelOne');
const config = require('../../config');

class BrokerManager {
  constructor() {
    this.activeBroker = 'ANGEL_ONE';
  }

  /**
   * Get Active Broker Adapter instance
   */
  getAdapter() {
    // Easily extendable for Zerodha, Dhan, Upstox
    return angelOne;
  }

  async login() {
    return this.getAdapter().login();
  }

  async searchScrip(symbol, exchange = 'NSE') {
    return this.getAdapter().searchScrip(symbol, exchange);
  }

  async getLTP(exchange, tradingsymbol, symboltoken) {
    return this.getAdapter().getLTP(exchange, tradingsymbol, symboltoken);
  }

  async getHistoricalCandles(exchange, symboltoken, days = 30) {
    return this.getAdapter().getHistoricalCandles(exchange, symboltoken, days);
  }

  async placeOrder(orderParams) {
    return this.getAdapter().placeOrder(orderParams);
  }

  async getOrderStatus(orderId) {
    return this.getAdapter().getOrderStatus(orderId);
  }

  async cancelOrder(orderId) {
    return this.getAdapter().cancelOrder(orderId);
  }
}

module.exports = new BrokerManager();
