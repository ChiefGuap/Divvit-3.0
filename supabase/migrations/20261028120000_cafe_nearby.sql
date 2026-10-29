-- Concrete places near each café (offices and HQs, colleges and schools, coworking,
-- landmarks) from OpenStreetMap, shown on café cards and used as a filter.
-- Filled by the app server (/api/cafes/nearby, lib/server/nearby.ts); owners can't set it.

alter table public.mp_cafes
  add column nearby jsonb,          -- [{ name, kind: office|school|startup|landmark, m }], closest first
  add column nearby_at timestamptz;

create or replace function public.mp_cafes_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      new.verification_status := 'unverified';
      new.verified_at := null;
      new.nearby := null;
      new.nearby_at := null;
    else
      new.verification_status := old.verification_status;
      new.verified_at := old.verified_at;
      new.nearby := old.nearby;
      new.nearby_at := old.nearby_at;
      if new.osm_ref is distinct from old.osm_ref
         or lower(btrim(new.name)) <> lower(btrim(old.name))
         or abs(coalesce(new.lat, 0) - coalesce(old.lat, 0)) > 0.002
         or abs(coalesce(new.lng, 0) - coalesce(old.lng, 0)) > 0.0025 then
        new.verification_status := 'unverified';
        new.verified_at := null;
      end if;
    end if;
  end if;
  -- a café that moved needs its neighbours looked up again
  if tg_op = 'UPDATE' and (abs(coalesce(new.lat, 0) - coalesce(old.lat, 0)) > 0.0005 or abs(coalesce(new.lng, 0) - coalesce(old.lng, 0)) > 0.0005) then
    new.nearby := null;
    new.nearby_at := null;
  end if;
  return new;
end;
$$;

-- server only (DIVVIT_VERIFY_SECRET): cafés still to look up, and saving what was found
create function public.mp_cafes_missing_nearby(p_secret text, p_limit integer default 20)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.mp_server_ok(p_secret) then raise exception 'not allowed'; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'city', c.city, 'lat', c.lat, 'lng', c.lng)), '[]'::jsonb)
    from (select * from public.mp_cafes where nearby is null and lat is not null and lng is not null
          order by created_at limit greatest(1, least(p_limit, 500))) c
  );
end;
$$;

create function public.mp_set_cafe_nearby(p_secret text, p_cafe uuid, p_nearby jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.mp_server_ok(p_secret) then raise exception 'not allowed'; end if;
  if jsonb_typeof(p_nearby) <> 'array' then raise exception 'nearby must be a list'; end if;
  update public.mp_cafes set nearby = p_nearby, nearby_at = now() where id = p_cafe;
end;
$$;

revoke execute on function public.mp_cafes_missing_nearby(text, integer) from public;
revoke execute on function public.mp_set_cafe_nearby(text, uuid, jsonb) from public;
grant execute on function public.mp_cafes_missing_nearby(text, integer) to anon, authenticated;
grant execute on function public.mp_set_cafe_nearby(text, uuid, jsonb) to anon, authenticated;
