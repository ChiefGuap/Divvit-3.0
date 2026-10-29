-- Divvit Marketplace (marketplace.divvit.app)
--
-- Startups book coffee-sleeve campaigns across cafés in the Divvit network;
-- cafés set what they'll carry and accept or decline the offers that arrive.
--
-- Everything here is prefixed mp_ so it can't collide with the dashboard
-- schema living in the same project (which already has `campaigns`,
-- `profiles`, ...).
--
-- Pricing lives in Postgres, not the browser: the checkout reads its numbers
-- from mp_quote(), and mp_submit_campaign() recomputes them server-side, so a
-- tampered client can't change what a campaign costs or what a café is paid.

-- ---------------------------------------------------------------- tables

create table public.mp_profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  role        text not null check (role in ('startup', 'cafe')),
  full_name   text,
  created_at  timestamptz not null default now()
);

create table public.mp_startups (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name             text not null check (char_length(name) between 1 and 120),
  website          text check (website is null or char_length(website) <= 300),
  hq               text check (hq is null or char_length(hq) <= 160),
  funding_stage    text check (funding_stage is null or char_length(funding_stage) <= 60),
  funding_total    text check (funding_total is null or char_length(funding_total) <= 60),
  description      text check (description is null or char_length(description) <= 1200),
  category         text not null default 'tech',
  logo_url         text,
  autofill_source  jsonb,             -- where the autofilled fields came from (yc, website, pdl)
  created_at       timestamptz not null default now()
);
create index mp_startups_owner_idx on public.mp_startups (owner_id);

create table public.mp_cafes (
  id                   uuid primary key default gen_random_uuid(),
  owner_id             uuid references auth.users (id) on delete set null,   -- null for sample cafés
  name                 text not null check (char_length(name) between 1 and 120),
  address              text,
  neighborhood         text,
  city                 text not null,
  region               text,
  lat                  double precision not null check (lat between -90 and 90),
  lng                  double precision not null check (lng between -180 and 180),
  market_tier          smallint not null default 3 check (market_tier between 1 and 3),  -- 1 = priciest metros
  weekly_cups          integer not null default 1200 check (weekly_cups between 50 and 50000),
  sleeves_per_month    integer not null default 1500 check (sleeves_per_month between 0 and 100000),
  accepted_categories  text[] not null default '{}',   -- empty = open to every category
  blocked_categories   text[] not null default '{}',
  branded_drinks       boolean not null default true,
  is_demo              boolean not null default false, -- seeded sample network, shown as such in the UI
  created_at           timestamptz not null default now()
);
create index mp_cafes_owner_idx on public.mp_cafes (owner_id);
create index mp_cafes_city_idx on public.mp_cafes (city);

create table public.mp_campaigns (
  id                uuid primary key default gen_random_uuid(),
  startup_id        uuid not null references public.mp_startups (id) on delete cascade,
  owner_id          uuid not null references auth.users (id) on delete cascade,
  name              text not null,
  status            text not null default 'submitted'
                      check (status in ('submitted', 'active', 'completed', 'cancelled')),
  start_date        date,
  weeks             integer not null check (weeks between 1 and 52),
  sleeves_per_cafe  integer not null check (sleeves_per_cafe between 50 and 20000),
  branded_drink     boolean not null default false,
  design            jsonb not null default '{}',
  design_url        text,
  locations         jsonb not null default '[]',
  roi               jsonb not null default '{}',
  subtotal_cents    integer not null,
  discount_cents    integer not null,
  fee_cents         integer not null,
  total_cents       integer not null,
  created_at        timestamptz not null default now()
);
create index mp_campaigns_owner_idx on public.mp_campaigns (owner_id);
create index mp_campaigns_startup_idx on public.mp_campaigns (startup_id);

-- one row per café a campaign was offered to — the café's inbox
create table public.mp_campaign_cafes (
  id             uuid primary key default gen_random_uuid(),
  campaign_id    uuid not null references public.mp_campaigns (id) on delete cascade,
  cafe_id        uuid not null references public.mp_cafes (id) on delete cascade,
  sleeves        integer not null,
  branded_drink  boolean not null default false,
  price_cents    integer not null,
  payout_cents   integer not null,
  status         text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  responded_at   timestamptz,
  created_at     timestamptz not null default now(),
  unique (campaign_id, cafe_id)
);
create index mp_campaign_cafes_cafe_idx on public.mp_campaign_cafes (cafe_id);

-- ---------------------------------------------------------------- row level security

alter table public.mp_profiles       enable row level security;
alter table public.mp_startups       enable row level security;
alter table public.mp_cafes          enable row level security;
alter table public.mp_campaigns      enable row level security;
alter table public.mp_campaign_cafes enable row level security;

