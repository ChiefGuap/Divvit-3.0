-- Café verification: nobody can sign up as a coffee shop they don't run.
--
-- A new café listing starts unverified. Until it's verified it is invisible to
-- startups, left out of quotes and campaigns, and can't accept offers (and,
-- once payments exist, can't be paid). A café proves it runs the place through
-- a channel only the real café controls, always taken from its public listing
-- (OpenStreetMap / its own website) — never from details typed at sign-up:
--   website  put a short code on the café's public website; the app server
--            finds it and vouches for it with an HMAC the database checks
--   phone    Divvit calls the café's public number and reads a 6-digit code
--   review   Divvit checks by hand (no public website or phone)
-- Only one listing per real place (OSM object) can ever be verified.
--
-- The HMAC secret lives in mp_private.settings (key 'verify_secret') and in
-- the app's DIVVIT_VERIFY_SECRET. It is set outside migrations so it never
-- lands in git:
--   insert into mp_private.settings (key, value) values ('verify_secret', '<hex>')
--   on conflict (key) do update set value = excluded.value;

-- ---------------------------------------------------------------- state on the listing

alter table public.mp_cafes
  add column if not exists verification_status text not null default 'unverified',
  add column if not exists verified_at timestamptz;

alter table public.mp_cafes drop constraint if exists mp_cafes_verification_ok;
alter table public.mp_cafes add constraint mp_cafes_verification_ok
  check (verification_status in ('unverified', 'pending', 'verified', 'rejected'));

-- sample cafés are Divvit's own placeholders
update public.mp_cafes set verification_status = 'verified', verified_at = coalesce(verified_at, now()) where is_demo;

grant select (verification_status, verified_at) on public.mp_cafes to anon, authenticated;

-- one verified listing per real place
create unique index if not exists mp_cafes_one_verified_per_place
  on public.mp_cafes (osm_ref) where verification_status = 'verified' and osm_ref is not null;

-- Startups (and everyone else) only see verified cafés; a café always sees its own.
drop policy if exists "mp_cafes: public read" on public.mp_cafes;
create policy "mp_cafes: public read" on public.mp_cafes for select to anon, authenticated
  using (verification_status = 'verified' or is_demo or owner_id = (select auth.uid()));

-- Signed-in owners can't verify themselves, and changing what the listing *is*
-- (another place, another name, a move across the street) means verifying again.
-- Divvit's own functions run as the table owner and are not limited by this.
create or replace function public.mp_cafes_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      new.verification_status := 'unverified';
      new.verified_at := null;
    else
      new.verification_status := old.verification_status;
      new.verified_at := old.verified_at;
      if new.osm_ref is distinct from old.osm_ref
         or lower(btrim(new.name)) <> lower(btrim(old.name))
         or abs(coalesce(new.lat, 0) - coalesce(old.lat, 0)) > 0.002
         or abs(coalesce(new.lng, 0) - coalesce(old.lng, 0)) > 0.0025 then
        new.verification_status := 'unverified';
        new.verified_at := null;
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists mp_cafes_guard on public.mp_cafes;
create trigger mp_cafes_guard before insert or update on public.mp_cafes
  for each row execute function public.mp_cafes_guard();

-- ---------------------------------------------------------------- private bits

-- codes and decisions; no client can read or write this table directly
create table if not exists public.mp_cafe_verifications (
  cafe_id      uuid primary key references public.mp_cafes (id) on delete cascade,
  method       text not null check (method in ('website', 'phone', 'review')),
  code         text not null,
  attempts     integer not null default 0,
  requested_at timestamptz not null default now(),
  decided_at   timestamptz,
  decided_by   uuid references auth.users (id) on delete set null,
  note         text
);
alter table public.mp_cafe_verifications enable row level security;
revoke all on public.mp_cafe_verifications from anon, authenticated;

