-- Marketplace onboarding: one question per screen, saved as a profile.
--
-- Sign-up requires email confirmation on this project, so there's no session
-- when the last onboarding screen submits. The answers ride along as user
-- metadata (mp_startup / mp_cafe) and this trigger turns them into the
-- startup or café row the moment the account exists — on any device, before
-- the email is even confirmed. Everything is validated here because user
-- metadata is client-controlled.

alter table public.mp_startups
  add column if not exists areas jsonb not null default '[]';  -- where they want to be seen, reused by every campaign

create or replace function public.mp_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  m    jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  s    jsonb;
  c    jsonb;
  cats text[] := array['tech','fintech','health','consumer','food_bev','climate','education','nonprofit','local','crypto'];
begin
  if coalesce(m ->> 'mp_role', '') not in ('startup', 'cafe') then
    return new;
  end if;

  insert into public.mp_profiles (id, role, full_name)
  values (new.id, m ->> 'mp_role', left(m ->> 'full_name', 120))
  on conflict (id) do nothing;

  begin
    if m ->> 'mp_role' = 'startup' and jsonb_typeof(m -> 'mp_startup') = 'object' then
      s := m -> 'mp_startup';
      insert into public.mp_startups (owner_id, name, website, hq, funding_stage, description, category, logo_url, areas, autofill_source)
      values (
        new.id,
        left(coalesce(nullif(trim(s ->> 'name'), ''), 'My startup'), 120),
        left(nullif(trim(s ->> 'website'), ''), 300),
        left(nullif(trim(s ->> 'hq'), ''), 160),
        left(nullif(trim(s ->> 'funding_stage'), ''), 60),
        left(nullif(trim(s ->> 'description'), ''), 1200),
        case when s ->> 'category' = any (cats) then s ->> 'category' else 'tech' end,
        case when (s ->> 'logo_url') ~ '^https://' then left(s ->> 'logo_url', 500) end,
        case when jsonb_typeof(s -> 'areas') = 'array'
             then (select coalesce(jsonb_agg(a), '[]'::jsonb) from (select a from jsonb_array_elements(s -> 'areas') a limit 12) x)
             else '[]'::jsonb end,
        case when jsonb_typeof(s -> 'source') = 'array' then jsonb_build_object('sources', s -> 'source') end
      );
    elsif m ->> 'mp_role' = 'cafe' and jsonb_typeof(m -> 'mp_cafe') = 'object' then
      c := m -> 'mp_cafe';
      insert into public.mp_cafes (owner_id, name, address, neighborhood, city, region, lat, lng, market_tier,
                                   weekly_cups, sleeves_per_month, accepted_categories, blocked_categories, branded_drinks)
      values (
        new.id,
        left(trim(c ->> 'name'), 120),
        left(c ->> 'address', 200),
        left(c ->> 'neighborhood', 120),
        left(c ->> 'city', 120),
        left(c ->> 'region', 80),
        (c ->> 'lat')::double precision,
        (c ->> 'lng')::double precision,
        least(greatest(coalesce((c ->> 'market_tier')::integer, 3), 1), 3),
        least(greatest(coalesce((c ->> 'weekly_cups')::integer, 1200), 50), 50000),
        least(greatest(coalesce((c ->> 'sleeves_per_month')::integer, 0), 0), 100000),
        array(select x from jsonb_array_elements_text(coalesce(c -> 'accepted_categories', '[]'::jsonb)) x where x = any (cats)),
        array(select x from jsonb_array_elements_text(coalesce(c -> 'blocked_categories', '[]'::jsonb)) x where x = any (cats)),
        coalesce((c ->> 'branded_drinks')::boolean, true)
      );
    end if;
  exception when others then
    -- never block a sign-up over a malformed onboarding payload; the app asks again
    raise warning 'mp onboarding payload skipped for %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

revoke all on function public.mp_handle_new_user() from public, anon, authenticated;
