-- Startup home: saved cafés, and a team email for every new campaign.
--
-- mp_saved_cafes  a startup's bookmarked cafés ("Saved" on the home page)
-- mp_outbox       one row per email the team should get. A trigger queues a
--                 row the moment a campaign is created, so a notification
--                 can't be skipped by a client that closes the tab; the app
--                 server sends pending rows (POST /api/campaigns/notify) and
--                 marks them done. The server proves itself with the same
--                 shared secret as website verification (mp_private.settings
--                 'verify_secret' = DIVVIT_VERIFY_SECRET).

create table if not exists public.mp_saved_cafes (
  owner_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  cafe_id    uuid not null references public.mp_cafes (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, cafe_id)
);
alter table public.mp_saved_cafes enable row level security;
drop policy if exists "mp_saved_cafes: own" on public.mp_saved_cafes;
create policy "mp_saved_cafes: own" on public.mp_saved_cafes for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
revoke all on public.mp_saved_cafes from anon;
grant select, insert, delete on public.mp_saved_cafes to authenticated;

create table if not exists public.mp_outbox (
  id          bigint generated always as identity primary key,
  kind        text not null check (kind in ('campaign_submitted')),
  campaign_id uuid references public.mp_campaigns (id) on delete cascade,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  attempts    integer not null default 0,
  last_error  text
);
alter table public.mp_outbox enable row level security;
revoke all on public.mp_outbox from anon, authenticated;

create or replace function public.mp_queue_campaign_email()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.mp_outbox (kind, campaign_id) values ('campaign_submitted', new.id);
  return new;
end;
$$;
drop trigger if exists mp_campaigns_email on public.mp_campaigns;
create trigger mp_campaigns_email after insert on public.mp_campaigns
  for each row execute function public.mp_queue_campaign_email();
revoke all on function public.mp_queue_campaign_email() from public, anon, authenticated;

create or replace function public.mp_server_ok(p_secret text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(p_secret, '') <> '' and exists (
    select 1 from mp_private.settings where key = 'verify_secret' and value = p_secret)
$$;
revoke all on function public.mp_server_ok(text) from public, anon, authenticated;

-- pending emails with everything the message needs
create or replace function public.mp_outbox_pending(p_secret text)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.mp_server_ok(p_secret) then raise exception 'not allowed'; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', o.id, 'kind', o.kind, 'attempts', o.attempts,
      'campaign', jsonb_build_object('id', k.id, 'name', k.name, 'start_date', k.start_date, 'weeks', k.weeks,
        'sleeves_per_cafe', k.sleeves_per_cafe, 'branded_drink', k.branded_drink, 'total_cents', k.total_cents,
        'design_url', k.design_url, 'created_at', k.created_at),
      'startup', jsonb_build_object('name', s.name, 'website', s.website, 'category', s.category, 'hq', s.hq,
        'description', s.description, 'linkedin_url', s.linkedin_url),
      'owner', jsonb_build_object('email', u.email, 'name', p.full_name),
      'cafes', (select coalesce(jsonb_agg(jsonb_build_object('name', c.name, 'neighborhood', c.neighborhood, 'city', c.city,
                  'sleeves', cc.sleeves, 'demo', c.is_demo) order by c.city, c.name), '[]'::jsonb)
                from public.mp_campaign_cafes cc join public.mp_cafes c on c.id = cc.cafe_id where cc.campaign_id = k.id)
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

create or replace function public.mp_outbox_done(p_secret text, p_id bigint, p_error text default null)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.mp_server_ok(p_secret) then raise exception 'not allowed'; end if;
  if p_error is null then
    update public.mp_outbox set sent_at = now(), last_error = null where id = p_id;
  else
    update public.mp_outbox set attempts = attempts + 1, last_error = left(p_error, 500) where id = p_id;
  end if;
end;
$$;

revoke all on function public.mp_outbox_pending(text) from public;
revoke all on function public.mp_outbox_done(text, bigint, text) from public;
grant execute on function public.mp_outbox_pending(text) to anon, authenticated;
grant execute on function public.mp_outbox_done(text, bigint, text) to anon, authenticated;
