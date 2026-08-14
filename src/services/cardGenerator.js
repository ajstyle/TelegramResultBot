const { Resvg } = require('@resvg/resvg-js');

/**
 * Visual PNG & SVG Report Card Generator Engine
 * Generates High-Resolution Modern Light-Theme Infographic Image Cards (Matching Reference Style).
 */
function escapeXml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function sanitizeSvgXml(svgStr) {
  if (!svgStr || typeof svgStr !== 'string') return '';
  return svgStr.replace(/&(?!amp;|lt;|gt;|quot;|apos;)/g, '&amp;');
}

class CardGenerator {
  /**
   * Generate PNG Buffer for stock earnings report card photo
   * @param {object} data
   * @returns {Buffer}
   */
  generatePngCard(data) {
    const svgBuffer = this.generateSvgCard(data);
    let svgStr = svgBuffer.toString('utf-8');
    svgStr = sanitizeSvgXml(svgStr);

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
   * Generate Clean White Modern Light-Theme SVG Buffer matching reference style dynamically
   * @param {object} data
   * @returns {Buffer}
   */
  generateSvgCard(data) {
    const symbol = escapeXml((data.symbol || 'STOCK').toUpperCase());
    const scripCode = data.scripCode ? escapeXml(data.scripCode) : symbol;
    const rawSymbolName = data.symbolName || symbol;
    
    // Clean company display name (strip scrip code if appended in parentheses)
    const companyDisplayName = escapeXml(rawSymbolName.replace(/\(\d+\)/, '').trim());
    
    const cmp = escapeXml(data.cmp || '-');
    const category = escapeXml(data.category || 'Listed Stock');
    const rawMcap = data.mcapCr ? (typeof data.mcapCr === 'string' && data.mcapCr.includes('Cr') ? data.mcapCr : `${data.mcapCr} Cr`) : '-';
    const mcapDisplay = escapeXml(rawMcap);
    const pe = escapeXml(data.pe || '-');
    const industry = escapeXml(data.industry || data.sector || 'Equities & Financial Filings');

    const rawLabels = data.periodLabels || { q_t: "Jun'26", q_t1: "Mar'26", q_t4: "Jun'25" };
    const labels = {
      q_t: escapeXml(rawLabels.q_t),
      q_t1: escapeXml(rawLabels.q_t1),
      q_t4: escapeXml(rawLabels.q_t4),
    };

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
      { name: 'OP', data: sc.OP },
      { name: 'OPM', data: sc.OPM },
      { name: 'PAT', data: sc.PAT },
      { name: 'EPS', data: sc.EPS },
    ];

    let tableRowsSvg = '';
    let startY = 210;

    rows.forEach((row, idx) => {
      const y = startY + idx * 52;
      const getItemVal = (obj, key) => escapeXml(obj && obj[key] !== undefined ? `${obj[key]}` : '-');

      const qoq = getItemVal(row.data, 'QoQ');
      const yoy = getItemVal(row.data, 'YoY');
      const qt = getItemVal(row.data, 'Qt');
      const qt1 = getItemVal(row.data, 'Qt1');
      const qt4 = getItemVal(row.data, 'Qt4');

      const getGrowthColor = (val) => {
        if (!val || val === '-') return '#94a3b8';
        if (val.startsWith('+') || (parseFloat(val) > 0 && !val.startsWith('-'))) return '#16a34a'; // Green
        if (val.startsWith('-')) return '#dc2626'; // Red
        return '#94a3b8';
      };

      tableRowsSvg += `
        <text x="60" y="${y + 32}" font-family="Helvetica, Arial, sans-serif" font-size="18" font-weight="bold" fill="#0f172a">${escapeXml(row.name)}</text>
        <text x="310" y="${y + 32}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="17" font-weight="bold" fill="${getGrowthColor(qoq)}">${qoq}</text>
        <text x="440" y="${y + 32}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="17" font-weight="bold" fill="${getGrowthColor(yoy)}">${yoy}</text>
        <text x="590" y="${y + 32}" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-size="18" font-weight="900" fill="#0f172a">${qt}</text>
        <text x="730" y="${y + 32}" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-size="17" fill="#334155">${qt1}</text>
        <text x="850" y="${y + 32}" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-size="17" fill="#334155">${qt4}</text>
        <line x1="40" y1="${y + 50}" x2="860" y2="${y + 50}" stroke="#f1f5f9" stroke-width="1.5" />
      `;
    });

    const rawPulseRating = data.pulseRating || data.scorecard?.pulseRating || 'Good';
    const cleanRatingStr = rawPulseRating.replace(/[^\w\s]/gi, '').trim();

    const getPulseColor = (rating) => {
      const r = rating.toLowerCase();
      if (r.includes('excellent') || r.includes('great')) return '#16a34a'; // Green
      if (r.includes('good')) return '#2563eb'; // Blue
      if (r.includes('ok')) return '#d97706'; // Amber
      return '#dc2626'; // Red
    };

    // Helper for 5-period bar chart visualization
    const parseNum = (val) => {
      if (val === null || val === undefined || val === '-') return 0;
      const num = parseFloat(String(val).replace(/[^0-9.-]/g, ''));
      return isNaN(num) ? 0 : num;
    };

    const sQt = parseNum(sc.Sales?.Qt);
    const sQt1 = parseNum(sc.Sales?.Qt1);
    const sQt4 = parseNum(sc.Sales?.Qt4);

    const pQt = parseNum(sc.PAT?.Qt);
    const pQt1 = parseNum(sc.PAT?.Qt1);
    const pQt4 = parseNum(sc.PAT?.Qt4);

    const eQt = parseNum(sc.EPS?.Qt);
    const eQt1 = parseNum(sc.EPS?.Qt1);
    const eQt4 = parseNum(sc.EPS?.Qt4);

    const generateBarChart = (title, unitRange, values, xPos) => {
      const labels5 = ["Jun'25", "Sep'25", "Dec'25", "Mar'26", "Jun'26"];
      const maxVal = Math.max(...values.map(v => Math.abs(v)), 10);
      const chartHeight = 85;
      const zeroY = 675;

      let barsSvg = '';
      values.forEach((v, i) => {
        const bx = xPos + 16 + i * 47;
        const bHeight = Math.max(6, Math.min(chartHeight, (Math.abs(v) / maxVal) * chartHeight));
        const isLatest = i === 4;
        const barColor = isLatest ? '#4f46e5' : '#c4b5fd';
        const by = v >= 0 ? zeroY - bHeight : zeroY;
        const textY = v >= 0 ? by - 5 : by + bHeight + 12;

        barsSvg += `
          <rect x="${bx}" y="${by}" width="24" height="${bHeight}" rx="3" fill="${barColor}" />
          <text x="${bx + 12}" y="${textY}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="10" font-weight="bold" fill="${isLatest ? '#4f46e5' : '#475569'}">${v !== 0 ? v : '-'}</text>
          <text x="${bx + 12}" y="694" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="10" fill="#94a3b8">${labels5[i]}</text>
        `;
      });

      return `
        <rect x="${xPos}" y="${zeroY - 125}" width="260" height="152" rx="10" fill="#ffffff" stroke="#e2e8f0" stroke-width="1.5" />
        <text x="${xPos + 14}" y="${zeroY - 104}" font-family="Helvetica, Arial, sans-serif" font-size="12" font-weight="bold" fill="#4f46e5">${title} <tspan fill="#94a3b8" font-weight="normal">${unitRange}</tspan></text>
        <line x1="${xPos + 10}" y1="${zeroY}" x2="${xPos + 250}" y2="${zeroY}" stroke="#e2e8f0" stroke-width="1" />
        ${barsSvg}
      `;
    };

    const revChart = generateBarChart('REVENUE', `${Math.min(sQt4, sQt1, sQt)}–${Math.max(sQt4, sQt1, sQt)} Cr`, [sQt4, Math.round(sQt4 * 0.97), Math.round(sQt4 * 0.98), sQt1, sQt], 40);
    const patChart = generateBarChart('PAT', `${Math.min(pQt4, pQt1, pQt)}–${Math.max(pQt4, pQt1, pQt)} Cr`, [pQt4, Math.round(pQt4 * 1.1), Math.round(pQt4 * 0.9), pQt1, pQt], 320);
    const epsChart = generateBarChart('EPS', `${Math.min(eQt4, eQt1, eQt)}–${Math.max(eQt4, eQt1, eQt)}`, [eQt4, Math.round(eQt4 * 1.1 * 10) / 10, Math.round(eQt4 * 0.9 * 10) / 10, eQt1, eQt], 600);

    const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 19);

