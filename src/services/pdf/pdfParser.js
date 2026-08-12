const axios = require('axios');
const pdfParse = require('pdf-parse');
const ocrEngine = require('../../ocr/tesseract');

/**
 * High-Precision Financial PDF Table & Statement Extractor Engine
 * Parses BSE & NSE Regulation 33 filings, extracts actual numbers, detects units (Lakhs vs Crores),
 * handles commas (1,735.20) and parenthesized negative numbers, and computes exact QoQ % and YoY % results.
 */
class PdfParserEngine {
  /**
   * Extract financial metrics from PDF URL or Buffer
   * @param {string|Buffer} source PDF URL string or Buffer
   * @returns {Promise<{ rawText: string, metrics: object, isScanned: boolean }>}
   */
  async parsePdf(source) {
    let pdfBuffer;

    if (typeof source === 'string' && source.startsWith('http')) {
      const cleanSource = source.substring(source.lastIndexOf('http'));
      const urlsToTry = [encodeURI(cleanSource)];

      // Construct fallback URLs for NSE and BSE
      if (cleanSource.includes('archives.nseindia.com/corporate/announcements/')) {
        urlsToTry.push(encodeURI(cleanSource.replace('archives.nseindia.com/corporate/announcements/', 'www.nseindia.com/content/corporate/announcements/')));
      } else if (cleanSource.includes('AttachLive')) {
        urlsToTry.push(encodeURI(cleanSource.replace('AttachLive', 'AttachHis')));
      }

      for (const targetUrl of urlsToTry) {
        try {
          const res = await axios.get(targetUrl, {
            responseType: 'arraybuffer',
            timeout: 15000,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
              'Accept': 'application/pdf,application/octet-stream,*/*',
              'Referer': targetUrl.includes('bseindia') ? 'https://www.bseindia.com/' : 'https://www.nseindia.com/',
            },
          });
          if (res.data && res.data.length > 10) {
            const buf = Buffer.from(res.data);
            if (buf.toString('utf-8', 0, 5) === '%PDF-') {
              pdfBuffer = buf;
              break;
            }
          }
        } catch (err) {
          // Try next URL fallback
        }
      }

      if (!pdfBuffer) {
        return { rawText: '', metrics: this.extractEmptyMetrics(), isScanned: false };
      }
    } else if (Buffer.isBuffer(source)) {
      pdfBuffer = source;
    } else {
      return { rawText: '', metrics: this.extractEmptyMetrics(), isScanned: false };
    }

    let rawText = '';
    let isScanned = false;

    try {
      const origStdout = process.stdout.write;
      const origStderr = process.stderr.write;
      const origWarn = console.warn;
      const origError = console.error;

      const shouldFilter = (str) => {
        if (typeof str !== 'string') return false;
        return (
          str.includes('TT:') ||
          str.includes('Warning: Index') ||
          str.includes('Invalid CMap')
        );
      };

      process.stdout.write = (...args) => {
        if (shouldFilter(args[0])) return true;
        return origStdout.apply(process.stdout, args);
      };

      process.stderr.write = (...args) => {
        if (shouldFilter(args[0])) return true;
        return origStderr.apply(process.stderr, args);
      };

      console.warn = (...args) => {
        if (shouldFilter(args[0])) return;
        origWarn.apply(console, args);
      };

      console.error = (...args) => {
        if (shouldFilter(args[0])) return;
        origError.apply(console, args);
      };

      const parsedData = await pdfParse(pdfBuffer);
      rawText = parsedData.text ? parsedData.text.trim() : '';

      process.stdout.write = origStdout;
      process.stderr.write = origStderr;
      console.warn = origWarn;
      console.error = origError;
    } catch (err) {
      // PDF parse notice handled silently
    }

    // Fallback to OCR if text is minimal (< 50 chars)
    if (!rawText || rawText.length < 50) {
      isScanned = true;
      try {
        const ocrResult = await ocrEngine.processImage(pdfBuffer);
        rawText = ocrResult.text;
      } catch (ocrErr) {
        // OCR fallback handled silently
      }
    }

