-- Marketplace autofill: keep what we learn about a business when it picks
-- itself from the "Is this you?" list.
--
-- Startups: LinkedIn page, other public profiles, team size, founding year
--   (from the YC directory, the startup's own website, and People Data Labs
--   when a key is configured — never by scraping LinkedIn).
-- Cafés: website, Instagram and opening hours from OpenStreetMap and the
--   café's own site, plus the OSM object it was matched to.

alter table public.mp_startups
  add column if not exists linkedin_url text,
  add column if not exists links        jsonb not null default '{}',  -- {x, instagram, github, crunchbase, yc}
  add column if not exists team_size    integer,
  add column if not exists founded_year smallint;

alter table public.mp_cafes
  add column if not exists website       text,
  add column if not exists instagram     text,
  add column if not exists opening_hours text,
  add column if not exists osm_ref       text;   -- e.g. node/123456, where the listing was autofilled from

-- Café listings are public (minus owner_id); the new fields are too.
grant select (website, instagram, opening_hours, osm_ref) on public.mp_cafes to anon, authenticated;

-- Shared validators, so the sign-up trigger and the app agree on what's allowed.
create or replace function public.mp_clean_links(j jsonb)
returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_object_agg(k, left(v, 300)), '{}'::jsonb)
    from jsonb_each_text(case when jsonb_typeof(j) = 'object' then j else '{}'::jsonb end) as e(k, v)
   where k in ('x', 'instagram', 'github', 'crunchbase', 'yc', 'facebook')
     and v ~ '^https://'
$$;

create or replace function public.mp_clean_linkedin(u text)
returns text
language sql immutable set search_path = '' as $$
  select case when u ~* '^https://([a-z]{2,3}\.)?linkedin\.com/(company|school|showcase)/[A-Za-z0-9_%.\-]+/?$'
              then left(u, 300) end
$$;

-- Same trigger as before, with the new fields.
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
      insert into public.mp_startups (owner_id, name, website, hq, funding_stage, funding_total, description, category, logo_url,
                                      areas, autofill_source, linkedin_url, links, team_size, founded_year)
      values (
        new.id,
        left(coalesce(nullif(trim(s ->> 'name'), ''), 'My startup'), 120),
        left(nullif(trim(s ->> 'website'), ''), 300),
        left(nullif(trim(s ->> 'hq'), ''), 160),
        left(nullif(trim(s ->> 'funding_stage'), ''), 60),
        left(nullif(trim(s ->> 'funding_total'), ''), 40),
        left(nullif(trim(s ->> 'description'), ''), 1200),
        case when s ->> 'category' = any (cats) then s ->> 'category' else 'tech' end,
        case when (s ->> 'logo_url') ~ '^https://' then left(s ->> 'logo_url', 500) end,
        case when jsonb_typeof(s -> 'areas') = 'array'
             then (select coalesce(jsonb_agg(a), '[]'::jsonb) from (select a from jsonb_array_elements(s -> 'areas') a limit 12) x)
             else '[]'::jsonb end,
        case when jsonb_typeof(s -> 'source') = 'array' then jsonb_build_object('sources', s -> 'source') end,
        public.mp_clean_linkedin(s ->> 'linkedin_url'),
        public.mp_clean_links(s -> 'links'),
        case when (s ->> 'team_size') ~ '^\d{1,7}$' then (s ->> 'team_size')::integer end,
        case when (s ->> 'founded_year') ~ '^(18|19|20)\d\d$' then (s ->> 'founded_year')::smallint end
      );
    elsif m ->> 'mp_role' = 'cafe' and jsonb_typeof(m -> 'mp_cafe') = 'object' then
      c := m -> 'mp_cafe';
      insert into public.mp_cafes (owner_id, name, address, neighborhood, city, region, lat, lng, market_tier,
                                   weekly_cups, sleeves_per_month, accepted_categories, blocked_categories, branded_drinks,
                                   website, instagram, opening_hours, osm_ref)
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
        coalesce((c ->> 'branded_drinks')::boolean, true),
        case when (c ->> 'website') ~ '^https?://' then left(c ->> 'website', 300) end,
        case when (c ->> 'instagram') ~ '^https://(www\.)?instagram\.com/' then left(c ->> 'instagram', 200) end,
        left(nullif(trim(c ->> 'opening_hours'), ''), 300),
        case when (c ->> 'osm_ref') ~ '^(node|way|relation)/\d{1,15}$' then c ->> 'osm_ref' end
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

-- Direct edits by signed-in owners go through the same rules.
alter table public.mp_startups
  drop constraint if exists mp_startups_linkedin_ok,
  add constraint mp_startups_linkedin_ok check (linkedin_url is null or public.mp_clean_linkedin(linkedin_url) is not null),  -- (not `=`: a NULL comparison would pass)
  drop constraint if exists mp_startups_links_ok,
  add constraint mp_startups_links_ok check (links = public.mp_clean_links(links)),
  drop constraint if exists mp_startups_team_ok,
  add constraint mp_startups_team_ok check (team_size is null or team_size between 1 and 9999999),
  drop constraint if exists mp_startups_founded_ok,
  add constraint mp_startups_founded_ok check (founded_year is null or founded_year between 1800 and 2100);

alter table public.mp_cafes
  drop constraint if exists mp_cafes_website_ok,
  add constraint mp_cafes_website_ok check (website is null or (website ~ '^https?://' and length(website) <= 300)),
  drop constraint if exists mp_cafes_instagram_ok,
  add constraint mp_cafes_instagram_ok check (instagram is null or (instagram ~ '^https://(www\.)?instagram\.com/' and length(instagram) <= 200)),
  drop constraint if exists mp_cafes_hours_ok,
  add constraint mp_cafes_hours_ok check (opening_hours is null or length(opening_hours) <= 300),
  drop constraint if exists mp_cafes_osm_ok,
  add constraint mp_cafes_osm_ok check (osm_ref is null or osm_ref ~ '^(node|way|relation)/\d{1,15}$');

-- Cafés see who's behind an offer: now with LinkedIn, team size and founding year.
create or replace function public.mp_cafe_inbox()
returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
  from (
    select o.id, o.status, o.sleeves, o.branded_drink, o.payout_cents, o.created_at, o.responded_at,
           c.id as cafe_id, c.name as cafe_name,
           k.name as campaign_name, k.start_date, k.weeks, k.design, k.design_url,
           s.name as startup_name, s.website, s.hq, s.category, s.description, s.logo_url, s.funding_stage,
           s.linkedin_url, s.team_size, s.founded_year
      from public.mp_campaign_cafes o
      join public.mp_cafes c     on c.id = o.cafe_id
      join public.mp_campaigns k on k.id = o.campaign_id
      join public.mp_startups s  on s.id = k.startup_id
     where c.owner_id = auth.uid()
  ) x
$$;
