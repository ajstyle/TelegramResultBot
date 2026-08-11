/**
 * Base Abstract Broker Adapter Interface
 * All broker adapters (Angel One, Zerodha, Dhan, Upstox, Paper) must implement this interface.
 */
class BaseBrokerAdapter {
  constructor(name) {
    this.name = name;
  }

  async login() {
    throw new Error('Method login() must be implemented');
  }

  async searchScrip(symbol, exchange = 'NSE') {
    throw new Error('Method searchScrip() must be implemented');
  }

  async getLTP(exchange, tradingsymbol, symboltoken) {
    throw new Error('Method getLTP() must be implemented');
  }

  async getHistoricalCandles(exchange, symboltoken, days = 30) {
    throw new Error('Method getHistoricalCandles() must be implemented');
  }

  async placeOrder(orderParams) {
    throw new Error('Method placeOrder() must be implemented');
  }

  async getOrderStatus(orderId) {
    throw new Error('Method getOrderStatus() must be implemented');
  }

  async cancelOrder(orderId) {
    throw new Error('Method cancelOrder() must be implemented');
  }
}

module.exports = BaseBrokerAdapter;