    const metrics = this.extractFinancialMetrics(rawText);

    return {
      rawText,
      metrics,
      isScanned,
    };
  }

  /**
   * Detect statement scale multiplier to convert Lakhs / Millions into Crores
   */
  detectScaleMultiplier(text) {
    if (!text) return 1.0;
    const upper = text.toUpperCase();
    if (upper.includes('IN CRORES') || upper.includes('RS. IN CRORES') || upper.includes('(CRORES)') || upper.includes(' CR')) {
      return 1.0; // Already in Crores
    }
    if (upper.includes('IN LAKHS') || upper.includes('RS. IN LAKHS') || upper.includes('RUPEES IN LAKHS') || upper.includes('(LAKHS)')) {
      return 0.01; // Lakhs to Crores (/ 100)
    }
    if (upper.includes('IN MILLIONS') || upper.includes('RS. IN MILLIONS') || upper.includes('(MILLIONS)')) {
      return 0.1; // Millions to Crores (/ 10)
    }
    return 1.0;
  }

  /**
   * Parse numeric array from a table line handling commas and negative parentheses
   */
  parseLineNumbers(line) {
    if (!line) return [];
    // Remove date patterns e.g. 30/06/2026
    let clean = line.replace(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/g, '');
    // Convert parenthesized negative numbers e.g. (308.90) to -308.90
    clean = clean.replace(/\(([^)]+)\)/g, ' -$1 ');
    // Match decimal numbers with or without commas
    const matches = clean.match(/[-+]?\d+(?:,\d+)*(?:\.\d+)?/g);
    if (!matches) return [];
    return matches.map(m => parseFloat(m.replace(/,/g, ''))).filter(n => !isNaN(n));
  }

  /**
   * Extract multi-column financial statement & balance sheet metrics (Sales, OP, PAT, EPS, QoQ %, YoY %)
   * @param {string} text
   * @returns {object}
   */
  extractFinancialMetrics(text) {
    if (!text) return this.extractEmptyMetrics();

    const scaleMultiplier = this.detectScaleMultiplier(text);
    const lines = text.split('\n');
    const tableExtracted = {};

    for (const line of lines) {
      const upper = line.toUpperCase();
      
      // Sales / Revenue Row
      if ((upper.includes('REVENUE FROM OPERATIONS') || upper.includes('TOTAL REVENUE') || upper.includes('INCOME FROM OPERATIONS') || upper.includes('NET SALES') || upper.includes('TURNOVER')) && !tableExtracted.salesCurr) {
        const nums = this.parseLineNumbers(line);
        if (nums.length >= 1) {
          tableExtracted.salesCurr = Math.round(nums[0] * scaleMultiplier * 100) / 100;
          if (nums.length >= 2) tableExtracted.salesPrev = Math.round(nums[1] * scaleMultiplier * 100) / 100;
          if (nums.length >= 3) tableExtracted.salesYoYVal = Math.round(nums[2] * scaleMultiplier * 100) / 100;

          if (tableExtracted.salesCurr && tableExtracted.salesPrev && tableExtracted.salesPrev > 0) {
            tableExtracted.salesQoQ = Math.round(((tableExtracted.salesCurr - tableExtracted.salesPrev) / tableExtracted.salesPrev) * 100 * 10) / 10;
          }
          if (tableExtracted.salesCurr && tableExtracted.salesYoYVal && tableExtracted.salesYoYVal > 0) {
            tableExtracted.salesYoY = Math.round(((tableExtracted.salesCurr - tableExtracted.salesYoYVal) / tableExtracted.salesYoYVal) * 100 * 10) / 10;
          }
        }
      } 
      // Other Income Row
      else if ((upper.includes('OTHER INCOME') || upper.includes('NON-OPERATING INCOME')) && !tableExtracted.otherIncome) {
        const nums = this.parseLineNumbers(line);
        if (nums.length >= 1) {
          tableExtracted.otherIncome = Math.round(nums[0] * scaleMultiplier * 100) / 100;
        }
      } 
      // Operating Profit / EBITDA / PBT Row
      else if ((upper.includes('OPERATING PROFIT') || upper.includes('EBITDA') || upper.includes('PROFIT BEFORE TAX') || upper.includes('PROFIT BEFORE EXCEPTIONAL')) && !tableExtracted.operatingProfit) {
        const nums = this.parseLineNumbers(line);
        if (nums.length >= 1) {
          tableExtracted.operatingProfit = Math.round(nums[0] * scaleMultiplier * 100) / 100;
          if (nums.length >= 2) tableExtracted.opPrev = Math.round(nums[1] * scaleMultiplier * 100) / 100;
          if (nums.length >= 3) tableExtracted.opYoYVal = Math.round(nums[2] * scaleMultiplier * 100) / 100;
        }
      } 
      // Net Profit (PAT) Row
      else if ((upper.includes('PROFIT FOR THE PERIOD') || upper.includes('PROFIT AFTER TAX') || upper.includes('NET PROFIT') || upper.includes('PROFIT/(LOSS) FOR THE PERIOD') || upper.includes('PROFIT AFTER EXCEPTIONAL')) && !tableExtracted.patCurr) {
        const nums = this.parseLineNumbers(line);
        if (nums.length >= 1) {
          tableExtracted.patCurr = Math.round(nums[0] * scaleMultiplier * 100) / 100;
          if (nums.length >= 2) tableExtracted.patPrev = Math.round(nums[1] * scaleMultiplier * 100) / 100;
          if (nums.length >= 3) tableExtracted.patYoYVal = Math.round(nums[2] * scaleMultiplier * 100) / 100;

          if (tableExtracted.patCurr && tableExtracted.patPrev && tableExtracted.patPrev > 0) {
            tableExtracted.patQoQ = Math.round(((tableExtracted.patCurr - tableExtracted.patPrev) / tableExtracted.patPrev) * 100 * 10) / 10;
          }
          if (tableExtracted.patCurr && tableExtracted.patYoYVal && tableExtracted.patYoYVal > 0) {
            tableExtracted.patYoY = Math.round(((tableExtracted.patCurr - tableExtracted.patYoYVal) / tableExtracted.patYoYVal) * 100 * 10) / 10;
          }
        }
      } 
      // EPS Row
      else if ((upper.includes('BASIC EPS') || upper.includes('EARNINGS PER SHARE') || upper.includes('BASIC AND DILUTED EPS') || upper.includes('BASIC (RS.)')) && !tableExtracted.eps) {
        const nums = this.parseLineNumbers(line);
        if (nums.length >= 1) {
          tableExtracted.eps = nums[0]; // EPS is per share rupees (not scaled by lakhs/crores)
        }
      }
    }

    // Calculated OPM % if operating profit and sales exist
    let calculatedOpm = null;
    if (tableExtracted.operatingProfit && tableExtracted.salesCurr && tableExtracted.salesCurr > 0) {
      calculatedOpm = Math.round((tableExtracted.operatingProfit / tableExtracted.salesCurr) * 100 * 10) / 10;
    }

    const upperText = text.toUpperCase();

    // Regex fallbacks
    const salesMatch = upperText.match(/(?:SALES|REVENUE|INCOME|TURNOVER)(?:\s*FROM\s*OPERATIONS)?(?:\s*\([^)]*\))?[:\s=]*₹?\s*([0-9]+(?:\.[0-9]+)?)/);
    const otherIncomeMatch = upperText.match(/(?:OTHER INCOME|NON-OPERATING INCOME)(?:\s*\([^)]*\))?[:\s=]*₹?\s*([0-9]+(?:\.[0-9]+)?)/);
    const opMatch = upperText.match(/(?:OPERATING PROFIT|EBITDA|OP)(?:\s*\([^)]*\))?[:\s=]*₹?\s*([0-9]+(?:\.[0-9]+)?)/);
    const opmMatch = upperText.match(/(?:OPM|OPERATING MARGIN|EBITDA MARGIN)(?:\s*\([^)]*\))?[:\s=]*([0-9]+(?:\.[0-9]+)?)\s*%/);
    const patMatch = upperText.match(/(?:NET PROFIT|PAT|PROFIT AFTER TAX|PROFIT FOR THE PERIOD|PROFIT)(?:\s*\([^)]*\))?[:\s=]*₹?\s*([0-9]+(?:\.[0-9]+)?)/);
    const epsMatch = upperText.match(/(?:EPS|BASIC EPS|EARNINGS PER SHARE)(?:\s*\([^)]*\))?[:\s=]*₹?\s*([0-9]+(?:\.[0-9]+)?)/);

    const salesVal = tableExtracted.salesCurr ?? (salesMatch ? Math.round(parseFloat(salesMatch[1]) * scaleMultiplier * 100) / 100 : null);
    const patVal = tableExtracted.patCurr ?? (patMatch ? Math.round(parseFloat(patMatch[1]) * scaleMultiplier * 100) / 100 : null);
    const epsVal = tableExtracted.eps ?? (epsMatch ? parseFloat(epsMatch[1]) : null);
    const opmVal = (opmMatch ? parseFloat(opmMatch[1]) : null) ?? calculatedOpm;

    const salesQoQ = tableExtracted.salesQoQ ?? null;
    const salesYoY = tableExtracted.salesYoY ?? null;
    const patQoQ = tableExtracted.patQoQ ?? null;
    const patYoY = tableExtracted.patYoY ?? null;

    const salesTTM = salesVal !== null ? Math.round(salesVal * 4 * 100) / 100 : null;
    const patTTM = patVal !== null ? Math.round(patVal * 4 * 100) / 100 : null;
    const epsTTM = epsVal !== null ? Math.round(epsVal * 4 * 100) / 100 : null;

    return {
      sales: salesVal,
      salesPrev: tableExtracted.salesPrev ?? null,
      salesYoYVal: tableExtracted.salesYoYVal ?? null,
      revenue: salesVal,
      otherIncome: tableExtracted.otherIncome ?? (otherIncomeMatch ? Math.round(parseFloat(otherIncomeMatch[1]) * scaleMultiplier * 100) / 100 : null),
      operatingProfit: tableExtracted.operatingProfit ?? (opMatch ? Math.round(parseFloat(opMatch[1]) * scaleMultiplier * 100) / 100 : null),
      ebitda: tableExtracted.operatingProfit ?? (opMatch ? Math.round(parseFloat(opMatch[1]) * scaleMultiplier * 100) / 100 : null),
      opm: opmVal,
      ebitdaMargin: opmVal,
      pat: patVal,
      patPrev: tableExtracted.patPrev ?? null,
      patYoYVal: tableExtracted.patYoYVal ?? null,
      netProfit: patVal,
      eps: epsVal,
      salesQoQ,
      salesYoY,
      patQoQ,
      patYoY,
      salesTTM,
      patTTM,
      epsTTM,
    };
  }

  extractEmptyMetrics() {
    return {
      sales: null,
      salesPrev: null,
      salesYoYVal: null,
      revenue: null,
      otherIncome: null,
      operatingProfit: null,
      ebitda: null,
      opm: null,
      ebitdaMargin: null,
      pat: null,
      patPrev: null,
      patYoYVal: null,
      netProfit: null,
      eps: null,
      salesQoQ: null,
      salesYoY: null,
      patQoQ: null,
      patYoY: null,
      salesTTM: null,
      patTTM: null,
      epsTTM: null,
    };
  }
}

module.exports = new PdfParserEngine();
