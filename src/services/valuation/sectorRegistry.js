const fs = require('fs');
const path = require('path');

class SectorRegistry {
  constructor() {
    this.sectors = new Map();
    this.loadSectorConfigs();
  }

  loadSectorConfigs() {
    const sectorsDir = path.join(__dirname, '../../config/sectors');
    if (!fs.existsSync(sectorsDir)) return;

    const files = fs.readdirSync(sectorsDir);
    for (const file of files) {
      if (file.endsWith('.json')) {
        try {
          const content = fs.readFileSync(path.join(sectorsDir, file), 'utf8');
          const config = JSON.parse(content);
          this.sectors.set(config.sector.toLowerCase(), config);
        } catch (err) {
          console.error(`[SectorRegistry] Error loading ${file}: ${err.message}`);
        }
      }
    }
  }

  /**
   * Auto-classify sector based on industry/sector name or stock ticker
   */
  detectSector(industry = '', symbol = '') {
    const ind = String(industry).toLowerCase();
    const sym = String(symbol).toUpperCase();

    if (ind.includes('bank') || ind.includes('nbfc') || ind.includes('finance') || sym.includes('BANK')) {
      return this.sectors.get('banking') || this.sectors.get('default');
    }
    if (ind.includes('software') || ind.includes('it') || ind.includes('technology') || ind.includes('computers')) {
      return this.sectors.get('it') || this.sectors.get('default');
    }
    if (ind.includes('fmcg') || ind.includes('consumer staples') || ind.includes('food') || ind.includes('paper')) {
      return this.sectors.get('fmcg') || this.sectors.get('default');
    }
    if (ind.includes('metal') || ind.includes('steel') || ind.includes('mining') || ind.includes('aluminum') || ind.includes('polymers')) {
      return this.sectors.get('metals') || this.sectors.get('default');
    }
    if (ind.includes('realty') || ind.includes('real estate') || ind.includes('housing') || ind.includes('construction')) {
      return this.sectors.get('realestate') || this.sectors.get('default');
    }

    return this.sectors.get('default');
  }
}

module.exports = new SectorRegistry();
