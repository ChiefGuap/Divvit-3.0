-- Campaign days follow US Pacific time rather than UTC: a campaign doesn't end (and an
-- evening scan in San Francisco doesn't land on the next day) before the day is over
-- anywhere in the US. Daytime scans on the East Coast fall on the same date either way.

create or replace function public.mp_campaign_today()
returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'America/Los_Angeles')::date
$$;

create or replace function public.mp_record_scan(p_secret text, p_code text, p_visitor text, p_count boolean default true)
returns text language plpgsql security definer set search_path = '' as $$
declare
  k record;
  today date := public.mp_campaign_today();
begin
  if not public.mp_server_ok(p_secret) then raise exception 'not allowed'; end if;
  select c.id, c.status, c.start_date, c.weeks, s.website into k
    from public.mp_campaigns c join public.mp_startups s on s.id = c.startup_id
   where c.scan_code = lower(p_code);
  if not found then return null; end if;
  -- sleeves are out from the start date to the last day; cups linger, so allow a week after
  if p_count and k.status in ('paid', 'active', 'completed') and k.start_date is not null
     and today >= k.start_date and today < k.start_date + k.weeks * 7 + 7 then
    insert into public.mp_scans (campaign_id, visitor) values (k.id, left(coalesce(p_visitor, ''), 64));
  end if;
  return coalesce(k.website, '');
end;
$$;

create or replace function public.mp_campaign_report(p_campaign uuid)
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
  last_day := greatest(least(public.mp_campaign_today(), k.start_date + k.weeks * 7 - 1),
                       (select max((v.at at time zone 'America/Los_Angeles')::date) from public.mp_scans v where v.campaign_id = k.id));
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
        left join (select (v.at at time zone 'America/Los_Angeles')::date as day, count(*) as scans, count(distinct v.visitor) as scanners
                     from public.mp_scans v where v.campaign_id = k.id group by 1) n on n.day = d.day
    ) end
  );
end;
$$;

create or replace function public.mp_finish_due_campaigns()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  k record;
  n integer := 0;
begin
  for k in update public.mp_campaigns set status = 'completed'
            where status = 'active' and start_date is not null and start_date + weeks * 7 <= public.mp_campaign_today()
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
