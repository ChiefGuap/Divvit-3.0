-- What a café earns for each cup it places, by market. One definition, used by
-- the café payout estimate and by the homepage earnings calculator (which reads
-- it instead of repeating the formula). Still 60% of the 15¢ media rate, scaled
-- by market and traffic — the same share mp_line_quote pays out.

create or replace function public.mp_cafe_rate(p_market_tier integer, p_weekly_cups integer default 2450)
returns numeric
language sql immutable set search_path = '' as $$
  select 15 * public.mp_market_factor(least(greatest(coalesce(p_market_tier, 3), 1), 3)::smallint)
            * public.mp_traffic_factor(greatest(coalesce(p_weekly_cups, 0), 0)) * 0.6
$$;

create or replace function public.mp_estimate_payout(
  p_sleeves_month integer, p_weekly_cups integer, p_market_tier integer, p_branded boolean
)
returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  per_sleeve numeric := public.mp_cafe_rate(p_market_tier, p_weekly_cups);
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

grant execute on function public.mp_cafe_rate(integer, integer) to anon, authenticated;
grant execute on function public.mp_estimate_payout(integer, integer, integer, boolean) to anon, authenticated;
