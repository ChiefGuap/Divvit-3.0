/* Market tier drives the neighborhood part of a café's price (see
   mp_market_factor in the schema): 1 = priciest metros, 3 = everywhere else. */

const TIER_1 = ["new york", "brooklyn", "manhattan", "san francisco"];
const TIER_2 = ["los angeles", "boston", "cambridge", "seattle", "chicago", "washington", "oakland", "san jose", "san diego", "denver", "somerville"];

export function marketTier(city: string | null | undefined): 1 | 2 | 3 {
  const c = (city || "").toLowerCase();
  if (TIER_1.some((x) => c.includes(x))) return 1;
  if (TIER_2.some((x) => c.includes(x))) return 2;
  return 3;
}
