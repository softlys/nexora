-- Stage 1 hardening (audit NX-007): rate limits and the bulk-read detector shared by every server
-- instance. In-memory counters only work with a single process; serverless hosts run many.

create table private.rate_counters (
  id text primary key check (char_length(id) <= 200),
  window_start timestamptz not null,
  count bigint not null
);

-- Adds `amount` to a fixed-window counter and returns the new count and the window start.
-- Called by the server with the service role only.
create function public.hit_counter(p_id text, p_window_seconds integer, p_amount integer)
returns table (count bigint, window_start timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if random() < 0.01 then
    delete from private.rate_counters where private.rate_counters.window_start < now() - interval '1 day';
  end if;
  return query
  insert into private.rate_counters as c (id, window_start, count)
  values (p_id, now(), p_amount)
  on conflict (id) do update set
    count = case when c.window_start <= now() - make_interval(secs => p_window_seconds) then p_amount else c.count + p_amount end,
    window_start = case when c.window_start <= now() - make_interval(secs => p_window_seconds) then now() else c.window_start end
  returning c.count, c.window_start;
end;
$$;

revoke execute on function public.hit_counter(text, integer, integer) from public, anon, authenticated;
grant execute on function public.hit_counter(text, integer, integer) to service_role;
