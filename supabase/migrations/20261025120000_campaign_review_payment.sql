-- Campaigns are reviewed and paid for before cafés see them:
--   submitted → (Divvit team approves, sets the final price) approved → (startup pays
--   through Stripe Checkout) paid → (a café accepts) active → completed
--   submitted/approved → declined by the team
-- Startups and cafés hear about each step by email (mp_outbox) and in their
-- dashboard (mp_notifications).

alter table public.mp_campaigns drop constraint mp_campaigns_status_check;
alter table public.mp_campaigns add constraint mp_campaigns_status_check
  check (status in ('submitted', 'approved', 'paid', 'active', 'completed', 'declined', 'cancelled'));
alter table public.mp_campaigns
  add column final_cents integer check (final_cents is null or final_cents >= 50),
  add column review_note text,
  add column reviewed_at timestamptz,
  add column reviewed_by uuid references auth.users (id) on delete set null,
  add column paid_at timestamptz,
  add column stripe_session_id text unique,
  add column stripe_payment_intent text;

-- ---------------------------------------------------------------- dashboard notifications
create table public.mp_notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('campaign_approved', 'campaign_declined', 'campaign_paid', 'offer_new')),
  title text not null,
  body text,
  link text,
  campaign_id uuid references public.mp_campaigns (id) on delete cascade,
  offer_id uuid references public.mp_campaign_cafes (id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index mp_notifications_user_idx on public.mp_notifications (user_id, created_at desc);
alter table public.mp_notifications enable row level security;
create policy "mp_notifications: read own" on public.mp_notifications
  for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.mp_notifications from anon, authenticated;
grant select on public.mp_notifications to authenticated;

create function public.mp_read_notification(p_id bigint)
returns void language sql security definer set search_path = '' as $$
  update public.mp_notifications set read_at = coalesce(read_at, now()) where id = p_id and user_id = auth.uid();
$$;
revoke execute on function public.mp_read_notification(bigint) from public, anon;
grant execute on function public.mp_read_notification(bigint) to authenticated;

-- ---------------------------------------------------------------- emails for every step
alter table public.mp_outbox drop constraint mp_outbox_kind_check;
alter table public.mp_outbox add constraint mp_outbox_kind_check
  check (kind in ('campaign_submitted', 'campaign_approved', 'campaign_declined', 'campaign_paid', 'offer_new'));
alter table public.mp_outbox add column offer_id uuid references public.mp_campaign_cafes (id) on delete cascade;

-- ---------------------------------------------------------------- cafés only see paid campaigns
create function public.mp_campaign_released(p_campaign uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.mp_campaigns where id = p_campaign and status in ('paid', 'active', 'completed'))
$$;
revoke execute on function public.mp_campaign_released(uuid) from public, anon;
grant execute on function public.mp_campaign_released(uuid) to authenticated;

drop policy "mp_campaign_cafes: read as startup or cafe" on public.mp_campaign_cafes;
create policy "mp_campaign_cafes: read as startup or cafe" on public.mp_campaign_cafes
  for select to authenticated using (
    exists (select 1 from public.mp_campaigns k where k.id = mp_campaign_cafes.campaign_id and k.owner_id = (select auth.uid()))
    or (public.mp_owns_cafe(cafe_id) and public.mp_campaign_released(campaign_id)));

create or replace function public.mp_cafe_inbox()
returns jsonb language sql stable security definer set search_path = '' as $$
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
       and k.status in ('paid', 'active', 'completed')
  ) x
$$;

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
  if p_accept then
    update public.mp_campaigns set status = 'active' where id = cid and status = 'paid';
  end if;
  return st;
end;
$$;

