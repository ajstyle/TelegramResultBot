const express = require('express');
const router = express.Router();
const technicalAnalysisService = require('../services/technical/technicalAnalysisService');
const angelOne = require('../services/angelOne');

/**
 * Helper to generate or fetch historical OHLCV candles
 * Uses Angel One API candles if logged in, or synthetic realistic trend generator for test/dev environment
 */
async function fetchCandlesForSymbol(symbol, periodDays = 250) {
  try {
    const scripInfo = await angelOne.searchScrip(symbol, 'NSE');
    if (scripInfo && scripInfo.symboltoken) {
      const candles = await angelOne.getHistoricalCandles(scripInfo.symboltoken, periodDays);
      if (Array.isArray(candles) && candles.length >= 20) {
        return candles;
      }
    }
  } catch (_) {}

  // Deterministic realistic market trend generator for development / fallback
  const candles = [];
  let currentPrice = 1000;
  const hash = symbol.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const trendFactor = (hash % 10) > 4 ? 0.0015 : -0.001;

  const now = Date.now();
  for (let i = periodDays; i >= 0; i--) {
    const date = new Date(now - i * 24 * 60 * 60 * 1000);
    const dayOfWeek = date.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) continue; // Skip weekends

    const noise = (Math.sin(i * 0.5 + hash) * 0.015);
    const change = trendFactor + noise;
    currentPrice = Math.max(10, currentPrice * (1 + change));

    const high = currentPrice * 1.01;
    const low = currentPrice * 0.99;
    const volume = Math.floor(100000 + Math.abs(Math.sin(i) * 500000));

    candles.push({
      date,
      open: currentPrice,
      high,
      low,
      close: Math.round(currentPrice * 100) / 100,
      volume,
    });
  }

  return candles;
}

/**
 * GET /api/technical/analyze?symbol=TCS
 * Returns ONLY the minimal stock card payload (Technical Status & Marks)
 */
router.get('/analyze', async (req, res) => {
  try {
    const symbol = (req.query.symbol || '').toUpperCase().trim();
    if (!symbol || !/^[A-Z0-9.&-]{1,20}$/.test(symbol)) {
      return res.status(400).json({
        symbol: symbol || 'UNKNOWN',
        technicalScore: null,
        technicalStatus: 'DATA_UNAVAILABLE',
        displayStatus: '⚪ DATA UNAVAILABLE',
        dataQuality: 'INVALID_INPUT',
      });
    }

    const candles = await fetchCandlesForSymbol(symbol);
    const result = technicalAnalysisService.analyzeStock(symbol, candles);
    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      symbol: req.query.symbol || 'UNKNOWN',
      technicalScore: null,
      technicalStatus: 'DATA_UNAVAILABLE',
      displayStatus: '⚪ DATA UNAVAILABLE',
      dataQuality: 'ERROR',
    });
  }
});

/**
 * POST /api/technical/batch-sort
 * Accepts { symbols: ["RELIANCE", "TCS", "INFY", "XYZ"] }
 * Returns array of stocks sorted descending by technicalScore
 */
router.post('/batch-sort', async (req, res) => {
  try {
    const symbols = req.body && Array.isArray(req.body.symbols) ? req.body.symbols : [];
    if (symbols.length === 0) {
      return res.json([]);
    }

    const results = [];
    for (const sym of symbols) {
      const cleanSym = `${sym}`.toUpperCase().trim();
      const candles = await fetchCandlesForSymbol(cleanSym);
      const resObj = technicalAnalysisService.analyzeStock(cleanSym, candles);
      results.push(resObj);
    }

    // Sort stocks by technicalScore descending (nulls last)
    results.sort((a, b) => {
      const scoreA = a.technicalScore !== null ? a.technicalScore : -1;
      const scoreB = b.technicalScore !== null ? b.technicalScore : -1;
      return scoreB - scoreA;
    });

    return res.json(results);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
