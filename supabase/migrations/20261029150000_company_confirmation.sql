-- Company confirmation: before a startup's first campaign is approved, the Divvit team
-- knows the account belongs to the company it names. Startups use the marketplace
-- right away; confirmation is checked at approval (no campaign is approved, paid for
-- or offered to a café until it's done). Three ways:
--   email       their own sign-in email is at the company's domain (they confirmed that
--               mailbox at sign-up), checked automatically
--   work_email  they ask for a link at an address on the company's domain and click it
--               (app/api/startups/confirm/route.ts sends it)
--   team        the Divvit team confirms it on the call, with a note
-- Free email providers and shared hosting domains never count as a company domain.

alter table public.mp_startups
  add column confirmed_at  timestamptz,
  add column confirmed_via text check (confirmed_via in ('email', 'work_email', 'team')),
  add column confirmed_email text,   -- the company address that proved it
  add column confirm_note  text;     -- the team's note when it was confirmed on a call

-- "https://www.app.brex.com/x" or "jane@mail.brex.com" (after the @) → "brex.com"; "shop.example.co.uk" → "example.co.uk"
create or replace function public.mp_base_domain(p text)
returns text language sql immutable set search_path = '' as $$
  with h as (select lower(regexp_replace(regexp_replace(regexp_replace(btrim(coalesce(p, '')), '^[a-z][a-z0-9+.-]*://', '', 'i'), '[/?#:@].*$', ''), '\.$', '')) as host),
       l as (select host, string_to_array(host, '.') as parts, coalesce(array_length(string_to_array(host, '.'), 1), 0) as n from h)
  select case
    when n < 2 or host !~ '^[a-z0-9.-]+$' then null
    when n >= 3 and length(parts[n]) = 2 and parts[n - 1] in ('co', 'com', 'org', 'net', 'ac', 'gov', 'edu') then array_to_string(parts[n - 2:n], '.')
    else array_to_string(parts[n - 1:n], '.')
  end from l
$$;

-- domains anyone can get an address or a site on: never proof of a company
create or replace function public.mp_shared_domain(d text)
returns boolean language sql immutable set search_path = '' as $$
  select d is null or d = any (array[
    'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com', 'ymail.com', 'icloud.com',
    'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'pm.me', 'gmx.com', 'gmx.net', 'zoho.com', 'mail.com',
    'yandex.com', 'hey.com', 'fastmail.com', 'tutanota.com', 'qq.com', '163.com',
    'vercel.app', 'github.io', 'netlify.app', 'webflow.io', 'framer.website', 'framer.app', 'framer.ai', 'carrd.co', 'notion.site',
    'substack.com', 'wixsite.com', 'squarespace.com', 'myshopify.com', 'herokuapp.com', 'pages.dev', 'linktr.ee', 'replit.app',
    'softr.app', 'bubbleapps.io', 'super.site', 'medium.com', 'linkedin.com', 'google.com', 'sites.google.com'])
$$;

-- owners can't confirm themselves, and a new website means a new company to confirm
create or replace function public.mp_startups_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      new.confirmed_at := null; new.confirmed_via := null; new.confirmed_email := null; new.confirm_note := null;
    else
      new.confirmed_at := old.confirmed_at; new.confirmed_via := old.confirmed_via;
      new.confirmed_email := old.confirmed_email; new.confirm_note := old.confirm_note;
    end if;
  end if;
  if tg_op = 'UPDATE' and public.mp_base_domain(new.website) is distinct from public.mp_base_domain(old.website) then
    new.confirmed_at := null; new.confirmed_via := null; new.confirmed_email := null; new.confirm_note := null;
  end if;
  return new;
end;
$$;
create trigger mp_startups_guard before insert or update on public.mp_startups
  for each row execute function public.mp_startups_guard();
revoke all on function public.mp_startups_guard() from public, anon, authenticated;

