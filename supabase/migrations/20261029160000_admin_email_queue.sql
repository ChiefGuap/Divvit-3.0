-- The team's view of the email queue (admin → Emails): how much is waiting, what went
-- out today, and anything Resend refused, with its error.

create or replace function public.mp_admin_email_queue()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.mp_is_admin() then raise exception 'admins only'; end if;
  return jsonb_build_object(
    'waiting', (select count(*) from public.mp_outbox where sent_at is null and attempts < 5),
    'sent_today', (select count(*) from public.mp_outbox where sent_at > now() - interval '24 hours'),
    'gave_up', (select count(*) from public.mp_outbox where sent_at is null and attempts >= 5),
    'failing', (select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'attempts', attempts, 'error', last_error, 'created_at', created_at) order by id desc), '[]'::jsonb)
                  from (select * from public.mp_outbox where sent_at is null and attempts > 0 order by id desc limit 20) f)
  );
end;
$$;
revoke all on function public.mp_admin_email_queue() from public, anon;
grant execute on function public.mp_admin_email_queue() to authenticated;
