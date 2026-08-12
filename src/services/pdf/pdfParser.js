const axios = require('axios');
const pdfParse = require('pdf-parse');
const ocrEngine = require('../../ocr/tesseract');

/**
 * PDF Financial Text & Table Extractor Engine
 * Downloads PDFs, parses Regulation 33 / Balance Sheet / Financial Statement tables,
 * extracts Sales, OP, PAT, EPS, and calculates QoQ & YoY results.
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
        console.info(`[PdfParser] PDF binary unavailable for filing; using fundamental benchmarks fallback.`);
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
      console.warn(`[PdfParser] Standard PDF text extraction notice: ${err.message}`);
    }

    // Fallback to OCR if text is minimal (< 50 chars)
    if (!rawText || rawText.length < 50) {
      isScanned = true;
      try {
        const ocrResult = await ocrEngine.processImage(pdfBuffer);
        rawText = ocrResult.text;
      } catch (ocrErr) {
        console.warn(`[PdfParser] OCR fallback notice: ${ocrErr.message}`);
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
   * Extract multi-column financial statement & balance sheet metrics (Sales, OP, PAT, EPS, QoQ %, YoY %)
   * @param {string} text
   * @returns {object}
   */
  extractFinancialMetrics(text) {
    if (!text) return this.extractEmptyMetrics();

    const lines = text.split('\n');
    const tableExtracted = {};

    const findNumbersOnLine = (line) => {
      const cleanLine = line.replace(/(\d{2})[/.-](\d{2})[/.-](\d{4})/g, '');
      const matches = cleanLine.match(/[-+]?[0-9]+(?:\.[0-9]+)?/g);
      return matches ? matches.map(Number) : [];
    };

    for (const line of lines) {
      const upper = line.toUpperCase();
      if (upper.includes('REVENUE FROM OPERATIONS') || upper.includes('TOTAL REVENUE') || upper.includes('INCOME FROM OPERATIONS') || upper.includes('NET SALES')) {
        const nums = findNumbersOnLine(line);
        if (nums.length >= 3 && !tableExtracted.salesCurr) {
          tableExtracted.salesCurr = nums[0];
          tableExtracted.salesPrev = nums[1];
          tableExtracted.salesYoYVal = nums[2];
          if (nums[1] > 0) tableExtracted.salesQoQ = Math.round(((nums[0] - nums[1]) / nums[1]) * 100 * 10) / 10;
          if (nums[2] > 0) tableExtracted.salesYoY = Math.round(((nums[0] - nums[2]) / nums[2]) * 100 * 10) / 10;
        }
      } else if (upper.includes('OTHER INCOME') || upper.includes('NON-OPERATING INCOME')) {
        const nums = findNumbersOnLine(line);
        if (nums.length >= 1 && !tableExtracted.otherIncome) {
          tableExtracted.otherIncome = nums[0];
        }
      } else if (upper.includes('OPERATING PROFIT') || upper.includes('EBITDA') || upper.includes('PROFIT BEFORE TAX')) {
        const nums = findNumbersOnLine(line);
        if (nums.length >= 1 && !tableExtracted.operatingProfit) {
          tableExtracted.operatingProfit = nums[0];
        }
      } else if (upper.includes('PROFIT FOR THE PERIOD') || upper.includes('PROFIT AFTER TAX') || upper.includes('NET PROFIT') || upper.includes('PAT')) {
        const nums = findNumbersOnLine(line);
        if (nums.length >= 3 && !tableExtracted.patCurr) {
          tableExtracted.patCurr = nums[0];
          tableExtracted.patPrev = nums[1];
          tableExtracted.patYoYVal = nums[2];
          if (nums[1] > 0) tableExtracted.patQoQ = Math.round(((nums[0] - nums[1]) / nums[1]) * 100 * 10) / 10;
          if (nums[2] > 0) tableExtracted.patYoY = Math.round(((nums[0] - nums[2]) / nums[2]) * 100 * 10) / 10;
        }
      } else if (upper.includes('EPS') || upper.includes('EARNINGS PER SHARE') || upper.includes('BASIC EPS')) {
        const nums = findNumbersOnLine(line);
        if (nums.length >= 1 && !tableExtracted.eps) {
          tableExtracted.eps = nums[0];
        }
      }
    }

    const upperText = text.toUpperCase();

    // Regex fallbacks
    const salesMatch = upperText.match(/(?:SALES|REVENUE|INCOME|TURNOVER)(?:\s*FROM\s*OPERATIONS)?(?:\s*\([^)]*\))?[:\s=]*₹?\s*([0-9]+(?:\.[0-9]+)?)/);
    const otherIncomeMatch = upperText.match(/(?:OTHER INCOME|NON-OPERATING INCOME)(?:\s*\([^)]*\))?[:\s=]*₹?\s*([0-9]+(?:\.[0-9]+)?)/);
    const opMatch = upperText.match(/(?:OPERATING PROFIT|EBITDA|OP)(?:\s*\([^)]*\))?[:\s=]*₹?\s*([0-9]+(?:\.[0-9]+)?)/);
    const opmMatch = upperText.match(/(?:OPM|OPERATING MARGIN|EBITDA MARGIN)(?:\s*\([^)]*\))?[:\s=]*([0-9]+(?:\.[0-9]+)?)\s*%/);
    const patMatch = upperText.match(/(?:NET PROFIT|PAT|PROFIT AFTER TAX|PROFIT FOR THE PERIOD|PROFIT)(?:\s*\([^)]*\))?[:\s=]*₹?\s*([0-9]+(?:\.[0-9]+)?)/);
    const epsMatch = upperText.match(/(?:EPS|BASIC EPS|EARNINGS PER SHARE)(?:\s*\([^)]*\))?[:\s=]*₹?\s*([0-9]+(?:\.[0-9]+)?)/);

    const salesVal = tableExtracted.salesCurr ?? (salesMatch ? parseFloat(salesMatch[1]) : null);
    const patVal = tableExtracted.patCurr ?? (patMatch ? parseFloat(patMatch[1]) : null);
    const epsVal = tableExtracted.eps ?? (epsMatch ? parseFloat(epsMatch[1]) : null);

    const salesQoQ = tableExtracted.salesQoQ ?? null;
    const salesYoY = tableExtracted.salesYoY ?? null;
    const patQoQ = tableExtracted.patQoQ ?? null;
    const patYoY = tableExtracted.patYoY ?? null;

    const salesTTM = salesVal !== null ? Math.round(salesVal * 4 * 100) / 100 : null;
    const patTTM = patVal !== null ? Math.round(patVal * 4 * 100) / 100 : null;
    const epsTTM = epsVal !== null ? Math.round(epsVal * 4 * 100) / 100 : null;

    return {
      sales: salesVal,
      revenue: salesVal,
      otherIncome: tableExtracted.otherIncome ?? (otherIncomeMatch ? parseFloat(otherIncomeMatch[1]) : null),
      operatingProfit: tableExtracted.operatingProfit ?? (opMatch ? parseFloat(opMatch[1]) : null),
      ebitda: tableExtracted.operatingProfit ?? (opMatch ? parseFloat(opMatch[1]) : null),
      opm: opmMatch ? parseFloat(opmMatch[1]) : null,
      ebitdaMargin: opmMatch ? parseFloat(opmMatch[1]) : null,
      pat: patVal,
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
      revenue: null,
      otherIncome: null,
      operatingProfit: null,
      ebitda: null,
      opm: null,
      ebitdaMargin: null,
      pat: null,
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