create policy "mp_profiles: read own"   on public.mp_profiles for select to authenticated using (id = (select auth.uid()));
create policy "mp_profiles: insert own" on public.mp_profiles for insert to authenticated with check (id = (select auth.uid()));
create policy "mp_profiles: update own" on public.mp_profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "mp_startups: read own"   on public.mp_startups for select to authenticated using (owner_id = (select auth.uid()));
create policy "mp_startups: insert own" on public.mp_startups for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "mp_startups: update own" on public.mp_startups for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "mp_startups: delete own" on public.mp_startups for delete to authenticated using (owner_id = (select auth.uid()));

-- The network map is public. Owners manage their own listing; nobody can
-- create or claim a sample café.
create policy "mp_cafes: public read"  on public.mp_cafes for select to anon, authenticated using (true);
create policy "mp_cafes: insert own"   on public.mp_cafes for insert to authenticated
  with check (owner_id = (select auth.uid()) and not is_demo);
create policy "mp_cafes: update own"   on public.mp_cafes for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()) and not is_demo);

-- Who owns a café isn't public: expose every column except owner_id.
revoke select on public.mp_cafes from anon, authenticated;
grant select (id, name, address, neighborhood, city, region, lat, lng, market_tier, weekly_cups,
              sleeves_per_month, accepted_categories, blocked_categories, branded_drinks, is_demo, created_at)
  on public.mp_cafes to anon, authenticated;

-- Campaigns and offers are written only through the functions below.
create policy "mp_campaigns: read own" on public.mp_campaigns for select to authenticated using (owner_id = (select auth.uid()));
create policy "mp_campaign_cafes: read as startup or cafe" on public.mp_campaign_cafes for select to authenticated using (
  exists (select 1 from public.mp_campaigns k where k.id = campaign_id and k.owner_id = (select auth.uid()))
  or exists (select 1 from public.mp_cafes c where c.id = cafe_id and c.owner_id = (select auth.uid()))
);

-- ---------------------------------------------------------------- profiles on sign-up

-- The sign-up form passes {mp_role, full_name} as user metadata; this makes
-- the profile even when email confirmation means there's no session yet.
create or replace function public.mp_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.raw_user_meta_data ->> 'mp_role' in ('startup', 'cafe') then
    insert into public.mp_profiles (id, role, full_name)
    values (new.id, new.raw_user_meta_data ->> 'mp_role', left(new.raw_user_meta_data ->> 'full_name', 120))
    on conflict (id) do nothing;
  end if;
  return new;
end;
$$;

create trigger mp_on_auth_user_created
  after insert on auth.users
  for each row execute function public.mp_handle_new_user();

-- ---------------------------------------------------------------- pricing engine
--
-- Per café line, in cents:
--   media    = sleeves × 30¢ × market factor × foot-traffic factor × demand factor
--   printing = sleeves × 9¢
--   drink    = $45 per week, when the startup adds a branded drink and the café offers them
--   price    = media + printing + drink
--   café payout = 60% of media + 80% of drink
-- Sleeves are capped by what the café allocates per month over the campaign.
-- Checkout: 5% off at 10+ cafés, 10% off at 25+, then a 5% service fee.

create or replace function public.mp_market_factor(p_tier smallint)
returns numeric language sql immutable set search_path = '' as $$
  select case p_tier when 1 then 1.35 when 2 then 1.15 else 1.0 end
$$;

create or replace function public.mp_traffic_factor(p_weekly_cups integer)
returns numeric language sql immutable set search_path = '' as $$
  select case when p_weekly_cups >= 2500 then 1.2 when p_weekly_cups >= 1200 then 1.0 else 0.85 end
$$;

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
  media    numeric := s * 30 * public.mp_market_factor(p_cafe.market_tier)
                         * public.mp_traffic_factor(p_cafe.weekly_cups) * demand;
  printing numeric := s * 9;
  drink    numeric := case when b then 4500 * p_weeks else 0 end;
begin
  sleeves      := s;
  branded      := b;
  price_cents  := round(media + printing + drink);
  payout_cents := round(media * 0.6 + drink * 0.8);
  return next;
end;
$$;

-- What the checkout shows: one line per café plus the totals.
create or replace function public.mp_quote(
  p_cafe_ids uuid[], p_sleeves integer, p_weeks integer, p_branded boolean
)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  c         public.mp_cafes;
  q         record;
  opn       integer;
  lines     jsonb := '[]'::jsonb;
  subtotal  bigint := 0;
  n         integer := 0;
  rate      numeric;
  discount  bigint;
  fee       bigint;
