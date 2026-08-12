const fs = require('fs');
const path = require('path');
const Trade = require('../models/Trade');
const mongoose = require('mongoose');

const cacheFilePath = path.join(__dirname, '../../trades_backup.json');

// In-Memory Fallback Map when MongoDB is not running
const inMemoryTrades = new Map();

// Load disk backup on startup
try {
  if (fs.existsSync(cacheFilePath)) {
    const raw = fs.readFileSync(cacheFilePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (item && item._id) {
          inMemoryTrades.set(item._id.toString(), {
            ...item,
            save: async function () {
              this.updatedAt = new Date();
              inMemoryTrades.set(this._id.toString(), this);
              saveDiskCache();
              return this;
            },
          });
        }
      }
      console.log(`[TradeStore] Loaded ${inMemoryTrades.size} persisted trade records from disk backup.`);
    }
  }
} catch (_) {}

function saveDiskCache() {
  try {
    const arr = Array.from(inMemoryTrades.values()).map(t => ({
      _id: t._id,
      symbol: t.symbol,
      action: t.action,
      entry: t.entry,
      ltp: t.ltp,
      stopLoss: t.stopLoss,
      quantity: t.quantity,
      status: t.status,
      angelOrderId: t.angelOrderId,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }));
    fs.writeFileSync(cacheFilePath, JSON.stringify(arr, null, 2), 'utf8');
  } catch (_) {}
}

class TradeStore {
  /**
   * Save or Create a Trade Record
   */
  async createTrade(data) {
    let createdTrade = null;

    if (mongoose.connection.readyState === 1) {
      try {
        createdTrade = await Trade.create(data);
        if (createdTrade) {
          const tradeObj = {
            ...createdTrade.toObject(),
            save: async function () {
              try {
                return await Trade.findByIdAndUpdate(this._id, this, { new: true });
              } catch (_) {
                return this;
              }
            },
          };
          inMemoryTrades.set(createdTrade._id.toString(), tradeObj);
          saveDiskCache();
          return createdTrade;
        }
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
        saveDiskCache();
        return this;
      },
    };
    inMemoryTrades.set(id, memTrade);
    saveDiskCache();
    return memTrade;
  }

  /**
   * Find Trade by ID
   */
  async findById(id) {
    if (!id) return null;
    const strId = id.toString();

    if (inMemoryTrades.has(strId)) {
      return inMemoryTrades.get(strId);
    }

    if (mongoose.connection.readyState === 1 && !strId.startsWith('MEM_')) {
      try {
        const trade = await Trade.findById(strId);
        if (trade) {
          inMemoryTrades.set(strId, trade);
          saveDiskCache();
          return trade;
        }
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
