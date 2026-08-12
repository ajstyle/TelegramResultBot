const earningsSummaryEngine = require('../ai/earningsSummaryEngine');

/**
 * Pluggable AI Financial Intelligence Adapter
 * Interface delegating to internal heuristics or external LLM APIs (OpenAI, Gemini, Anthropic).
 */
class AiAdapter {
  constructor() {
    this.providerName = 'BuiltIn-AI-Engine';
  }

  /**
   * Generate deep financial summary, pros/cons, hidden risks, and pulse ratings
   * @param {string} symbol
   * @param {string} text
   * @param {object} metrics
   * @returns {object}
   */
  generateSummary(symbol, text, metrics) {
    return earningsSummaryEngine.generateSummary(symbol, text, metrics);
  }
}

module.exports = new AiAdapter();
