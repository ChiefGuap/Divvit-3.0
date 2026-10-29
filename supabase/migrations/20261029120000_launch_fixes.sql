-- Launch fixes (pre-launch check, 2026-10-28)
--   1. A café's "new campaign" notice clears once it answers the offer.
--   2. Sample cafés never get paid for: approving a campaign takes them off it, and a
--      campaign of only sample cafés can't be approved.
--   3. The Divvit team hears (email) when a café asks to be verified by phone or by hand.
--   4. Queued emails go out on their own: pg_net calls the app every 5 minutes while
--      anything is waiting (mp_private.settings 'app_url' + the shared verify secret).
--   5. Indexes for the marketplace's foreign keys.

-- ---------------------------------------------------------------- 1. offer notices

create or replace function public.mp_respond_offer(p_offer_id uuid, p_accept boolean)
returns text language plpgsql security definer set search_path = '' as $$
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
    from public.mp_cafes c, public.mp_campaigns k
   where o.id = p_offer_id and c.id = o.cafe_id and c.owner_id = uid and o.status = 'pending'
     and k.id = o.campaign_id and k.status in ('paid', 'active')
  returning o.status, o.campaign_id into st, cid;

  if st is null then raise exception 'offer not found or already answered'; end if;
  -- answered: the "new campaign" notice has done its job
  update public.mp_notifications set read_at = now() where offer_id = p_offer_id and read_at is null;
  if p_accept then
    update public.mp_campaigns set status = 'active' where id = cid and status = 'paid';
  end if;
  return st;
end;
$$;

-- ---------------------------------------------------------------- 2. sample cafés

