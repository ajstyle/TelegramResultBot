const express = require('express');
const router = express.Router();
const qualityScoringEngine = require('../services/quality/qualityScoringEngine');

/**
 * GET /quality/:symbol
 * Returns ONLY Quality Score and Status Label (No JSON, No Valuation Verdict)
 */
router.get('/:symbol', async (req, res) => {
  const { symbol } = req.params;
  const resObj = await qualityScoringEngine.calculateQualityScore(symbol);
  return res.send(resObj.formattedOutput);
});

/**
 * POST /quality/:symbol/run
 * Accepts optional custom fundamentals body and returns ONLY Quality Score and Status Label
 */
router.post('/:symbol/run', async (req, res) => {
  const { symbol } = req.params;
  const customData = req.body && Object.keys(req.body).length > 0 ? req.body : null;
  const resObj = await qualityScoringEngine.calculateQualityScore(symbol, customData);
  return res.send(resObj.formattedOutput);
});

module.exports = router;
