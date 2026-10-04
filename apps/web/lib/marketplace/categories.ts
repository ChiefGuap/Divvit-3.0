/* What a startup does, and what a café is willing to carry. Cafés list the
   categories they welcome (empty = all) and the ones they block. */

export const CATEGORIES = [
  { id: "tech", label: "Tech & software" },
  { id: "fintech", label: "Fintech" },
  { id: "health", label: "Health & wellness" },
  { id: "consumer", label: "Consumer products" },
  { id: "food_bev", label: "Food & beverage" },
  { id: "climate", label: "Climate & sustainability" },
  { id: "education", label: "Education" },
  { id: "nonprofit", label: "Nonprofit & community" },
  { id: "local", label: "Local business" },
  { id: "crypto", label: "Crypto & web3" },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]["id"];
export const categoryLabel = (id: string) => CATEGORIES.find((c) => c.id === id)?.label ?? id;

export function cafeAccepts(cafe: { accepted_categories: string[]; blocked_categories: string[] }, category: string) {
  if (cafe.blocked_categories.includes(category)) return false;
  return cafe.accepted_categories.length === 0 || cafe.accepted_categories.includes(category);
}

/** Best guess from free text (YC industry, tags, a site description). */
export function guessCategory(...texts: (string | undefined | null)[]): CategoryId {
  const t = texts.filter(Boolean).join(" ").toLowerCase();
  const has = (...w: string[]) => w.some((x) => t.includes(x));
  if (has("crypto", "web3", "blockchain", "defi", "nft")) return "crypto";
  if (has("fintech", "payment", "banking", "lending", "insurance", "finance", "payroll")) return "fintech";
  if (has("health", "medical", "clinic", "wellness", "fitness", "therapy", "biotech", "sleep")) return "health";
  if (has("climate", "energy", "solar", "carbon", "sustainab", "recycl")) return "climate";
  if (has("education", "edtech", "learning", "tutor", "school", "course")) return "education";
  if (has("food", "beverage", "restaurant", "grocery", "coffee", "drink", "snack")) return "food_bev";
  if (has("nonprofit", "non-profit", "charity", "community")) return "nonprofit";
  if (has("consumer", "apparel", "fashion", "beauty", "home goods", "e-commerce", "ecommerce", "retail", "marketplace")) return "consumer";
  return "tech";
}
