-- A photo on every café card. Owners upload their own café (the public
-- mp-cafe-photos bucket, inside their own folder) and the listing keeps the path.
-- Sample cafés aren't real places, so they show stock café photos from Unsplash
-- (free licence), set here only.

alter table public.mp_cafes
  add column photo text;  -- '<owner id>/<file>' in mp-cafe-photos, or an https URL for a sample café

grant select (photo) on public.mp_cafes to anon, authenticated;

create or replace function public.mp_cafes_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      new.verification_status := 'unverified';
      new.verified_at := null;
      new.nearby := null;
      new.nearby_at := null;
      new.photo := null;
    else
      new.verification_status := old.verification_status;
      new.verified_at := old.verified_at;
      new.nearby := old.nearby;
      new.nearby_at := old.nearby_at;
      -- an owner's photo is a file in their own folder (or none)
      if new.photo is distinct from old.photo and new.photo is not null
         and (new.photo !~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,120}$' or split_part(new.photo, '/', 1) <> auth.uid()::text) then
        new.photo := old.photo;
      end if;
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

-- ---------------------------------------------------------------- storage: café photos

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mp-cafe-photos', 'mp-cafe-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "mp cafe photos: upload to own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'mp-cafe-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
-- removing the old photo when it's replaced needs to see it first
create policy "mp cafe photos: see own" on storage.objects for select to authenticated
  using (bucket_id = 'mp-cafe-photos' and owner_id = (select auth.uid())::text);
create policy "mp cafe photos: update own" on storage.objects for update to authenticated
  using (bucket_id = 'mp-cafe-photos' and owner_id = (select auth.uid())::text);
create policy "mp cafe photos: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'mp-cafe-photos' and owner_id = (select auth.uid())::text);

-- ---------------------------------------------------------------- sample cafés: stock café photos
-- 49 photos. Never twice in one city, and in the default busiest-first list a photo
-- comes round again only after all the others have been used.

do $$
declare
  ids text[] := array[
    '1764489307253-da5c9c311fa2', '1778142375628-73010ebde16a', '1600093463592-8e36ae95ef56', '1554118811-1e0d58224f24',
    '1521017432531-fbd92d768814', '1555396273-367ea4eb4db5', '1514933651103-005eec06c04b', '1780039584176-399d8676f9c8',
    '1538333581680-29dd4752ddf2', '1565650839149-2c48a094196c', '1612192527395-06b72da6b35a', '1544031064-9de80864ade5',
    '1689037676470-b72230d5236e', '1442975631115-c4f7b05b8a2c', '1712730642507-d4ad0904e997', '1755183829407-3b3d2705b7bf',
    '1777478459218-0c32d80787e2', '1764964048064-a48368fe7c3e', '1556742393-d75f468bfcb0', '1768789624860-cca29e59a762',
    '1767519865125-21cd230ae1a9', '1780226038667-48b6739bee12', '1770488141884-24114686f6d1', '1782201205125-20e8bb74c8db',
    '1767201364709-6081f4be46cc', '1766289199031-28e6d3e9ee1d', '1781601920475-6aa0d139d953', '1772993629858-5ca090cf226a',
    '1783125385860-63de72acb0ac', '1784126689734-703773595e52', '1790156591511-c15ce9fe9ebc', '1508766917616-d22f3f1eea14',
    '1599898330165-6c3b93296d60', '1773156191860-e351c137da47', '1777748219930-244cbea607ef', '1776891553292-62bd1ec55932',
    '1777650498261-1d46875e5482', '1770565280764-2f6c17bb3b5e', '1792596619297-2a2e8af1424b', '1765605898632-7e12ccf85b34',
    '1564758866811-4780aa0a1f49', '1564758868631-2d04d7da63f5', '1469631423273-6995642a6a40', '1645677020082-721a854c24f2',
    '1551887196-72e32bfc7bf3', '1542181961-9590d0c79dab', '1527512666523-bb0e4389d842', '1783621444511-9abb20405421',
    '1453614512568-c4024d13c247'
  ];
  last_used integer[] := array_fill(-1, array[49]);
  in_city jsonb := '{}';
  r record;
  i integer := 0;
  best integer;
begin
  for r in select id, city from public.mp_cafes where is_demo order by weekly_cups desc, id loop
    best := null;
    for k in 1 .. 49 loop
      if not coalesce((in_city -> r.city) @> to_jsonb(k), false) and (best is null or last_used[k] < last_used[best]) then best := k; end if;
    end loop;
    if best is null then  -- a city with more than 49 sample cafés: just the least recently used
      best := 1;
      for k in 2 .. 49 loop if last_used[k] < last_used[best] then best := k; end if; end loop;
    end if;
    update public.mp_cafes set photo = 'https://images.unsplash.com/photo-' || ids[best] || '?auto=format&fit=crop&w=720&h=405&q=70' where id = r.id;
    last_used[best] := i;
    i := i + 1;
    in_city := jsonb_set(in_city, array[r.city], coalesce(in_city -> r.city, '[]'::jsonb) || to_jsonb(best));
  end loop;
end;
$$;
