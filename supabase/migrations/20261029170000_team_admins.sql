-- The Divvit team: raquib@divvit.app and elliott@divvit.app are admins. Anyone listed in
-- mp_private.settings 'admin_emails' is an admin once they've signed up AND confirmed
-- that email (so the address alone isn't enough: you need its mailbox), alongside
-- whoever is in mp_admins.

insert into mp_private.settings (key, value) values ('admin_emails', 'raquib@divvit.app,elliott@divvit.app')
on conflict (key) do update set value = excluded.value;

create or replace function public.mp_is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.mp_admins where user_id = auth.uid())
      or exists (
        select 1 from auth.users u, mp_private.settings s
         where u.id = auth.uid() and u.email_confirmed_at is not null and s.key = 'admin_emails'
           and lower(u.email) = any (string_to_array(lower(replace(s.value, ' ', '')), ','))
      )
$$;
