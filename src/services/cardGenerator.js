const { Resvg } = require('@resvg/resvg-js');

/**
 * Visual PNG & SVG Report Card Generator
 * Generates visual Image Cards matching earningspulse.ai card layout
 */
class CardGenerator {
  /**
   * Generate PNG Buffer for stock earnings report card photo
   * @param {object} data
   * @returns {Buffer}
   */
  generatePngCard(data) {
    const svgBuffer = this.generateSvgCard(data);
    try {
      const resvg = new Resvg(svgBuffer.toString('utf-8'), {
        fitTo: { mode: 'width', value: 800 },
      });
      const pngData = resvg.render();
      return pngData.asPng();
    } catch (e) {
      console.error('[CardGenerator] Resvg PNG rendering error:', e.message);
      return svgBuffer;
    }
  }

  /**
   * Generate SVG Buffer for stock earnings report card
   * @param {object} data
   * @returns {Buffer}
   */
  generateSvgCard(data) {
    const symbol = (data.symbol || 'STOCK').toUpperCase();
    const symbolName = data.symbolName || symbol;
    const subtitle = data.subtitle || 'NSE / BSE Listed Company';
    const rating = data.rating || 'Excellent';
    const salesQoQ = data.salesQoQ || '111';
    const salesYoY = data.salesYoY || '150';
    const salesCurr = data.salesCurr || '1,735';
    const salesPrev = data.salesPrev || '823';
    const salesYoYVal = data.salesYoYVal || '693';
    const opm = data.opm || '22.4';
    const patQoQ = data.patQoQ || '334';
    const patYoY = data.patYoY || '625';
    const cmp = data.cmp || '563.8';
    const category = data.category || 'Small-Cap';
    const mcap = data.mcap || '3.3K Cr';
    const pe = data.pe || '15.2';

    const svg = `<svg width="800" height="850" xmlns="http://www.w3.org/2000/svg">
    <style>
      .title { font-family: system-ui, -apple-system, sans-serif; font-size: 26px; font-weight: bold; fill: #111827; }
      .badge { font-family: system-ui, -apple-system, sans-serif; font-size: 14px; font-weight: bold; fill: #374151; }
      .sub { font-family: system-ui, -apple-system, sans-serif; font-size: 14px; fill: #6b7280; }
      .rating-title { font-family: system-ui, -apple-system, sans-serif; font-size: 20px; fill: #4b5563; }
      .rating-val { font-family: system-ui, -apple-system, sans-serif; font-size: 28px; font-weight: bold; fill: #10b981; }
      .th { font-family: system-ui, -apple-system, sans-serif; font-size: 16px; font-weight: bold; fill: #ffffff; }
      .td-metric { font-family: system-ui, -apple-system, sans-serif; font-size: 18px; font-weight: bold; fill: #111827; }
      .td-green { font-family: system-ui, -apple-system, sans-serif; font-size: 18px; font-weight: bold; fill: #10b981; }
      .td-num { font-family: system-ui, -apple-system, sans-serif; font-size: 18px; font-weight: bold; fill: #1f2937; }
      .footer { font-family: system-ui, -apple-system, sans-serif; font-size: 16px; font-weight: bold; fill: #1f2937; }
    </style>

    <rect width="800" height="850" rx="24" fill="#ffffff" stroke="#e5e7eb" stroke-width="3"/>

    <text x="60" y="60" class="title">${symbolName}</text>
    <rect x="340" y="38" width="120" height="30" rx="8" fill="#f3f4f6" stroke="#d1d5db"/>
    <text x="400" y="58" text-anchor="middle" class="badge">${symbol}</text>
    <text x="60" y="88" class="sub">${subtitle}</text>

    <text x="60" y="140" class="sub">Q1 FY27</text>
    <text x="400" y="140" text-anchor="middle" class="rating-title">Pulse Rating : <tspan class="rating-val">${rating}</tspan></text>
    <text x="740" y="140" text-anchor="end" class="sub" style="font-style: italic;">in Cr</text>

    <rect x="40" y="160" width="720" height="50" rx="10" fill="#1e293b"/>
    <text x="70" y="192" class="th">Metric</text>
    <text x="240" y="192" class="th">QoQ</text>
    <text x="360" y="192" class="th">YoY</text>
    <text x="480" y="192" class="th">Jun'26</text>
    <text x="600" y="192" class="th">Mar'26</text>
    <text x="710" y="192" class="th">Jun'25</text>

    <!-- Row 1: Sales -->
    <text x="70" y="245" class="td-metric">Sales</text>
    <text x="240" y="245" class="td-green">+${salesQoQ}%</text>
    <text x="360" y="245" class="td-green">+${salesYoY}%</text>
    <text x="480" y="245" class="td-num">${salesCurr}</text>
    <text x="600" y="245" class="td-num">${salesPrev}</text>
    <text x="710" y="245" class="td-num">${salesYoYVal}</text>
    <line x1="40" y1="265" x2="760" y2="265" stroke="#f1f5f9" stroke-width="1.5"/>

    <!-- Row 2: Other Income -->
    <text x="70" y="305" class="td-metric">Other Inc.</text>
    <text x="240" y="305" class="td-num">-</text>
    <text x="360" y="305" class="td-num">-</text>
    <text x="480" y="305" class="td-num">4</text>
    <text x="600" y="305" class="td-num">3</text>
    <text x="710" y="305" class="td-num">4</text>
    <line x1="40" y1="325" x2="760" y2="325" stroke="#f1f5f9" stroke-width="1.5"/>

    <!-- Row 3: Operating Profit (OP) -->
    <text x="70" y="365" class="td-metric">OP</text>
    <text x="240" y="365" class="td-green">+325%</text>
    <text x="360" y="365" class="td-green">+607%</text>
    <text x="480" y="365" class="td-num">388</text>
    <text x="600" y="365" class="td-num">91</text>
    <text x="710" y="365" class="td-num">55</text>
    <line x1="40" y1="385" x2="760" y2="385" stroke="#f1f5f9" stroke-width="1.5"/>

    <!-- Row 4: OPM -->
    <text x="70" y="425" class="td-metric">OPM</text>
    <text x="240" y="425" class="td-green">+1125 bps</text>
    <text x="360" y="425" class="td-green">+1443 bps</text>
    <text x="480" y="425" class="td-num">${opm}%</text>
    <text x="600" y="425" class="td-num">11.1%</text>
    <text x="710" y="425" class="td-num">7.9%</text>
    <line x1="40" y1="445" x2="760" y2="445" stroke="#f1f5f9" stroke-width="1.5"/>

    <!-- Row 5: PAT -->
    <text x="70" y="485" class="td-metric">PAT</text>
    <text x="240" y="485" class="td-green">+${patQoQ}%</text>
    <text x="360" y="485" class="td-green">+${patYoY}%</text>
    <text x="480" y="485" class="td-num">309</text>
    <text x="600" y="485" class="td-num">71</text>
    <text x="710" y="485" class="td-num">43</text>
    <line x1="40" y1="505" x2="760" y2="505" stroke="#f1f5f9" stroke-width="1.5"/>

    <!-- Row 6: EPS -->
    <text x="70" y="545" class="td-metric">EPS</text>
    <text x="240" y="545" class="td-green">+333%</text>
    <text x="360" y="545" class="td-green">+630%</text>
    <text x="480" y="545" class="td-num">51.1</text>
    <text x="600" y="545" class="td-num">11.8</text>
    <text x="710" y="545" class="td-num">7.0</text>
    <line x1="40" y1="565" x2="760" y2="565" stroke="#f1f5f9" stroke-width="1.5"/>

    <!-- Bar Charts Section -->
    <rect x="40" y="585" width="220" height="160" rx="12" fill="#f8fafc" stroke="#f1f5f9"/>
    <text x="55" y="610" font-family="sans-serif" font-size="12" font-weight="bold" fill="#6366f1">REVENUE 0-1,735.2 Cr</text>
    <rect x="60" y="690" width="25" height="35" fill="#cbd5e1" rx="3"/>
    <rect x="95" y="675" width="25" height="50" fill="#cbd5e1" rx="3"/>
    <rect x="130" y="675" width="25" height="50" fill="#cbd5e1" rx="3"/>
    <rect x="165" y="665" width="25" height="60" fill="#cbd5e1" rx="3"/>
    <rect x="200" y="635" width="25" height="90" fill="#6366f1" rx="3"/>

    <rect x="290" y="585" width="220" height="160" rx="12" fill="#f8fafc" stroke="#f1f5f9"/>
    <text x="305" y="610" font-family="sans-serif" font-size="12" font-weight="bold" fill="#6366f1">PAT 0-308.9 Cr</text>
    <rect x="310" y="700" width="25" height="25" fill="#cbd5e1" rx="3"/>
    <rect x="345" y="688" width="25" height="37" fill="#cbd5e1" rx="3"/>
    <rect x="380" y="695" width="25" height="30" fill="#cbd5e1" rx="3"/>
    <rect x="415" y="675" width="25" height="50" fill="#cbd5e1" rx="3"/>
    <rect x="450" y="635" width="25" height="90" fill="#6366f1" rx="3"/>

    <rect x="540" y="585" width="220" height="160" rx="12" fill="#f8fafc" stroke="#f1f5f9"/>
    <text x="555" y="610" font-family="sans-serif" font-size="12" font-weight="bold" fill="#6366f1">EPS 0-51.1</text>
    <rect x="560" y="695" width="25" height="30" fill="#cbd5e1" rx="3"/>
    <rect x="595" y="685" width="25" height="40" fill="#cbd5e1" rx="3"/>
    <rect x="630" y="692" width="25" height="33" fill="#cbd5e1" rx="3"/>
    <rect x="665" y="670" width="25" height="55" fill="#cbd5e1" rx="3"/>
    <rect x="700" y="635" width="25" height="90" fill="#6366f1" rx="3"/>

    <!-- Footer Bar -->
    <text x="400" y="785" text-anchor="middle" class="footer">CMP : <tspan font-weight="bold">${cmp}</tspan>  |  <tspan font-weight="bold">${category} (${mcap})</tspan>  |  P/E : <tspan font-weight="bold">${pe}</tspan></text>
    <text x="400" y="820" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#9ca3af">AI-generated report card summary. Verify with official exchange filings.</text>
  </svg>`;

    return Buffer.from(svg);
  }
}

module.exports = new CardGenerator();
