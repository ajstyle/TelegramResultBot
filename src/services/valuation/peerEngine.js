/**
 * Peer Engine
 * Computes sector peer group median metrics and relative valuation benchmark ratios.
 */
class PeerEngine {
  getPeerMedians(sectorName) {
    const sector = String(sectorName).toLowerCase();

    // Default institutional benchmarks for Indian market (NSE/BSE)
    if (sector === 'banking') {
      return { medianPE: 14.5, medianPB: 1.8, medianEvEbitda: 10.0, medianRoe: 14.0, medianRoce: 12.0 };
    }
    if (sector === 'it') {
      return { medianPE: 26.0, medianPB: 6.5, medianEvEbitda: 18.0, medianRoe: 24.0, medianRoce: 28.0 };
    }
    if (sector === 'fmcg') {
      return { medianPE: 45.0, medianPB: 10.0, medianEvEbitda: 32.0, medianRoe: 25.0, medianRoce: 30.0 };
    }
    if (sector === 'metals') {
      return { medianPE: 10.0, medianPB: 1.2, medianEvEbitda: 6.5, medianRoe: 12.0, medianRoce: 14.0 };
    }
    if (sector === 'realestate') {
      return { medianPE: 35.0, medianPB: 2.5, medianEvEbitda: 20.0, medianRoe: 10.0, medianRoce: 11.0 };
    }

    return { medianPE: 22.0, medianPB: 3.0, medianEvEbitda: 14.0, medianRoe: 15.0, medianRoce: 16.0 };
  }

  evaluateRelativeValuation(stockRatios, sectorName) {
    const medians = this.getPeerMedians(sectorName);
    const peDiscount = medians.medianPE > 0 && stockRatios.pe > 0 ? ((medians.medianPE - stockRatios.pe) / medians.medianPE) * 100 : 0;
    const pbDiscount = medians.medianPB > 0 && stockRatios.pb > 0 ? ((medians.medianPB - stockRatios.pb) / medians.medianPB) * 100 : 0;
    const evEbitdaDiscount = medians.medianEvEbitda > 0 && stockRatios.evEbitda > 0 ? ((medians.medianEvEbitda - stockRatios.evEbitda) / medians.medianEvEbitda) * 100 : 0;

    return {
      peDiscount: Math.round(peDiscount * 10) / 10,
      pbDiscount: Math.round(pbDiscount * 10) / 10,
      evEbitdaDiscount: Math.round(evEbitdaDiscount * 10) / 10,
      medians
    };
  }
}

module.exports = new PeerEngine();
