const { createWorker } = require('tesseract.js');

/**
 * Tesseract OCR Engine Implementation with Lazy Persistent Worker Pool
 * Keeps a warm worker thread for instant image OCR processing.
 */
class TesseractOcrEngine {
  constructor() {
    this.name = 'Tesseract.js';
    this.worker = null;
    this.workerPromise = null;
  }

  async getWorker() {
    if (this.worker) return this.worker;
    if (this.workerPromise) return await this.workerPromise;

    this.workerPromise = (async () => {
      try {
        const worker = await createWorker('eng');
        this.worker = worker;
        return worker;
      } catch (err) {
        console.warn(`[OCR Engine - ${this.name}] Worker init notice: ${err.message}`);
        return null;
      }
    })();

    return await this.workerPromise;
  }

  /**
   * Extract text and confidence score from image buffer
   * @param {Buffer} imageBuffer
   * @returns {Promise<{ text: string, confidence: number }>}
   */
  async processImage(imageBuffer) {
    let activeWorker = await this.getWorker();
    let isTempWorker = false;

    if (!activeWorker) {
      isTempWorker = true;
      activeWorker = await createWorker('eng');
    }

    try {
      const ret = await activeWorker.recognize(imageBuffer);
      const text = ret.data.text ? ret.data.text.trim() : '';
      const confidence = ret.data.confidence || 0;

      if (isTempWorker) {
        await activeWorker.terminate();
      }

      return {
        text,
        confidence,
        raw: ret.data,
      };
    } catch (error) {
      if (isTempWorker && activeWorker) {
        try {
          await activeWorker.terminate();
        } catch (_) {}
      }
      console.error(`[OCR Engine - ${this.name}] Error during OCR: ${error.message}`);
      throw error;
    }
  }
}

module.exports = new TesseractOcrEngine();