create or replace function public.mp_admin_review_campaign(p_campaign uuid, p_approve boolean, p_final_cents integer default null, p_note text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  k   public.mp_campaigns;
  amt integer;
begin
  if not public.mp_is_admin() then raise exception 'admins only'; end if;
  select * into k from public.mp_campaigns where id = p_campaign for update;
  if not found then raise exception 'campaign not found'; end if;
  if k.status not in ('submitted', 'approved') then raise exception 'this campaign is already %', k.status; end if;
  -- a new decision replaces the last one's notification
  update public.mp_notifications set read_at = now() where campaign_id = k.id and kind = 'campaign_approved' and read_at is null;

  if p_approve then
    -- sample cafés show startups what's possible; they can't run a campaign, so they come off before anyone pays
    if not exists (select 1 from public.mp_campaign_cafes o join public.mp_cafes c on c.id = o.cafe_id
                    where o.campaign_id = k.id and not c.is_demo) then
      raise exception 'every café in this campaign is a sample café, so it can''t run. Decline it with a note, or wait for real cafés nearby';
    end if;
    delete from public.mp_campaign_cafes o using public.mp_cafes c where o.campaign_id = k.id and c.id = o.cafe_id and c.is_demo;
    amt := coalesce(p_final_cents, k.final_cents, k.total_cents);
    if amt is null or amt < 50 then raise exception 'set a price of at least $0.50'; end if;
    update public.mp_campaigns
       set status = 'approved', final_cents = amt, review_note = nullif(trim(p_note), ''), reviewed_at = now(), reviewed_by = auth.uid()
     where id = k.id;
    insert into public.mp_notifications (user_id, kind, title, body, link, campaign_id)
    values (k.owner_id, 'campaign_approved', 'Your campaign is approved',
            format('Pay %s to send “%s” to cafés.', to_char(amt / 100.0, 'FM$999,999,990.00'), k.name), '/campaigns/' || k.id || '/pay', k.id);
    insert into public.mp_outbox (kind, campaign_id) values ('campaign_approved', k.id);
    return 'approved';
  end if;

  update public.mp_campaigns
     set status = 'declined', review_note = coalesce(nullif(trim(p_note), ''), 'We can''t run this campaign right now.'),
         reviewed_at = now(), reviewed_by = auth.uid()
   where id = k.id;
  insert into public.mp_notifications (user_id, kind, title, body, link, campaign_id)
  values (k.owner_id, 'campaign_declined', 'About your campaign',
          coalesce(nullif(trim(p_note), ''), 'We can''t run this campaign right now.'), '/home#campaigns', k.id);
  insert into public.mp_outbox (kind, campaign_id) values ('campaign_declined', k.id);
  return 'declined';
end;
$$;

-- ---------------------------------------------------------------- 3. café verification requests → team email

alter table public.mp_outbox add column cafe_id uuid references public.mp_cafes (id) on delete cascade;
alter table public.mp_outbox drop constraint mp_outbox_kind_check;
alter table public.mp_outbox add constraint mp_outbox_kind_check
  check (kind in ('campaign_submitted', 'campaign_approved', 'campaign_declined', 'campaign_paid', 'offer_new', 'campaign_finished', 'cafe_verification'));

create or replace function public.mp_request_verification(p_method text)
returns jsonb language plpgsql security definer set search_path = '' as $$
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
  if prev.method = 'phone' and p_method = 'phone' and prev.requested_at > now() - interval '1 hour' and prev.decided_at is null then
    return public.mp_my_verification();
  end if;
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
  -- a call or a manual check needs someone on the team; the website check runs by itself
  if p_method in ('phone', 'review') then
    insert into public.mp_outbox (kind, cafe_id) values ('cafe_verification', cid);
  end if;
  return public.mp_my_verification();
end;
$$;

create or replace function public.mp_outbox_pending(p_secret text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.mp_server_ok(p_secret) then raise exception 'not allowed'; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', o.id, 'kind', o.kind, 'attempts', o.attempts,
      'campaign', case when k.id is null then null else jsonb_build_object('id', k.id, 'name', k.name, 'start_date', k.start_date, 'weeks', k.weeks,
        'sleeves_per_cafe', k.sleeves_per_cafe, 'branded_drink', k.branded_drink, 'total_cents', k.total_cents,
        'final_cents', k.final_cents, 'review_note', k.review_note, 'design_url', k.design_url, 'created_at', k.created_at) end,
      'startup', case when s.id is null then null else jsonb_build_object('name', s.name, 'website', s.website, 'category', s.category, 'hq', s.hq,
        'description', s.description, 'linkedin_url', s.linkedin_url) end,
      'owner', case when u.id is null then null else jsonb_build_object('email', u.email, 'name', p.full_name) end,
      'cafes', (select coalesce(jsonb_agg(jsonb_build_object('name', c.name, 'neighborhood', c.neighborhood, 'city', c.city,
                  'sleeves', cc.sleeves, 'demo', c.is_demo) order by c.city, c.name), '[]'::jsonb)
                from public.mp_campaign_cafes cc join public.mp_cafes c on c.id = cc.cafe_id where cc.campaign_id = k.id),
      'offer', (select jsonb_build_object('id', cc.id, 'cafe_name', c.name, 'sleeves', cc.sleeves, 'payout_cents', cc.payout_cents,
                  'branded_drink', cc.branded_drink, 'email', cu.email, 'name', cp.full_name)
                  from public.mp_campaign_cafes cc join public.mp_cafes c on c.id = cc.cafe_id
                  join auth.users cu on cu.id = c.owner_id left join public.mp_profiles cp on cp.id = c.owner_id
                 where cc.id = o.offer_id),
      'cafe', (select jsonb_build_object('id', c.id, 'name', c.name, 'address', c.address, 'neighborhood', c.neighborhood, 'city', c.city,
                  'website', c.website, 'osm_ref', c.osm_ref, 'email', cu.email, 'name_of_owner', cp.full_name, 'method', v.method)
                  from public.mp_cafes c join auth.users cu on cu.id = c.owner_id left join public.mp_profiles cp on cp.id = c.owner_id
                  left join public.mp_cafe_verifications v on v.cafe_id = c.id
                 where c.id = o.cafe_id)
    ) order by o.id), '[]'::jsonb)
    from public.mp_outbox o
    left join public.mp_campaigns k on k.id = o.campaign_id
    left join public.mp_startups s on s.id = k.startup_id
    left join auth.users u on u.id = k.owner_id
    left join public.mp_profiles p on p.id = k.owner_id
    where o.sent_at is null and o.attempts < 5
  );
end;
$$;

-- ---------------------------------------------------------------- 4. send queued emails every 5 minutes

create extension if not exists pg_net;
insert into mp_private.settings (key, value) values ('app_url', 'https://marketplace.divvit.app') on conflict (key) do nothing;
select cron.schedule('mp-send-emails', '*/5 * * * *', $job$
  select net.http_post(
    url := a.value || '/api/campaigns/notify',
    headers := jsonb_build_object('content-type', 'application/json', 'x-divvit-cron', s.value),
    body := '{}'::jsonb)
  from mp_private.settings a, mp_private.settings s
  where a.key = 'app_url' and s.key = 'verify_secret' and a.value like 'https://%'
    and exists (select 1 from public.mp_outbox where sent_at is null and attempts < 5)
$job$);

-- ---------------------------------------------------------------- 5. indexes

create index if not exists mp_notifications_campaign_idx on public.mp_notifications (campaign_id);
create index if not exists mp_notifications_offer_idx on public.mp_notifications (offer_id);
create index if not exists mp_outbox_campaign_idx on public.mp_outbox (campaign_id);
create index if not exists mp_outbox_offer_idx on public.mp_outbox (offer_id);
create index if not exists mp_outbox_cafe_idx on public.mp_outbox (cafe_id);
create index if not exists mp_campaigns_reviewed_by_idx on public.mp_campaigns (reviewed_by);
create index if not exists mp_cafe_verifications_decided_by_idx on public.mp_cafe_verifications (decided_by);
create index if not exists mp_saved_cafes_cafe_idx on public.mp_saved_cafes (cafe_id);
