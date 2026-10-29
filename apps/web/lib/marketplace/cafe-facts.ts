/* What a café card tells a startup: how many customers a day, how many sleeves
   the café can take for one campaign, and what's around it. */

import type { Cafe, NearbyKind } from "./types";

/** the campaign length the card's sleeve number assumes */
export const CARD_WEEKS = 4;

export const dailyCustomers = (c: Pick<Cafe, "weekly_cups">) => Math.round(c.weekly_cups / 7);

/** the same cap the quote applies (mp_line_quote: sleeves a month × weeks ÷ 4.33) */
export const sleevesPerCampaign = (c: Pick<Cafe, "sleeves_per_month">, weeks = CARD_WEEKS) =>
  Math.max(50, Math.floor((c.sleeves_per_month * weeks) / 4.33));

export const NEARBY_LABEL: Record<NearbyKind, string> = {
  office: "Offices & HQs", school: "Colleges & schools", startup: "Startups & coworking", landmark: "Landmarks",
};
