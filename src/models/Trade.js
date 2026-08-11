const mongoose = require('mongoose');

const tradeSchema = new mongoose.Schema(
  {
    symbol: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    action: {
      type: String,
      required: true,
      enum: ['BUY', 'SELL'],
    },
    entry: {
      type: Number,
      required: true,
    },
    ltp: {
      type: Number,
      default: null,
    },
    stopLoss: {
      type: Number,
      required: true,
    },
    target: {
      type: Number,
      default: null,
    },
    quantity: {
      type: Number,
      required: true,
      min: 0,
    },
    atr: {
      type: Number,
      default: null,
    },

    fundamentals: {
      score: { type: Number, default: null },
      pe: { type: Number, default: null },
      pb: { type: Number, default: null },
      roe: { type: Number, default: null },
      roce: { type: Number, default: null },
      debtToEquity: { type: Number, default: null },
      salesGrowthQoQ: { type: Number, default: null },
      profitGrowthQoQ: { type: Number, default: null },
      salesGrowthYoY: { type: Number, default: null },
      profitGrowthYoY: { type: Number, default: null },
      promoterHolding: { type: Number, default: null },
      pledgedPercentage: { type: Number, default: null },
    },

    decision: {
      recommendation: { type: String, default: '' },
      score: { type: Number, default: 0 },
      confidence: { type: String, default: 'MEDIUM' },
      reasons: [{ type: String }],
      warnings: [{ type: String }],
    },

    status: {
      type: String,
      required: true,
      enum: ['ANALYZED', 'CONFIRMED', 'ORDER_PLACED', 'REJECTED', 'CANCELLED', 'COMPLETED'],
      default: 'ANALYZED',
    },

    angelOrderId: {
      type: String,
      default: null,
    },

    telegramMessageId: {
      type: Number,
      default: null,
    },

    telegramChatId: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Trade', tradeSchema);
