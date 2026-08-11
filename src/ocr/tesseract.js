const { createWorker } = require('tesseract.js');

/**
 * Tesseract OCR Engine Implementation
 *
 * Implements the standard OCR Interface:
 *   processImage(buffer: Buffer): Promise<{ text: string, confidence: number }>
 */
class TesseractOcrEngine {
  constructor() {
    this.name = 'Tesseract.js';
  }

  /**
   * Extract text and confidence score from image buffer
   * @param {Buffer} imageBuffer
   * @returns {Promise<{ text: string, confidence: number }>}
   */
  async processImage(imageBuffer) {
    let worker = null;
    try {
      worker = await createWorker('eng');
      const ret = await worker.recognize(imageBuffer);
      await worker.terminate();

      const text = ret.data.text ? ret.data.text.trim() : '';
      const confidence = ret.data.confidence || 0;

      return {
        text,
        confidence,
        raw: ret.data,
      };
    } catch (error) {
      if (worker) {
        try {
          await worker.terminate();
        } catch (_) {}
      }
      console.error(`[OCR Engine - ${this.name}] Error during OCR: ${error.message}`);
      throw error;
    }
  }
}

module.exports = new TesseractOcrEngine();
