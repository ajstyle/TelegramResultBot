const express = require('express');
const router = express.Router();
const adaptiveValuationEngine = require('../services/valuation/adaptiveValuationEngine');

/**
 * GET /valuation/:symbol
 * Returns ONLY the single valuation label
 */
router.get('/:symbol', async (req, res) => {
  const { symbol } = req.params;
  const label = await adaptiveValuationEngine.evaluateStockLabel(symbol);
  return res.send(label);
});

/**
 * POST /valuation/:symbol/run
 * Executes full valuation run and returns ONLY the single valuation label
 */
router.post('/:symbol/run', async (req, res) => {
  const { symbol } = req.params;
  const customData = req.body && Object.keys(req.body).length > 0 ? req.body : null;
  const label = await adaptiveValuationEngine.evaluateStockLabel(symbol, customData);
  return res.send(label);
});

/**
 * GET /stocks/:symbol
 * Public stock endpoint returning ONLY the valuation label
 */
router.get('/stocks/:symbol', async (req, res) => {
  const { symbol } = req.params;
  const label = await adaptiveValuationEngine.evaluateStockLabel(symbol);
  return res.send(label);
});

module.exports = router;