-- internal: confirm by the owner's own (confirmed) sign-in email when it's at the company's domain
create or replace function public.mp_try_confirm_company(p_startup uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  s public.mp_startups;
  em text;
  ok timestamptz;
  d text;
begin
  select * into s from public.mp_startups where id = p_startup;
  if s.id is null then return false; end if;
  if s.confirmed_at is not null then return true; end if;
  select u.email, u.email_confirmed_at into em, ok from auth.users u where u.id = s.owner_id;
  d := public.mp_base_domain(split_part(coalesce(em, ''), '@', 2));
  if ok is null or public.mp_shared_domain(d) or d is distinct from public.mp_base_domain(s.website) then return false; end if;
  update public.mp_startups set confirmed_at = now(), confirmed_via = 'email', confirmed_email = lower(em) where id = s.id;
  return true;
end;
$$;
revoke all on function public.mp_try_confirm_company(uuid) from public, anon, authenticated;

-- links sent to a work address (one live link per startup; only its hash is kept)
create table public.mp_company_confirmations (
  startup_id uuid primary key references public.mp_startups (id) on delete cascade,
  email      text not null,
  token_hash text not null,
  sent_at    timestamptz not null default now(),
  sends      integer not null default 1
);
alter table public.mp_company_confirmations enable row level security;
revoke all on public.mp_company_confirmations from anon, authenticated;

-- the signed-in startup's confirmation, checking its sign-in email first
create or replace function public.mp_company_status()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.mp_startups;
  site text;
  em text;
  pend_email text;
  pend_at timestamptz;
begin
  select * into s from public.mp_startups where owner_id = auth.uid() order by created_at limit 1;
  if s.id is null then return null; end if;
  perform public.mp_try_confirm_company(s.id);
  select * into s from public.mp_startups where id = s.id;
  site := public.mp_base_domain(s.website);
  select email into em from auth.users where id = auth.uid();
  select c.email, c.sent_at into pend_email, pend_at from public.mp_company_confirmations c
   where c.startup_id = s.id and c.sent_at > now() - interval '24 hours';
  return jsonb_build_object('confirmed', s.confirmed_at is not null, 'via', s.confirmed_via, 'email', s.confirmed_email,
    'domain', site, 'shared_domain', site is not null and public.mp_shared_domain(site), 'account_email', em,
    'pending_email', pend_email, 'pending_sent_at', pend_at);
end;
$$;
revoke all on function public.mp_company_status() from public, anon;
grant execute on function public.mp_company_status() to authenticated;

-- server only (DIVVIT_VERIFY_SECRET): start a work-email confirmation; the token goes out by email, never to the browser
create or replace function public.mp_start_company_confirm(p_secret text, p_user uuid, p_email text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.mp_startups;
  prev public.mp_company_confirmations;
  e text := lower(btrim(coalesce(p_email, '')));
  site text;
  tok text;
begin
  if not public.mp_server_ok(p_secret) then raise exception 'not allowed'; end if;
  select * into s from public.mp_startups where owner_id = p_user order by created_at limit 1;
  if s.id is null then raise exception 'set up your startup profile first'; end if;
  if s.confirmed_at is not null then raise exception 'your company is already confirmed'; end if;
  if e !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'that doesn''t look like an email address'; end if;
  site := public.mp_base_domain(s.website);
  if site is null then raise exception 'add your company''s website to your profile first'; end if;
  if public.mp_shared_domain(site) then raise exception 'your website is on a shared host, so we''ll confirm your company on our call instead'; end if;
  if public.mp_base_domain(split_part(e, '@', 2)) is distinct from site then raise exception 'use an address at %', site; end if;
  select * into prev from public.mp_company_confirmations where startup_id = s.id;
  if prev.startup_id is not null and prev.sent_at > now() - interval '1 minute' then raise exception 'we just sent a link, so give it a minute'; end if;
  if prev.startup_id is not null and prev.sends >= 10 and prev.sent_at > now() - interval '1 day' then raise exception 'that''s a lot of links today: try again tomorrow'; end if;
  tok := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.mp_company_confirmations (startup_id, email, token_hash)
  values (s.id, e, encode(extensions.digest(tok, 'sha256'), 'hex'))
  on conflict (startup_id) do update
    set email = excluded.email, token_hash = excluded.token_hash, sent_at = now(),
        sends = case when public.mp_company_confirmations.sent_at > now() - interval '1 day' then public.mp_company_confirmations.sends + 1 else 1 end;
  return jsonb_build_object('token', tok, 'email', e, 'startup', s.name, 'domain', site);
end;
$$;

-- server only: the link was clicked
create or replace function public.mp_finish_company_confirm(p_secret text, p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.mp_company_confirmations;
  s public.mp_startups;
begin
  if not public.mp_server_ok(p_secret) then raise exception 'not allowed'; end if;
  select * into c from public.mp_company_confirmations where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  if c.startup_id is null or c.sent_at < now() - interval '24 hours' then return jsonb_build_object('ok', false); end if;
  select * into s from public.mp_startups where id = c.startup_id;
  -- the website may have changed since the link went out
  if public.mp_base_domain(split_part(c.email, '@', 2)) is distinct from public.mp_base_domain(s.website) then return jsonb_build_object('ok', false); end if;
  update public.mp_startups set confirmed_at = now(), confirmed_via = 'work_email', confirmed_email = c.email where id = s.id;
  delete from public.mp_company_confirmations where startup_id = s.id;
  return jsonb_build_object('ok', true, 'startup', s.name);
end;
$$;

-- the team confirmed it on the call
create or replace function public.mp_admin_confirm_company(p_startup uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.mp_is_admin() then raise exception 'admins only'; end if;
  update public.mp_startups
     set confirmed_at = now(), confirmed_via = 'team', confirmed_email = null, confirm_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_startup;
  if not found then raise exception 'startup not found'; end if;
end;
$$;
revoke all on function public.mp_admin_confirm_company(uuid, text) from public, anon;
grant execute on function public.mp_admin_confirm_company(uuid, text) to authenticated;

-- approval needs a confirmed company
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
    if not public.mp_try_confirm_company(k.startup_id) then
      raise exception 'confirm this company first: their email isn''t at their website''s domain, so confirm it on your call (or ask them to confirm a work email)';
    end if;
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

-- the team's list: each campaign's company confirmation, and other accounts on the same domain
create or replace function public.mp_admin_campaigns()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.mp_is_admin() then raise exception 'admins only'; end if;
  perform public.mp_try_confirm_company(s.id) from public.mp_startups s where s.confirmed_at is null;
  return (
    select coalesce(jsonb_agg(to_jsonb(x) - 'sort' order by x.sort, x.created_at desc), '[]'::jsonb)
    from (
      select k.id, k.name, k.status, k.start_date, k.weeks, k.sleeves_per_cafe, k.branded_drink, k.design_url,
             k.subtotal_cents, k.discount_cents, k.fee_cents, k.total_cents, k.final_cents, k.review_note,
             k.reviewed_at, k.paid_at, k.created_at,
             case k.status when 'submitted' then 0 when 'approved' then 1 when 'paid' then 2 when 'active' then 3 else 4 end as sort,
             s.id as startup_id, s.name as startup_name, s.website, s.category, s.hq, s.description, s.logo_url, s.linkedin_url,
             s.confirmed_at, s.confirmed_via, s.confirmed_email, s.confirm_note, public.mp_base_domain(s.website) as domain,
             u.email as owner_email, p.full_name as owner_name,
             (select coalesce(jsonb_agg(jsonb_build_object('name', o.name, 'email', ou.email, 'confirmed', o.confirmed_at is not null)), '[]'::jsonb)
                from public.mp_startups o join auth.users ou on ou.id = o.owner_id
               where o.id <> s.id and public.mp_base_domain(s.website) is not null
                 and public.mp_base_domain(o.website) = public.mp_base_domain(s.website)) as same_domain,
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
