const { Resvg } = require('@resvg/resvg-js');

/**
 * Visual PNG & SVG Report Card Generator Engine
 * Generates High-Resolution Dark-Mode PNG Infographic Image Cards for the Gemini Quantitative Scorecard Dashboard Table.
 */
class CardGenerator {
  /**
   * Generate PNG Buffer for stock earnings report card photo
   * @param {object} data
   * @returns {Buffer}
   */
  generatePngCard(data) {
    const svgBuffer = this.generateSvgCard(data);
    const svgStr = svgBuffer.toString('utf-8');
    try {
      const resvg = new Resvg(svgStr, {
        fitTo: { mode: 'width', value: 900 },
        font: { loadSystemFonts: true },
      });
      return resvg.render().asPng();
    } catch (e) {
      console.warn('[CardGenerator] Resvg primary rendering notice:', e.message);
      try {
        const fallbackResvg = new Resvg(svgStr, {
          fitTo: { mode: 'width', value: 900 },
          font: { loadSystemFonts: false },
        });
        return fallbackResvg.render().asPng();
      } catch (err2) {
        console.error('[CardGenerator] Resvg PNG fallback error:', err2.message);
        return svgBuffer;
      }
    }
  }

  /**
   * Generate SVG Buffer for Gemini Quantitative Scorecard Dashboard Table dynamically
   * @param {object} data
   * @returns {Buffer}
   */
  generateSvgCard(data) {
    const symbol = (data.symbol || 'STOCK').toUpperCase();
    const scripCode = data.scripCode ? `(${data.scripCode})` : '';
    const symbolName = data.symbolName || `${symbol} ${scripCode}`;
    const cmp = data.cmp || '₹500';
    const category = data.category || 'Listed Stock';
    const mcapDisplay = data.mcapCr ? `${data.mcapCr} Cr` : '-';
    const pe = data.pe || '-';

    const labels = data.periodLabels || { q_t: "Jun '26", q_t1: "Mar '26", q_t4: "Jun '25" };
    const sc = data.scorecard || {
      Sales: { QoQ: '-', YoY: '-', Qt: '-', Qt1: '-', Qt4: '-' },
      'Other Inc.': { QoQ: '-', YoY: '-', Qt: '-', Qt1: '-', Qt4: '-' },
      OP: { QoQ: '-', YoY: '-', Qt: '-', Qt1: '-', Qt4: '-' },
      OPM: { QoQ: '-', YoY: '-', Qt: '-', Qt1: '-', Qt4: '-' },
      PAT: { QoQ: '-', YoY: '-', Qt: '-', Qt1: '-', Qt4: '-' },
      EPS: { QoQ: '-', YoY: '-', Qt: '-', Qt1: '-', Qt4: '-' },
    };

    const rows = [
      { name: 'Sales', data: sc.Sales },
      { name: 'Other Inc.', data: sc['Other Inc.'] },
      { name: 'OP (Profit)', data: sc.OP },
      { name: 'OPM (%)', data: sc.OPM },
      { name: 'PAT (Net)', data: sc.PAT },
      { name: 'EPS (₹)', data: sc.EPS },
    ];

    let tableRowsSvg = '';
    let startY = 220;

    rows.forEach((row, idx) => {
      const y = startY + idx * 52;
      const bgFill = idx % 2 === 0 ? '#1e293b' : '#0f172a';

      const getItemVal = (obj, key) => (obj && obj[key] !== undefined ? `${obj[key]}` : '-');

      const qoq = getItemVal(row.data, 'QoQ');
      const yoy = getItemVal(row.data, 'YoY');
      const qt = getItemVal(row.data, 'Qt');
      const qt1 = getItemVal(row.data, 'Qt1');
      const qt4 = getItemVal(row.data, 'Qt4');

      const getGrowthColor = (val) => {
        if (val.startsWith('+')) return '#10b981'; // Green
        if (val.startsWith('-')) return '#ef4444'; // Red
        return '#94a3b8';
      };

      tableRowsSvg += `
        <rect x="40" y="${y}" width="820" height="48" rx="6" fill="${bgFill}" />
        <text x="60" y="${y + 30}" font-family="Helvetica, Arial, sans-serif" font-size="16" font-weight="bold" fill="#f8fafc">${row.name}</text>
        <text x="210" y="${y + 30}" font-family="Helvetica, Arial, sans-serif" font-size="15" font-weight="bold" fill="${getGrowthColor(qoq)}">${qoq}</text>
        <text x="340" y="${y + 30}" font-family="Helvetica, Arial, sans-serif" font-size="15" font-weight="bold" fill="${getGrowthColor(yoy)}">${yoy}</text>
        <text x="490" y="${y + 30}" font-family="Helvetica, Arial, sans-serif" font-size="16" font-weight="bold" fill="#38bdf8">${qt}</text>
        <text x="630" y="${y + 30}" font-family="Helvetica, Arial, sans-serif" font-size="15" fill="#cbd5e1">${qt1}</text>
        <text x="760" y="${y + 30}" font-family="Helvetica, Arial, sans-serif" font-size="15" fill="#cbd5e1">${qt4}</text>
      `;
    });

    const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="900" height="600" viewBox="0 0 900 600">
      <defs>
        <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#090d16" />
          <stop offset="50%" stop-color="#0f172a" />
          <stop offset="100%" stop-color="#1e1b4b" />
        </linearGradient>
        <linearGradient id="headerGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#38bdf8" />
          <stop offset="100%" stop-color="#818cf8" />
        </linearGradient>
      </defs>

      <!-- Background -->
      <rect width="900" height="600" rx="16" fill="url(#bgGrad)" />
      <rect x="2" y="2" width="896" height="596" rx="14" fill="none" stroke="#334155" stroke-width="2" />

      <!-- Top Badge -->
      <rect x="40" y="30" width="340" height="32" rx="16" fill="#1e293b" stroke="#38bdf8" stroke-width="1.5" />
      <circle cx="58" cy="46" r="6" fill="#10b981" />
      <text x="74" y="52" font-family="Helvetica, Arial, sans-serif" font-size="13" font-weight="bold" fill="#38bdf8">⚡ GEMINI QUANTITATIVE SCORECARD</text>

      <!-- Header Ticker & Name -->
      <text x="40" y="98" font-family="Helvetica, Arial, sans-serif" font-size="26" font-weight="bold" fill="#f8fafc">${symbolName}</text>

      <!-- Sub Header Pill -->
      <rect x="40" y="115" width="820" height="36" rx="8" fill="#1e293b" />
      <text x="55" y="138" font-family="Helvetica, Arial, sans-serif" font-size="14" font-weight="bold" fill="#f59e0b">CMP: ${cmp}</text>
      <text x="250" y="138" font-family="Helvetica, Arial, sans-serif" font-size="14" fill="#94a3b8">Category: <tspan fill="#f8fafc" font-weight="bold">${category}</tspan></text>
      <text x="520" y="138" font-family="Helvetica, Arial, sans-serif" font-size="14" fill="#94a3b8">Market Cap: <tspan fill="#f8fafc" font-weight="bold">${mcapDisplay}</tspan></text>
      <text x="740" y="138" font-family="Helvetica, Arial, sans-serif" font-size="14" fill="#94a3b8">P/E: <tspan fill="#f8fafc" font-weight="bold">${pe}</tspan></text>

      <!-- Table Header Bar -->
      <rect x="40" y="170" width="820" height="42" rx="6" fill="url(#headerGrad)" />
      <text x="60" y="196" font-family="Helvetica, Arial, sans-serif" font-size="15" font-weight="bold" fill="#090d16">METRIC</text>
      <text x="210" y="196" font-family="Helvetica, Arial, sans-serif" font-size="15" font-weight="bold" fill="#090d16">QoQ %</text>
      <text x="340" y="196" font-family="Helvetica, Arial, sans-serif" font-size="15" font-weight="bold" fill="#090d16">YoY %</text>
      <text x="480" y="196" font-family="Helvetica, Arial, sans-serif" font-size="15" font-weight="bold" fill="#090d16">${labels.q_t} (Q_t)</text>
      <text x="620" y="196" font-family="Helvetica, Arial, sans-serif" font-size="15" font-weight="bold" fill="#090d16">${labels.q_t1} (Q_t1)</text>
      <text x="750" y="196" font-family="Helvetica, Arial, sans-serif" font-size="15" font-weight="bold" fill="#090d16">${labels.q_t4} (Q_t4)</text>

      <!-- Rows -->
      ${tableRowsSvg}

      <!-- Footer Bar -->
      <line x1="40" y1="545" x2="860" y2="545" stroke="#334155" stroke-width="1" />
      <text x="40" y="572" font-family="Helvetica, Arial, sans-serif" font-size="12" fill="#64748b">⚡ AI Financial Engine • Gemini 3.5 Flash Model • SEBI Ind-AS Format</text>
      <text x="740" y="572" font-family="Helvetica, Arial, sans-serif" font-size="12" font-weight="bold" fill="#10b981">LIVE 24/7 ACTIVE</text>
    </svg>
    `;

    return Buffer.from(svg);
  }
}

module.exports = new CardGenerator();