create table if not exists public.mp_admins (
  user_id  uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.mp_admins enable row level security;
revoke all on public.mp_admins from anon, authenticated;
insert into public.mp_admins (user_id) select id from auth.users where email = 'raquib@divvit.app' on conflict do nothing;

create schema if not exists mp_private;
revoke all on schema mp_private from public, anon, authenticated;
create table if not exists mp_private.settings (key text primary key, value text not null);
revoke all on mp_private.settings from public, anon, authenticated;

-- ---------------------------------------------------------------- helpers

create or replace function public.mp_is_admin()
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.mp_admins where user_id = auth.uid())
$$;

-- the caller's café (one per account)
create or replace function public.mp_my_cafe_id()
returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.mp_cafes where owner_id = auth.uid() order by created_at limit 1
$$;

-- internal: flip a café to verified, refusing a second verified claim on the same place
create or replace function public.mp_mark_verified(p_cafe uuid, p_by uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  ref text;
begin
  select osm_ref into ref from public.mp_cafes where id = p_cafe;
  if ref is not null and exists (
    select 1 from public.mp_cafes where osm_ref = ref and verification_status = 'verified' and id <> p_cafe
  ) then
    raise exception 'another account has already verified this café — email hello@divvit.app';
  end if;
  update public.mp_cafes set verification_status = 'verified', verified_at = now() where id = p_cafe;
  update public.mp_cafe_verifications set decided_at = now(), decided_by = p_by, note = null where cafe_id = p_cafe;
end;
$$;

-- ---------------------------------------------------------------- the café's side

-- what the inbox shows; the phone code is never returned (it's read out on the call)
create or replace function public.mp_my_verification()
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'status', c.verification_status, 'verified_at', c.verified_at, 'osm_ref', c.osm_ref,
    'method', v.method, 'requested_at', v.requested_at, 'note', v.note, 'attempts', v.attempts,
    'website_code', case when v.method = 'website' then v.code end)
  from public.mp_cafes c
  left join public.mp_cafe_verifications v on v.cafe_id = c.id
  where c.id = public.mp_my_cafe_id()
$$;

create or replace function public.mp_request_verification(p_method text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  cid  uuid := public.mp_my_cafe_id();
  st   text;
  prev public.mp_cafe_verifications;
  code text;
begin
  if cid is null then raise exception 'list your café first'; end if;
  if p_method not in ('website', 'phone', 'review') then raise exception 'unknown verification method'; end if;
  select verification_status into st from public.mp_cafes where id = cid;
  if st = 'verified' then raise exception 'your café is already verified'; end if;

  select * into prev from public.mp_cafe_verifications where cafe_id = cid;
  -- one fresh phone code an hour, so codes can't be farmed
  if prev.method = 'phone' and p_method = 'phone' and prev.requested_at > now() - interval '1 hour' and prev.decided_at is null then
    return public.mp_my_verification();
  end if;
  -- keep the same website code if they ask again
  if prev.method = 'website' and p_method = 'website' then
    code := prev.code;
  elsif p_method = 'website' then
    code := 'divvit-' || encode(extensions.gen_random_bytes(5), 'hex');
  else
    code := lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint % 1000000))::text, 6, '0');
  end if;

  insert into public.mp_cafe_verifications (cafe_id, method, code)
  values (cid, p_method, code)
  on conflict (cafe_id) do update
    set method = excluded.method, code = excluded.code, attempts = 0, requested_at = now(),
        decided_at = null, decided_by = null, note = null;
  update public.mp_cafes set verification_status = 'pending' where id = cid;
  return public.mp_my_verification();
end;
$$;

