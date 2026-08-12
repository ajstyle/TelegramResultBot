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
      try {
        const res = await axios.get(source, {
          responseType: 'arraybuffer',
          timeout: 15000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          },
        });
        pdfBuffer = Buffer.from(res.data);
      } catch (err) {
        console.warn(`[PdfParser] Failed to download PDF from URL: ${err.message}`);
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
      const parsedData = await pdfParse(pdfBuffer);
      rawText = parsedData.text ? parsedData.text.trim() : '';
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

    return {
      sales: salesMatch ? parseFloat(salesMatch[1]) : null,
      revenue: salesMatch ? parseFloat(salesMatch[1]) : null,
      otherIncome: otherIncomeMatch ? parseFloat(otherIncomeMatch[1]) : null,
      operatingProfit: opMatch ? parseFloat(opMatch[1]) : null,
      ebitda: opMatch ? parseFloat(opMatch[1]) : null,
      opm: opmMatch ? parseFloat(opmMatch[1]) : null,
      ebitdaMargin: opmMatch ? parseFloat(opmMatch[1]) : null,
      pat: patMatch ? parseFloat(patMatch[1]) : null,
      netProfit: patMatch ? parseFloat(patMatch[1]) : null,
      eps: epsMatch ? parseFloat(epsMatch[1]) : null,
      salesQoQ: salesQoQMatch ? parseFloat(salesQoQMatch[1]) : null,
      salesYoY: salesYoYMatch ? parseFloat(salesYoYMatch[1]) : null,
      patQoQ: patQoQMatch ? parseFloat(patQoQMatch[1]) : null,
      patYoY: patYoYMatch ? parseFloat(patYoYMatch[1]) : null,
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
    };
  }
}

module.exports = new PdfParserEngine();
