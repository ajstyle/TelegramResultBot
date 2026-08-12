const axios = require('axios');
const pdfParse = require('pdf-parse');
const ocrEngine = require('../../ocr/tesseract');

/**
 * PDF Financial Text & Table Extractor Engine
 * Downloads PDFs, extracts financial text/tables, and falls back to OCR if scanned.
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
        console.warn(`[PdfParser] Could not fetch valid PDF binary from ${source}`);
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
          str.includes('font private use area') ||
          str.includes('TT:') ||
          str.includes('invalid function id') ||
          str.includes('Warning:') ||
          str.includes('TrueType')
        );
      };

      process.stdout.write = function (string, encoding, fd) {
        if (shouldFilter(string)) return true;
        return origStdout.apply(process.stdout, arguments);
      };

      process.stderr.write = function (string, encoding, fd) {
        if (shouldFilter(string)) return true;
        return origStderr.apply(process.stderr, arguments);
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
      console.warn(`[PdfParser] Standard PDF text extraction failed: ${err.message}`);
    }

    // If text extraction yielded minimal characters (< 50 chars), fallback to OCR
    if (!rawText || rawText.length < 50) {
      isScanned = true;
      try {
        const ocrResult = await ocrEngine.processImage(pdfBuffer);
        rawText = ocrResult.text;
      } catch (ocrErr) {
        console.warn(`[PdfParser] OCR fallback failed: ${ocrErr.message}`);
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
   * Extract key financial metrics (Sales, Other Income, OP, OPM, PAT, EPS, QoQ, YoY)
   * @param {string} text
   * @returns {object}
   */
  extractFinancialMetrics(text) {
    if (!text) return this.extractEmptyMetrics();

    const upper = text.toUpperCase();

    // Regex matchers for financial figures
    const salesMatch = upper.match(/(?:SALES|REVENUE|INCOME|TURNOVER)(?:\s*FROM\s*OPERATIONS)?(?:\s*\([^)]*\))?[:\s=]*₹?\s*([0-9]+(?:\.[0-9]+)?)/);
    const otherIncomeMatch = upper.match(/(?:OTHER INCOME|NON-OPERATING INCOME)(?:\s*\([^)]*\))?[:\s=]*₹?\s*([0-9]+(?:\.[0-9]+)?)/);
    const opMatch = upper.match(/(?:OPERATING PROFIT|EBITDA|OP)(?:\s*\([^)]*\))?[:\s=]*₹?\s*([0-9]+(?:\.[0-9]+)?)/);
    const opmMatch = upper.match(/(?:OPM|OPERATING MARGIN|EBITDA MARGIN)(?:\s*\([^)]*\))?[:\s=]*([0-9]+(?:\.[0-9]+)?)\s*%/);
    const patMatch = upper.match(/(?:NET PROFIT|PAT|PROFIT AFTER TAX|PROFIT FOR THE PERIOD|PROFIT)(?:\s*\([^)]*\))?[:\s=]*₹?\s*([0-9]+(?:\.[0-9]+)?)/);
    const epsMatch = upper.match(/(?:EPS|BASIC EPS|EARNINGS PER SHARE)(?:\s*\([^)]*\))?[:\s=]*₹?\s*([0-9]+(?:\.[0-9]+)?)/);

    // QoQ & YoY percentage growth extractions
    const salesQoQMatch = upper.match(/(?:SALES|REVENUE)\s*QOQ[:\s=]*([+-]?[0-9]+(?:\.[0-9]+)?)\s*%/);
    const salesYoYMatch = upper.match(/(?:SALES|REVENUE)\s*YOY[:\s=]*([+-]?[0-9]+(?:\.[0-9]+)?)\s*%/);
    const patQoQMatch = upper.match(/(?:PAT|PROFIT)\s*QOQ[:\s=]*([+-]?[0-9]+(?:\.[0-9]+)?)\s*%/);
    const patYoYMatch = upper.match(/(?:PAT|PROFIT)\s*YOY[:\s=]*([+-]?[0-9]+(?:\.[0-9]+)?)\s*%/);

    const salesVal = salesMatch ? parseFloat(salesMatch[1]) : null;
    const patVal = patMatch ? parseFloat(patMatch[1]) : null;
    const epsVal = epsMatch ? parseFloat(epsMatch[1]) : null;

    const salesTTM = salesVal !== null ? Math.round(salesVal * 4 * 100) / 100 : null;
    const patTTM = patVal !== null ? Math.round(patVal * 4 * 100) / 100 : null;
    const epsTTM = epsVal !== null ? Math.round(epsVal * 4 * 100) / 100 : null;

    return {
      sales: salesVal,
      revenue: salesVal,
      otherIncome: otherIncomeMatch ? parseFloat(otherIncomeMatch[1]) : null,
      operatingProfit: opMatch ? parseFloat(opMatch[1]) : null,
      ebitda: opMatch ? parseFloat(opMatch[1]) : null,
      opm: opmMatch ? parseFloat(opmMatch[1]) : null,
      ebitdaMargin: opmMatch ? parseFloat(opmMatch[1]) : null,
      pat: patVal,
      netProfit: patVal,
      eps: epsVal,
      salesQoQ: salesQoQMatch ? parseFloat(salesQoQMatch[1]) : null,
      salesYoY: salesYoYMatch ? parseFloat(salesYoYMatch[1]) : null,
      patQoQ: patQoQMatch ? parseFloat(patQoQMatch[1]) : null,
      patYoY: patYoYMatch ? parseFloat(patYoYMatch[1]) : null,
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