-- the 6-digit code Divvit read out on the call to the café's public number
create or replace function public.mp_confirm_phone_code(p_code text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  cid uuid := public.mp_my_cafe_id();
  v   public.mp_cafe_verifications;
begin
  select * into v from public.mp_cafe_verifications where cafe_id = cid;
  if v.cafe_id is null or v.method <> 'phone' then raise exception 'ask for a call first'; end if;
  if v.attempts >= 5 then
    return jsonb_build_object('ok', false, 'message', 'Too many tries. Ask for a new call.');
  end if;
  update public.mp_cafe_verifications set attempts = attempts + 1 where cafe_id = cid;
  if btrim(coalesce(p_code, '')) <> v.code then
    return jsonb_build_object('ok', false, 'message', 'That code doesn''t match.');
  end if;
  perform public.mp_mark_verified(cid, null);
  return jsonb_build_object('ok', true);
end;
$$;

-- the app server found the website code on the café's public site and signed (café id : code)
create or replace function public.mp_confirm_website(p_signature text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  cid    uuid := public.mp_my_cafe_id();
  v      public.mp_cafe_verifications;
  secret text;
begin
  select * into v from public.mp_cafe_verifications where cafe_id = cid;
  if v.cafe_id is null or v.method <> 'website' then raise exception 'start the website check first'; end if;
  select value into secret from mp_private.settings where key = 'verify_secret';
  if secret is null then raise exception 'website checks aren''t set up yet'; end if;
  if p_signature is distinct from encode(extensions.hmac(cid::text || ':' || v.code, secret, 'sha256'), 'hex') then
    raise exception 'website check not confirmed';
  end if;
  perform public.mp_mark_verified(cid, null);
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------- Divvit's side

create or replace function public.mp_admin_cafes()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.mp_is_admin() then raise exception 'admins only'; end if;
  return (
    select coalesce(jsonb_agg(to_jsonb(x) order by x.sort, x.requested_at nulls last, x.created_at desc), '[]'::jsonb)
    from (
      select c.id, c.name, c.address, c.neighborhood, c.city, c.region, c.lat, c.lng, c.website, c.instagram, c.osm_ref,
             c.verification_status as status, c.verified_at, c.created_at, c.weekly_cups, c.sleeves_per_month,
             u.email as owner_email, p.full_name as owner_name, u.created_at as owner_since,
             v.method, case when v.method = 'phone' then v.code end as phone_code, v.requested_at, v.attempts, v.note,
             (select count(*) from public.mp_cafes d where d.osm_ref = c.osm_ref and d.id <> c.id) as same_place,
             exists (select 1 from public.mp_cafes d where d.osm_ref = c.osm_ref and d.id <> c.id and d.verification_status = 'verified') as place_taken,
             case c.verification_status when 'pending' then 0 when 'unverified' then 1 when 'rejected' then 2 else 3 end as sort
        from public.mp_cafes c
        join auth.users u on u.id = c.owner_id
        left join public.mp_profiles p on p.id = c.owner_id
        left join public.mp_cafe_verifications v on v.cafe_id = c.id
       where not c.is_demo
    ) x
  );
end;
$$;

create or replace function public.mp_admin_decide(p_cafe uuid, p_approve boolean, p_note text default null)
returns text
language plpgsql security definer set search_path = '' as $$
begin
  if not public.mp_is_admin() then raise exception 'admins only'; end if;
  if p_approve then
    insert into public.mp_cafe_verifications (cafe_id, method, code) values (p_cafe, 'review', '-') on conflict (cafe_id) do nothing;
    perform public.mp_mark_verified(p_cafe, auth.uid());
    return 'verified';
  end if;
  update public.mp_cafes set verification_status = 'rejected', verified_at = null where id = p_cafe;
  insert into public.mp_cafe_verifications (cafe_id, method, code, decided_at, decided_by, note)
  values (p_cafe, 'review', '-', now(), auth.uid(), left(p_note, 300))
  on conflict (cafe_id) do update set decided_at = now(), decided_by = auth.uid(), note = left(p_note, 300);
  return 'rejected';
end;
$$;

-- ---------------------------------------------------------------- only verified cafés trade

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
    select * from public.mp_cafes
     where id = any (p_cafe_ids) and sleeves_per_month > 0 and (verification_status = 'verified' or is_demo)
     order by city, name
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

create or replace function public.mp_submit_campaign(
  p_startup_id uuid, p_name text, p_cafe_ids uuid[], p_sleeves integer, p_weeks integer,
  p_branded boolean, p_start_date date, p_design jsonb, p_design_url text, p_locations jsonb, p_roi jsonb
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid    uuid := auth.uid();
  cat    text;
  ids    uuid[];
  quote  jsonb;
  cid    uuid;
  c      public.mp_cafes;
  q      record;
  opn    integer;
begin
  if uid is null then raise exception 'sign in to start a campaign' using errcode = '28000'; end if;
  select s.category into cat from public.mp_startups s where s.id = p_startup_id and s.owner_id = uid;
  if not found then raise exception 'that startup isn''t yours'; end if;
  if p_start_date is not null and p_start_date < current_date - 1 then
    raise exception 'pick a start date from today on';
  end if;

  select coalesce(array_agg(x.id), '{}') into ids
    from public.mp_cafes x
   where x.id = any (p_cafe_ids)
     and x.sleeves_per_month > 0
     and (x.verification_status = 'verified' or x.is_demo)
     and not (cat = any (x.blocked_categories))
     and (cardinality(x.accepted_categories) = 0 or cat = any (x.accepted_categories))
     and x.owner_id is distinct from uid;

  quote := public.mp_quote(ids, p_sleeves, p_weeks, p_branded);
  if (quote ->> 'cafe_count')::integer = 0 then raise exception 'none of those cafés can take this campaign — pick another area'; end if;

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

  for c in select * from public.mp_cafes where id = any (ids) loop
    select count(*) into opn from public.mp_campaign_cafes o
      where o.cafe_id = c.id and o.status in ('pending', 'accepted') and o.campaign_id <> cid;
    select * into q from public.mp_line_quote(c, p_sleeves, p_weeks, coalesce(p_branded, false), opn);
    insert into public.mp_campaign_cafes (campaign_id, cafe_id, sleeves, branded_drink, price_cents, payout_cents)
    values (cid, c.id, q.sleeves, q.branded, q.price_cents, q.payout_cents);
  end loop;

  return cid;
end;
$$;

-- an unverified café can pass on an offer, but only a verified one can take it
create or replace function public.mp_respond_offer(p_offer_id uuid, p_accept boolean)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  uid  uuid := auth.uid();
  st   text;
  cid  uuid;
begin
  if uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if p_accept and not exists (
    select 1 from public.mp_campaign_cafes o join public.mp_cafes c on c.id = o.cafe_id
     where o.id = p_offer_id and c.owner_id = uid and c.verification_status = 'verified'
  ) then
    raise exception 'verify your café before accepting offers';
  end if;

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

-- ---------------------------------------------------------------- grants

revoke all on function public.mp_cafes_guard() from public, anon, authenticated;
revoke all on function public.mp_mark_verified(uuid, uuid) from public, anon, authenticated;
revoke all on function public.mp_my_cafe_id() from public, anon;
revoke all on function public.mp_is_admin() from public, anon;
revoke all on function public.mp_my_verification() from public, anon;
revoke all on function public.mp_request_verification(text) from public, anon;
revoke all on function public.mp_confirm_phone_code(text) from public, anon;
revoke all on function public.mp_confirm_website(text) from public, anon;
revoke all on function public.mp_admin_cafes() from public, anon;
revoke all on function public.mp_admin_decide(uuid, boolean, text) from public, anon;

grant execute on function public.mp_my_cafe_id() to authenticated;
grant execute on function public.mp_is_admin() to authenticated;
grant execute on function public.mp_my_verification() to authenticated;
grant execute on function public.mp_request_verification(text) to authenticated;
grant execute on function public.mp_confirm_phone_code(text) to authenticated;
grant execute on function public.mp_confirm_website(text) to authenticated;
grant execute on function public.mp_admin_cafes() to authenticated;
grant execute on function public.mp_admin_decide(uuid, boolean, text) to authenticated;