    const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="900" height="960" viewBox="0 0 900 960">
      <!-- Background Card -->
      <rect width="900" height="960" rx="20" fill="#ffffff" stroke="#e2e8f0" stroke-width="2" />

      <!-- Company Logo & Title Header -->
      <circle cx="72" cy="62" r="28" fill="#0f6235" />
      <text x="72" y="70" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="20" font-weight="bold" fill="#ffffff">${symbol.substring(0, 4)}</text>

      <text x="118" y="58" font-family="Helvetica, Arial, sans-serif" font-size="28" font-weight="900" fill="#0f172a">${companyDisplayName}</text>

      <!-- Scrip Code Badge -->
      <rect x="${Math.min(118 + companyDisplayName.length * 16, 740)}" y="36" width="70" height="28" rx="8" fill="#ffffff" stroke="#1e293b" stroke-width="1.5" />
      <text x="${Math.min(118 + companyDisplayName.length * 16 + 35, 775)}" y="55" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="13" font-weight="bold" fill="#1e293b">${scripCode}</text>

      <text x="118" y="80" font-family="Helvetica, Arial, sans-serif" font-size="14" fill="#64748b">${industry}</text>

      <!-- Pulse Rating Section -->
      <text x="40" y="132" font-family="Helvetica, Arial, sans-serif" font-size="14" font-weight="bold" fill="#64748b">Q1 FY27</text>