begin
  if p_sleeves is null or p_sleeves < 50 or p_sleeves > 20000 then raise exception 'sleeves per café must be 50–20,000'; end if;
  if p_weeks is null or p_weeks < 1 or p_weeks > 52 then raise exception 'campaigns run 1–52 weeks'; end if;
  if coalesce(array_length(p_cafe_ids, 1), 0) > 250 then raise exception 'at most 250 cafés per campaign'; end if;

  for c in
    select * from public.mp_cafes where id = any (p_cafe_ids) and sleeves_per_month > 0 order by city, name
  loop
    select count(*) into opn from public.mp_campaign_cafes o
      where o.cafe_id = c.id and o.status in ('pending', 'accepted');
    select * into q from public.mp_line_quote(c, p_sleeves, p_weeks, coalesce(p_branded, false), opn);
    n := n + 1;
    subtotal := subtotal + q.price_cents;
    lines := lines || jsonb_build_object(
      'cafe_id', c.id, 'name', c.name, 'neighborhood', c.neighborhood, 'city', c.city,
      'sleeves', q.sleeves, 'branded_drink', q.branded, 'price_cents', q.price_cents, 'is_demo', c.is_demo);
  end loop;

  rate     := case when n >= 25 then 0.10 when n >= 10 then 0.05 else 0 end;
  discount := round(subtotal * rate);
  fee      := round((subtotal - discount) * 0.05);
  return jsonb_build_object(
    'lines', lines, 'cafe_count', n, 'subtotal_cents', subtotal, 'discount_rate', rate,
    'discount_cents', discount, 'fee_cents', fee, 'total_cents', subtotal - discount + fee);
end;
$$;

-- "Start a campaign": recomputes the quote and writes the campaign plus one
-- pending offer per café. The only way campaigns and offers get created.
create or replace function public.mp_submit_campaign(
  p_startup_id uuid, p_name text, p_cafe_ids uuid[], p_sleeves integer, p_weeks integer,
  p_branded boolean, p_start_date date, p_design jsonb, p_design_url text, p_locations jsonb, p_roi jsonb
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid    uuid := auth.uid();
  quote  jsonb;
  cid    uuid;
  c      public.mp_cafes;
  q      record;
  opn    integer;
begin
  if uid is null then raise exception 'sign in to start a campaign' using errcode = '28000'; end if;
  if not exists (select 1 from public.mp_startups where id = p_startup_id and owner_id = uid) then
    raise exception 'that startup isn''t yours';
  end if;

  quote := public.mp_quote(p_cafe_ids, p_sleeves, p_weeks, p_branded);
  if (quote ->> 'cafe_count')::integer = 0 then raise exception 'pick at least one café'; end if;

  insert into public.mp_campaigns (
    startup_id, owner_id, name, start_date, weeks, sleeves_per_cafe, branded_drink, design, design_url,
    locations, roi, subtotal_cents, discount_cents, fee_cents, total_cents)
  values (
    p_startup_id, uid, left(coalesce(nullif(trim(p_name), ''), 'Sleeve campaign'), 120), p_start_date, p_weeks,
    p_sleeves, coalesce(p_branded, false), coalesce(p_design, '{}'::jsonb), p_design_url,
    coalesce(p_locations, '[]'::jsonb), coalesce(p_roi, '{}'::jsonb),
    (quote ->> 'subtotal_cents')::integer, (quote ->> 'discount_cents')::integer,
    (quote ->> 'fee_cents')::integer, (quote ->> 'total_cents')::integer)
  returning id into cid;

  for c in select * from public.mp_cafes where id = any (p_cafe_ids) and sleeves_per_month > 0 loop
    select count(*) into opn from public.mp_campaign_cafes o
      where o.cafe_id = c.id and o.status in ('pending', 'accepted') and o.campaign_id <> cid;
    select * into q from public.mp_line_quote(c, p_sleeves, p_weeks, coalesce(p_branded, false), opn);
    insert into public.mp_campaign_cafes (campaign_id, cafe_id, sleeves, branded_drink, price_cents, payout_cents)
    values (cid, c.id, q.sleeves, q.branded, q.price_cents, q.payout_cents);
  end loop;

  return cid;
end;
$$;

-- A café accepts or declines an offer in its inbox.
create or replace function public.mp_respond_offer(p_offer_id uuid, p_accept boolean)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  uid  uuid := auth.uid();
  st   text;
  cid  uuid;
begin
  if uid is null then raise exception 'sign in required' using errcode = '28000'; end if;

  update public.mp_campaign_cafes o
     set status = case when p_accept then 'accepted' else 'declined' end, responded_at = now()
    from public.mp_cafes c
   where o.id = p_offer_id and c.id = o.cafe_id and c.owner_id = uid and o.status = 'pending'
  returning o.status, o.campaign_id into st, cid;

  if st is null then raise exception 'offer not found or already answered'; end if;
  if p_accept then
    update public.mp_campaigns set status = 'active' where id = cid and status = 'submitted';
  end if;
  return st;
end;
$$;

-- The café inbox: offers to cafés this user owns, with the startup behind each.
create or replace function public.mp_cafe_inbox()
returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
  from (
    select o.id, o.status, o.sleeves, o.branded_drink, o.payout_cents, o.created_at, o.responded_at,
           c.id as cafe_id, c.name as cafe_name,
           k.name as campaign_name, k.start_date, k.weeks, k.design, k.design_url,
           s.name as startup_name, s.website, s.hq, s.category, s.description, s.logo_url, s.funding_stage
      from public.mp_campaign_cafes o
      join public.mp_cafes c     on c.id = o.cafe_id
      join public.mp_campaigns k on k.id = o.campaign_id
      join public.mp_startups s  on s.id = k.startup_id
     where c.owner_id = auth.uid()
  ) x
$$;

-- A startup's campaigns, with where each café stands.
create or replace function public.mp_my_campaigns()
returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
  from (
    select k.id, k.name, k.status, k.start_date, k.weeks, k.sleeves_per_cafe, k.branded_drink,
           k.total_cents, k.design, k.design_url, k.created_at, s.name as startup_name,
           (select coalesce(jsonb_agg(jsonb_build_object(
                     'cafe_name', c.name, 'neighborhood', c.neighborhood, 'city', c.city, 'is_demo', c.is_demo,
                     'status', o.status, 'sleeves', o.sleeves, 'price_cents', o.price_cents) order by c.city, c.name), '[]'::jsonb)
              from public.mp_campaign_cafes o join public.mp_cafes c on c.id = o.cafe_id
             where o.campaign_id = k.id) as cafes
      from public.mp_campaigns k
      join public.mp_startups s on s.id = k.startup_id
     where k.owner_id = auth.uid()
  ) x
$$;

-- The signed-in café's own listing (owner_id isn't selectable directly).
create or replace function public.mp_my_cafe()
returns jsonb
language sql stable security definer set search_path = '' as $$
  select to_jsonb(c) - 'owner_id' from public.mp_cafes c where c.owner_id = auth.uid() order by c.created_at limit 1