-- the startup's own list now carries the review and payment
create or replace function public.mp_my_campaigns()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
  from (
    select k.id, k.name, k.status, k.start_date, k.weeks, k.sleeves_per_cafe, k.branded_drink,
           k.total_cents, k.final_cents, k.review_note, k.reviewed_at, k.paid_at,
           k.design, k.design_url, k.created_at, s.name as startup_name,
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

-- ---------------------------------------------------------------- the Divvit team's review
create function public.mp_admin_campaigns()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.mp_is_admin() then raise exception 'admins only'; end if;
  return (
    select coalesce(jsonb_agg(to_jsonb(x) - 'sort' order by x.sort, x.created_at desc), '[]'::jsonb)
    from (
      select k.id, k.name, k.status, k.start_date, k.weeks, k.sleeves_per_cafe, k.branded_drink, k.design_url,
             k.subtotal_cents, k.discount_cents, k.fee_cents, k.total_cents, k.final_cents, k.review_note,
             k.reviewed_at, k.paid_at, k.created_at,
             case k.status when 'submitted' then 0 when 'approved' then 1 when 'paid' then 2 when 'active' then 3 else 4 end as sort,
             s.name as startup_name, s.website, s.category, s.hq, s.description, s.logo_url, s.linkedin_url,
             u.email as owner_email, p.full_name as owner_name,
             (select coalesce(jsonb_agg(jsonb_build_object(
                       'name', c.name, 'neighborhood', c.neighborhood, 'city', c.city, 'is_demo', c.is_demo, 'status', o.status,
                       'sleeves', o.sleeves, 'price_cents', o.price_cents, 'payout_cents', o.payout_cents) order by c.city, c.name), '[]'::jsonb)
                from public.mp_campaign_cafes o join public.mp_cafes c on c.id = o.cafe_id where o.campaign_id = k.id) as cafes
        from public.mp_campaigns k
        join public.mp_startups s on s.id = k.startup_id
        join auth.users u on u.id = k.owner_id
        left join public.mp_profiles p on p.id = k.owner_id
    ) x
  );
end;
$$;
revoke execute on function public.mp_admin_campaigns() from public, anon;
grant execute on function public.mp_admin_campaigns() to authenticated;

-- approve (with the final price) or decline; the startup hears about it by email and on its dashboard
create function public.mp_admin_review_campaign(p_campaign uuid, p_approve boolean, p_final_cents integer default null, p_note text default null)
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
revoke execute on function public.mp_admin_review_campaign(uuid, boolean, integer, text) from public, anon;
grant execute on function public.mp_admin_review_campaign(uuid, boolean, integer, text) to authenticated;

-- ---------------------------------------------------------------- payment (server only: Stripe webhook / checkout return)
-- Safe to call more than once for the same payment. Releases the offers to cafés.
create function public.mp_mark_campaign_paid(p_secret text, p_campaign uuid, p_session text, p_payment_intent text, p_amount integer)
returns text language plpgsql security definer set search_path = '' as $$
declare
  k      public.mp_campaigns;
  sname  text;
  o      record;
  sent   integer := 0;
begin
  if not public.mp_server_ok(p_secret) then raise exception 'not allowed'; end if;
  select * into k from public.mp_campaigns where id = p_campaign for update;
  if not found then raise exception 'campaign not found'; end if;
  if k.status in ('paid', 'active', 'completed') then return 'already paid'; end if;
  if k.status <> 'approved' then raise exception 'campaign is %, not waiting for payment', k.status; end if;
  if p_amount is distinct from k.final_cents then raise exception 'paid % but the price is %', p_amount, k.final_cents; end if;

  update public.mp_campaigns
     set status = 'paid', paid_at = now(), stripe_session_id = p_session, stripe_payment_intent = p_payment_intent
   where id = k.id;
  select s.name into sname from public.mp_startups s where s.id = k.startup_id;

  -- each café with an owner hears about its offer (sample cafés have none)
  for o in
    select cc.id, cc.payout_cents, c.owner_id, c.name
      from public.mp_campaign_cafes cc join public.mp_cafes c on c.id = cc.cafe_id
     where cc.campaign_id = k.id and cc.status = 'pending' and c.owner_id is not null
  loop
    insert into public.mp_notifications (user_id, kind, title, body, link, campaign_id, offer_id)
    values (o.owner_id, 'offer_new', format('New campaign from %s', sname),
            format('Earn %s for running it at %s. Accept or pass.', to_char(o.payout_cents / 100.0, 'FM$999,999,990.00'), o.name),
            '/cafes/inbox#offer-' || o.id, k.id, o.id);
    insert into public.mp_outbox (kind, campaign_id, offer_id) values ('offer_new', k.id, o.id);
    sent := sent + 1;
  end loop;

  insert into public.mp_notifications (user_id, kind, title, body, link, campaign_id)
  values (k.owner_id, 'campaign_paid', 'Payment received',
          format('“%s” is on its way to cafés. You''ll see each one accept on your dashboard.', k.name), '/home#campaigns', k.id);
  update public.mp_notifications set read_at = now() where campaign_id = k.id and kind = 'campaign_approved' and read_at is null;
  insert into public.mp_outbox (kind, campaign_id) values ('campaign_paid', k.id);
  return 'paid';
end;
$$;
revoke execute on function public.mp_mark_campaign_paid(text, uuid, text, text, integer) from public;
grant execute on function public.mp_mark_campaign_paid(text, uuid, text, text, integer) to anon, authenticated;

-- ---------------------------------------------------------------- what each pending email needs
create or replace function public.mp_outbox_pending(p_secret text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.mp_server_ok(p_secret) then raise exception 'not allowed'; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', o.id, 'kind', o.kind, 'attempts', o.attempts,
      'campaign', jsonb_build_object('id', k.id, 'name', k.name, 'start_date', k.start_date, 'weeks', k.weeks,
        'sleeves_per_cafe', k.sleeves_per_cafe, 'branded_drink', k.branded_drink, 'total_cents', k.total_cents,
        'final_cents', k.final_cents, 'review_note', k.review_note, 'design_url', k.design_url, 'created_at', k.created_at),
      'startup', jsonb_build_object('name', s.name, 'website', s.website, 'category', s.category, 'hq', s.hq,
        'description', s.description, 'linkedin_url', s.linkedin_url),
      'owner', jsonb_build_object('email', u.email, 'name', p.full_name),
      'cafes', (select coalesce(jsonb_agg(jsonb_build_object('name', c.name, 'neighborhood', c.neighborhood, 'city', c.city,
                  'sleeves', cc.sleeves, 'demo', c.is_demo) order by c.city, c.name), '[]'::jsonb)
                from public.mp_campaign_cafes cc join public.mp_cafes c on c.id = cc.cafe_id where cc.campaign_id = k.id),
      'offer', (select jsonb_build_object('id', cc.id, 'cafe_name', c.name, 'sleeves', cc.sleeves, 'payout_cents', cc.payout_cents,
                  'branded_drink', cc.branded_drink, 'email', cu.email, 'name', cp.full_name)
                  from public.mp_campaign_cafes cc join public.mp_cafes c on c.id = cc.cafe_id
                  join auth.users cu on cu.id = c.owner_id left join public.mp_profiles cp on cp.id = c.owner_id
                 where cc.id = o.offer_id)
    ) order by o.id), '[]'::jsonb)
    from public.mp_outbox o
    join public.mp_campaigns k on k.id = o.campaign_id
    join public.mp_startups s on s.id = k.startup_id
    join auth.users u on u.id = k.owner_id
    left join public.mp_profiles p on p.id = k.owner_id
    where o.sent_at is null and o.attempts < 5
  );
end;
$$;
