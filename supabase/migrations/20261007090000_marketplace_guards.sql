-- Marketplace guards found in end-to-end testing.
--
-- 1. One role per account: only startup accounts create startup profiles and
--    only café accounts create café listings. (The sign-up trigger is security
--    definer and creates the first row itself, so it isn't affected.)
-- 2. Offers are readable by the startup that sent them and the café that got
--    them. The old policy read mp_cafes.owner_id, a column signed-in users
--    aren't granted, so any direct read failed; it now asks a definer helper.
-- 3. mp_submit_campaign no longer trusts the browser's café list: cafés that
--    don't take the startup's category (or block it) are dropped, a startup
--    can't send offers to its own café, and the start date can't be in the past.

drop policy if exists "mp_startups: insert own" on public.mp_startups;
create policy "mp_startups: insert own" on public.mp_startups for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.mp_profiles p where p.id = (select auth.uid()) and p.role = 'startup')
  );

drop policy if exists "mp_cafes: insert own" on public.mp_cafes;
create policy "mp_cafes: insert own" on public.mp_cafes for insert to authenticated
  with check (
    owner_id = (select auth.uid()) and not is_demo
    and exists (select 1 from public.mp_profiles p where p.id = (select auth.uid()) and p.role = 'cafe')
  );

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
  -- a day of slack for time zones: the browser picks dates in local time
  if p_start_date is not null and p_start_date < current_date - 1 then
    raise exception 'pick a start date from today on';
  end if;

  -- only cafés that would actually take this startup
  select coalesce(array_agg(x.id), '{}') into ids
    from public.mp_cafes x
   where x.id = any (p_cafe_ids)
     and x.sleeves_per_month > 0
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

revoke all on function public.mp_submit_campaign(uuid, text, uuid[], integer, integer, boolean, date, jsonb, text, jsonb, jsonb) from public, anon;
grant execute on function public.mp_submit_campaign(uuid, text, uuid[], integer, integer, boolean, date, jsonb, text, jsonb, jsonb) to authenticated;

create or replace function public.mp_owns_cafe(p_cafe uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.mp_cafes c where c.id = p_cafe and c.owner_id = auth.uid())
$$;
revoke all on function public.mp_owns_cafe(uuid) from public, anon;
grant execute on function public.mp_owns_cafe(uuid) to authenticated;

drop policy if exists "mp_campaign_cafes: read as startup or cafe" on public.mp_campaign_cafes;
create policy "mp_campaign_cafes: read as startup or cafe" on public.mp_campaign_cafes for select to authenticated using (
  exists (select 1 from public.mp_campaigns k where k.id = campaign_id and k.owner_id = (select auth.uid()))
  or public.mp_owns_cafe(cafe_id)
);