$$;

-- Café-side estimator: monthly payout if `fill` of the allocated sleeves get booked.
create or replace function public.mp_estimate_payout(
  p_sleeves_month integer, p_weekly_cups integer, p_market_tier integer, p_branded boolean
)
returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  per_sleeve numeric := 30 * public.mp_market_factor(least(greatest(coalesce(p_market_tier, 3), 1), 3)::smallint)
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

-- ---------------------------------------------------------------- function grants

revoke all on function public.mp_handle_new_user() from public, anon, authenticated;
revoke all on function public.mp_line_quote(public.mp_cafes, integer, integer, boolean, integer) from public, anon, authenticated;
revoke all on function public.mp_submit_campaign(uuid, text, uuid[], integer, integer, boolean, date, jsonb, text, jsonb, jsonb) from public, anon;
revoke all on function public.mp_respond_offer(uuid, boolean) from public, anon;
revoke all on function public.mp_cafe_inbox() from public, anon;
revoke all on function public.mp_my_campaigns() from public, anon;
revoke all on function public.mp_my_cafe() from public, anon;

grant execute on function public.mp_quote(uuid[], integer, integer, boolean) to anon, authenticated;
grant execute on function public.mp_estimate_payout(integer, integer, integer, boolean) to anon, authenticated;
grant execute on function public.mp_submit_campaign(uuid, text, uuid[], integer, integer, boolean, date, jsonb, text, jsonb, jsonb) to authenticated;
grant execute on function public.mp_respond_offer(uuid, boolean) to authenticated;
grant execute on function public.mp_cafe_inbox() to authenticated;
grant execute on function public.mp_my_campaigns() to authenticated;
grant execute on function public.mp_my_cafe() to authenticated;

-- ---------------------------------------------------------------- storage: sleeve designs + logos

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mp-sleeve-designs', 'mp-sleeve-designs', true, 10485760, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy "mp designs: upload to own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'mp-sleeve-designs' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "mp designs: update own" on storage.objects for update to authenticated
  using (bucket_id = 'mp-sleeve-designs' and owner_id = (select auth.uid())::text);
create policy "mp designs: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'mp-sleeve-designs' and owner_id = (select auth.uid())::text);
