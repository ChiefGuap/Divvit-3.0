-- Marketplace pricing, first tune: a sleeve was landing near $0.58 in the
-- priciest metros (≈ $230 per thousand impressions), which no startup would
-- buy. Media drops from 30¢ to 15¢ per sleeve and printing from 9¢ to 6¢.
-- Café payout shares are unchanged (60% of media, 80% of branded drink).
-- These are placeholders until real rates are set.

create or replace function public.mp_line_quote(
  p_cafe public.mp_cafes, p_sleeves integer, p_weeks integer, p_branded boolean, p_open_offers integer
)
returns table (sleeves integer, branded boolean, price_cents integer, payout_cents integer)
language plpgsql stable set search_path = '' as $$
declare
  cap      integer := greatest(50, floor(p_cafe.sleeves_per_month * p_weeks / 4.33)::integer);
  s        integer := least(p_sleeves, cap);
  b        boolean := p_branded and p_cafe.branded_drinks;
  demand   numeric := 1 + 0.04 * least(greatest(p_open_offers, 0), 4);
  media    numeric := s * 15 * public.mp_market_factor(p_cafe.market_tier)
                         * public.mp_traffic_factor(p_cafe.weekly_cups) * demand;
  printing numeric := s * 6;
  drink    numeric := case when b then 4500 * p_weeks else 0 end;
begin
  sleeves      := s;
  branded      := b;
  price_cents  := round(media + printing + drink);
  payout_cents := round(media * 0.6 + drink * 0.8);
  return next;
end;
$$;

create or replace function public.mp_estimate_payout(
  p_sleeves_month integer, p_weekly_cups integer, p_market_tier integer, p_branded boolean
)
returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  per_sleeve numeric := 15 * public.mp_market_factor(least(greatest(coalesce(p_market_tier, 3), 1), 3)::smallint)
                            * public.mp_traffic_factor(greatest(coalesce(p_weekly_cups, 0), 0)) * 0.6;
  sleeves    integer := least(greatest(coalesce(p_sleeves_month, 0), 0), 100000);
  out        jsonb := '{}'::jsonb;
  f          numeric;
  label      text;
begin
  foreach label in array array['low', 'typical', 'high'] loop
    f := case label when 'low' then 0.4 when 'typical' then 0.7 else 0.95 end;
    out := out || jsonb_build_object(label, jsonb_build_object(
      'fill', f,
      'sleeves_booked', round(sleeves * f),
      'sleeve_payout_cents', round(sleeves * f * per_sleeve),
      'drink_payout_cents', case when p_branded then round(4500 * 4.33 * 0.8 * f) else 0 end));
  end loop;
  return out;
end;
$$;

revoke all on function public.mp_line_quote(public.mp_cafes, integer, integer, boolean, integer) from public, anon, authenticated;
grant execute on function public.mp_estimate_payout(integer, integer, integer, boolean) to anon, authenticated;
