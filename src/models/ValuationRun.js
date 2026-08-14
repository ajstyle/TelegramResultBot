const mongoose = require('mongoose');

const ValuationRunSchema = new mongoose.Schema(
  {
    symbol: { type: String, required: true, uppercase: true, index: true },
    sector: { type: String, required: true },
    label: {
      type: String,
      required: true,
      enum: [
        'Deeply Undervalued',
        'Undervalued (Cheap)',
        'Fairly Valued',
        'Slightly Expensive',
        'Overvalued'
      ]
    },
    compositeScore: { type: Number },
    marginOfSafetyPct: { type: Number },
    engineVersion: { type: String, default: '1.0.0-adaptive' },
    createdAt: { type: Date, default: Date.now, expires: 86400 } // 24-hour cache TTL
  },
  { timestamps: true }
);

module.exports = mongoose.model('ValuationRun', ValuationRunSchema);
