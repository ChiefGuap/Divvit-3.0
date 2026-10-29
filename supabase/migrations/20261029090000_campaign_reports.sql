-- Campaign reports: what a startup's campaign did, while it runs and when it's done.
--   Measured:  QR scans. The sleeve's QR code points at divvit.app/s/<scan_code>, which
--              counts the scan (app/s/[code]/route.ts → mp_record_scan) and forwards to
--              the startup's website. Only scans while the sleeves are out count.
--   Estimated: sleeves handed out and people reached (the UI labels these).
-- A campaign is marked completed once its last day has passed (pg_cron, hourly), and the
-- startup gets a "your report is ready" notice and email.

-- ---------------------------------------------------------------- scan codes

alter table public.mp_campaigns add column scan_code text unique;

-- the code comes from the sleeve the startup designed (design.scan_code, made in the
-- browser before the campaign exists); it's set once, here, and never changes
create or replace function public.mp_campaigns_scan_code()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.scan_code := null;
  if new.design ->> 'scan_code' ~ '^[a-z0-9]{8}$'
     and not exists (select 1 from public.mp_campaigns where scan_code = new.design ->> 'scan_code') then
    new.scan_code := new.design ->> 'scan_code';
  end if;
  return new;
end;
$$;
create trigger mp_campaigns_scan_code before insert on public.mp_campaigns
  for each row execute function public.mp_campaigns_scan_code();
revoke all on function public.mp_campaigns_scan_code() from public, anon, authenticated;

create table public.mp_scans (
  id          bigint generated always as identity primary key,
  campaign_id uuid not null references public.mp_campaigns (id) on delete cascade,
  at          timestamptz not null default now(),
  visitor     text not null   -- keyed hash of the scanner's connection, for counting unique people; no IP is stored
);
create index mp_scans_campaign_idx on public.mp_scans (campaign_id, at);
alter table public.mp_scans enable row level security;  -- read through mp_my_campaigns / mp_campaign_report only
revoke all on public.mp_scans from anon, authenticated;

-- server only (DIVVIT_VERIFY_SECRET): count a scan and say where to send the scanner.
-- Returns the startup's website ('' if it has none), or null for an unknown code.
create function public.mp_record_scan(p_secret text, p_code text, p_visitor text, p_count boolean default true)
returns text language plpgsql security definer set search_path = '' as $$
declare
  k record;
begin
  if not public.mp_server_ok(p_secret) then raise exception 'not allowed'; end if;
  select c.id, c.status, c.start_date, c.weeks, s.website into k
    from public.mp_campaigns c join public.mp_startups s on s.id = c.startup_id
   where c.scan_code = lower(p_code);
  if not found then return null; end if;
  -- sleeves are out from the start date to the last day; cups linger, so allow a week after
  if p_count and k.status in ('paid', 'active', 'completed') and k.start_date is not null
     and current_date >= k.start_date and current_date < k.start_date + k.weeks * 7 + 7 then
    insert into public.mp_scans (campaign_id, visitor) values (k.id, left(coalesce(p_visitor, ''), 64));
  end if;
  return coalesce(k.website, '');
end;
$$;

-- ---------------------------------------------------------------- what the startup sees

