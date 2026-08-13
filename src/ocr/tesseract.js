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
   * Validate image buffer header magic bytes (PNG, JPEG, WebP, GIF, BMP, TIFF)
   */
  isValidImageBuffer(buf) {
    if (!buf || !Buffer.isBuffer(buf) || buf.length < 32) return false;
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return true; // PNG
    if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return true; // JPEG
    if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) return true; // RIFF/WebP
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return true; // GIF
    if (buf[0] === 0x42 && buf[1] === 0x4D) return true; // BMP
    if ((buf[0] === 0x49 && buf[1] === 0x49) || (buf[0] === 0x4D && buf[1] === 0x4D)) return true; // TIFF
    return false;
  }

  /**
   * Extract text and confidence score from image buffer
   * @param {Buffer} imageBuffer
   * @returns {Promise<{ text: string, confidence: number }>}
   */
  async processImage(imageBuffer) {
    if (!this.isValidImageBuffer(imageBuffer)) {
      return { text: '', confidence: 0 };
    }

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
      const errMsg = (error && typeof error === 'object' && error.message) ? error.message : (error || 'Unknown error');
      console.warn(`[OCR Engine - ${this.name}] Error during OCR: ${errMsg}`);
      return { text: '', confidence: 0, raw: null };
    }
  }
}

module.exports = new TesseractOcrEngine();