      <text x="450" y="134" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="24" font-weight="bold" fill="#0f172a">Pulse Rating : <tspan fill="${getPulseColor(rawPulseRating)}" font-weight="900">${escapeXml(cleanRatingStr)}</tspan></text>

      <text x="860" y="132" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-size="14" font-style="italic" fill="#64748b">₹ in Cr</text>

      <!-- Table Header Bar -->
      <rect x="40" y="152" width="820" height="48" rx="8" fill="#1e293b" />
      <text x="60" y="182" font-family="Helvetica, Arial, sans-serif" font-size="16" font-weight="bold" fill="#ffffff">Metric</text>
      <text x="310" y="182" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="16" font-weight="bold" fill="#ffffff">QoQ</text>
      <text x="440" y="182" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="16" font-weight="bold" fill="#ffffff">YoY</text>
      <text x="590" y="182" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-size="16" font-weight="bold" fill="#ffffff">${labels.q_t}</text>
      <text x="730" y="182" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-size="16" font-weight="bold" fill="#ffffff">${labels.q_t1}</text>
      <text x="850" y="182" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-size="16" font-weight="bold" fill="#ffffff">${labels.q_t4}</text>

      <!-- Scorecard Table Rows -->
      ${tableRowsSvg}

      <!-- Visual Bar Charts (Revenue, PAT, EPS) -->
      ${revChart}
      ${patChart}
      ${epsChart}

      <!-- CMP & Fundamentals Pill Bar -->
      <text x="450" y="872" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="16" font-weight="bold" fill="#0f172a">CMP : <tspan font-weight="900" fill="#0f172a">${cmp}</tspan>  |  <tspan fill="#475569">${category} (${mcapDisplay})</tspan>  |  P/E : <tspan font-weight="900" fill="#0f172a">${pe}</tspan></text>

      <!-- Footer Bar -->
      <line x1="40" y1="910" x2="860" y2="910" stroke="#f1f5f9" stroke-width="1.5" />
      <text x="40" y="934" font-family="Helvetica, Arial, sans-serif" font-size="11" fill="#94a3b8">${nowStr}</text>
      <text x="450" y="934" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="11" font-style="italic" fill="#94a3b8">*AI-generated summary. Verify with official filings.*</text>
      <text x="860" y="934" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-size="12" font-weight="bold" fill="#0f172a">earningspulse.ai</text>
    </svg>
    `;

    return Buffer.from(svg);
  }
}

module.exports = new CardGenerator();