create or replace function public.mp_my_campaigns()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
  from (
    select k.id, k.name, k.status, k.start_date, k.weeks, k.sleeves_per_cafe, k.branded_drink,
           k.total_cents, k.final_cents, k.review_note, k.reviewed_at, k.paid_at,
           k.design, k.design_url, k.created_at, s.name as startup_name, k.roi,
           k.scan_code is not null as has_qr,
           (select count(*) from public.mp_scans v where v.campaign_id = k.id) as scans,
           (select count(distinct v.visitor) from public.mp_scans v where v.campaign_id = k.id) as scanners,
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

-- one campaign's report: the campaign, its cafés and scans per day (the owner, or the Divvit team)
create function public.mp_campaign_report(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  k public.mp_campaigns;
  s public.mp_startups;
  last_day date;
begin
  select * into k from public.mp_campaigns where id = p_campaign;
  if not found or (k.owner_id is distinct from auth.uid() and not public.mp_is_admin()) then return null; end if;
  select * into s from public.mp_startups where id = k.startup_id;
  -- up to today or the last day, plus any scans in the week after it ended
  last_day := greatest(least(current_date, k.start_date + k.weeks * 7 - 1),
                       (select max(v.at)::date from public.mp_scans v where v.campaign_id = k.id));
  return jsonb_build_object(
    'id', k.id, 'name', k.name, 'status', k.status, 'start_date', k.start_date, 'weeks', k.weeks,
    'sleeves_per_cafe', k.sleeves_per_cafe, 'branded_drink', k.branded_drink, 'total_cents', k.total_cents,
    'final_cents', k.final_cents, 'paid_at', k.paid_at, 'design_url', k.design_url, 'roi', k.roi,
    'has_qr', k.scan_code is not null,
    'startup', jsonb_build_object('name', s.name, 'logo_url', s.logo_url, 'website', s.website),
    'scans', (select count(*) from public.mp_scans v where v.campaign_id = k.id),
    'scanners', (select count(distinct v.visitor) from public.mp_scans v where v.campaign_id = k.id),
    'cafes', (select coalesce(jsonb_agg(jsonb_build_object(
                'cafe_name', c.name, 'neighborhood', c.neighborhood, 'city', c.city, 'is_demo', c.is_demo,
                'status', o.status, 'sleeves', o.sleeves) order by c.city, c.name), '[]'::jsonb)
              from public.mp_campaign_cafes o join public.mp_cafes c on c.id = o.cafe_id where o.campaign_id = k.id),
    'daily', case when k.start_date is null or last_day < k.start_date then '[]'::jsonb else (
      select jsonb_agg(jsonb_build_object('day', d.day, 'scans', coalesce(n.scans, 0), 'scanners', coalesce(n.scanners, 0)) order by d.day)
        from (select g::date as day from generate_series(k.start_date, last_day, interval '1 day') g) d
        left join (select v.at::date as day, count(*) as scans, count(distinct v.visitor) as scanners
                     from public.mp_scans v where v.campaign_id = k.id group by 1) n on n.day = d.day
    ) end
  );
end;
$$;
revoke all on function public.mp_campaign_report(uuid) from public, anon;
grant execute on function public.mp_campaign_report(uuid) to authenticated;

-- ---------------------------------------------------------------- finishing campaigns

alter table public.mp_notifications drop constraint mp_notifications_kind_check;
alter table public.mp_notifications add constraint mp_notifications_kind_check
  check (kind in ('campaign_approved', 'campaign_declined', 'campaign_paid', 'offer_new', 'campaign_finished'));
alter table public.mp_outbox drop constraint mp_outbox_kind_check;
alter table public.mp_outbox add constraint mp_outbox_kind_check
  check (kind in ('campaign_submitted', 'campaign_approved', 'campaign_declined', 'campaign_paid', 'offer_new', 'campaign_finished'));

-- live campaigns whose last day has passed → completed, and the startup hears its report is ready
create function public.mp_finish_due_campaigns()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  k record;
  n integer := 0;
begin
  for k in update public.mp_campaigns set status = 'completed'
            where status = 'active' and start_date is not null and start_date + weeks * 7 <= current_date
            returning id, owner_id, name loop
    insert into public.mp_notifications (user_id, kind, title, body, link, campaign_id)
    values (k.owner_id, 'campaign_finished', 'Your campaign report is ready',
            format('“%s” has finished. See how it did.', k.name), '/campaigns/' || k.id || '/report', k.id);
    insert into public.mp_outbox (kind, campaign_id) values ('campaign_finished', k.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.mp_finish_due_campaigns() from public, anon, authenticated;

create extension if not exists pg_cron;
select cron.schedule('mp-finish-campaigns', '5 * * * *', 'select public.mp_finish_due_campaigns()');
