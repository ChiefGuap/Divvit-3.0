-- The team's contact address is elliott@divvit.app: point the "already verified" message at it.

create or replace function public.mp_mark_verified(p_cafe uuid, p_by uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  ref text;
begin
  select osm_ref into ref from public.mp_cafes where id = p_cafe;
  if ref is not null and exists (
    select 1 from public.mp_cafes where osm_ref = ref and verification_status = 'verified' and id <> p_cafe
  ) then
    raise exception 'another account has already verified this café — email elliott@divvit.app';
  end if;
  update public.mp_cafes set verification_status = 'verified', verified_at = now() where id = p_cafe;
  update public.mp_cafe_verifications set decided_at = now(), decided_by = p_by, note = null where cafe_id = p_cafe;
end;
$$;
