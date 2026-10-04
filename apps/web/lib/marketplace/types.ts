export type QuoteLine = {
  cafe_id: string; name: string; neighborhood: string | null; city: string;
  sleeves: number; branded_drink: boolean; price_cents: number; is_demo: boolean;
};
export type Quote = {
  lines: QuoteLine[]; cafe_count: number; subtotal_cents: number; discount_rate: number;
  discount_cents: number; fee_cents: number; total_cents: number;
};
export type Cafe = {
  id: string; name: string; address: string | null; neighborhood: string | null; city: string; region: string | null;
  lat: number; lng: number; market_tier: number; weekly_cups: number; sleeves_per_month: number;
  accepted_categories: string[]; blocked_categories: string[]; branded_drinks: boolean; is_demo: boolean;
};
export const CAFE_COLUMNS =
  "id,name,address,neighborhood,city,region,lat,lng,market_tier,weekly_cups,sleeves_per_month,accepted_categories,blocked_categories,branded_drinks,is_demo";
