const Trade = require('../models/Trade');
const mongoose = require('mongoose');

// In-Memory Fallback Map when MongoDB is not running
const inMemoryTrades = new Map();

class TradeStore {
  /**
   * Save or Create a Trade Record
   */
  async createTrade(data) {
    if (mongoose.connection.readyState === 1) {
      try {
        const trade = await Trade.create(data);
        return trade;
      } catch (err) {
        console.warn(`[TradeStore] MongoDB save failed (${err.message}). Storing in memory.`);
      }
    }

    // Fallback: In-memory record
    const id = `MEM_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const memTrade = {
      _id: id,
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
      save: async function () {
        this.updatedAt = new Date();
        inMemoryTrades.set(id, this);
        return this;
      },
    };
    inMemoryTrades.set(id, memTrade);
    return memTrade;
  }

  /**
   * Find Trade by ID
   */
  async findById(id) {
    if (inMemoryTrades.has(id)) {
      return inMemoryTrades.get(id);
    }

    if (mongoose.connection.readyState === 1) {
      try {
        const trade = await Trade.findById(id);
        if (trade) return trade;
      } catch (err) {
        console.warn(`[TradeStore] MongoDB fetch error: ${err.message}`);
      }
    }

    return null;
  }

  /**
   * Find all trades (for REST API)
   */
  async find(limit = 50) {
    if (mongoose.connection.readyState === 1) {
      try {
        return await Trade.find().sort({ createdAt: -1 }).limit(limit);
      } catch (err) {}
    }
    return Array.from(inMemoryTrades.values()).slice(0, limit);
  }
}

module.exports = new TradeStore();
