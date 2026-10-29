/* Campaign estimates shown next to the checkout. These are estimates, and the
   UI says so and shows every assumption; the startup can change the last two. */

export const ROI_ASSUMPTIONS = {
  impressionsPerSleeve: 4,    // the person holding the cup + people who see it on the walk, the desk, the table
  scanRateLow: 0.008,         // QR scans / promo-code uses per sleeve
  scanRateMid: 0.015,
  scanRateHigh: 0.025,
};

export type RoiInputs = { totalSleeves: number; totalCents: number; signupRate: number; customerValue: number };

export function estimateRoi({ totalSleeves, totalCents, signupRate, customerValue }: RoiInputs) {
  const a = ROI_ASSUMPTIONS;
  const impressions = totalSleeves * a.impressionsPerSleeve;
  const engagements = { low: totalSleeves * a.scanRateLow, mid: totalSleeves * a.scanRateMid, high: totalSleeves * a.scanRateHigh };
  const spend = totalCents / 100;
  const customers = engagements.mid * signupRate;
  const revenue = customers * customerValue;
  return {
    impressions,
    engagements,
    cpm: impressions > 0 ? spend / (impressions / 1000) : 0,
    costPerEngagement: engagements.mid > 0 ? spend / engagements.mid : 0,
    customers,
    revenue,
    roiMultiple: spend > 0 ? revenue / spend : 0,
  };
}
