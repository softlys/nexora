-- Stage 1 hardening (audit NX-003).
--
-- The security log is written only by the server through the service role (some events have no
-- session: failed sign-ins, cron). Signed-in users must not append to it directly through the
-- Supabase REST API, where they could forge events or take sequence numbers and block real ones.

drop policy if exists "members append security events" on public.security_events;
revoke insert on public.security_events from authenticated, anon;
