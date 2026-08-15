const express = require('express');
const router = express.Router();
const technicalAnalysisService = require('../services/technical/technicalAnalysisService');
const angelOne = require('../services/angelOne');

const axios = require('axios');

/**
 * Fetch 100% Real Live Market OHLCV Candles for Indian Stocks (NSE/BSE)
 * 1. Primary Source: Angel One SmartAPI Historical Candles
 * 2. Secondary Source: Yahoo Finance Live Market Feed (.NS / .BO)
 * Returns empty array if data is unavailable (yielding ⚪ DATA UNAVAILABLE per user spec).
 */
async function fetchCandlesForSymbol(symbol, periodDays = 250) {
  // 1. Primary: Angel One SmartAPI Live Historical Candles
  try {
    const scripInfo = await angelOne.searchScrip(symbol, 'NSE');
    if (scripInfo && scripInfo.symboltoken) {
      const candles = await angelOne.getHistoricalCandles(scripInfo.symboltoken, periodDays);
      if (Array.isArray(candles) && candles.length >= 20) {
        return candles;
      }
    }
  } catch (_) {}

  // 2. Secondary: Yahoo Finance Real Live Market Feed (.NS / .BO)
  const cleanSym = symbol.toUpperCase().replace(/\.NS$|\.BO$/g, '').trim();
  const tickers = [`${cleanSym}.NS`, `${cleanSym}.BO`];

  for (const ticker of tickers) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=1y&interval=1d`;
      const res = await axios.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        timeout: 8000,
      });

      if (res.data && res.data.chart && res.data.chart.result && res.data.chart.result[0]) {
        const result = res.data.chart.result[0];
        const timestamps = result.timestamp || [];
        const quote = result.indicators.quote[0] || {};
        const closes = quote.close || [];
        const opens = quote.open || [];
        const highs = quote.high || [];
        const lows = quote.low || [];
        const volumes = quote.volume || [];

        const candles = [];
        for (let i = 0; i < timestamps.length; i++) {
          if (closes[i] !== null && closes[i] !== undefined) {
            candles.push({
              date: new Date(timestamps[i] * 1000),
              open: opens[i] || closes[i],
              high: highs[i] || closes[i],
              low: lows[i] || closes[i],
              close: Math.round(closes[i] * 100) / 100,
              volume: volumes[i] || 0,
            });
          }
        }

        if (candles.length >= 20) {
          return candles;
        }
      }
    } catch (_) {}
  }

  // If live data is unavailable, return empty array (triggers ⚪ DATA UNAVAILABLE per user spec)
  return [];
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
