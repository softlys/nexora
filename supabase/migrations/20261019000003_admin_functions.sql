-- Admin operations that must check multi-row invariants atomically.
-- They run as SECURITY DEFINER, verify the caller's role and organization themselves,
-- and raise named errors the application maps to user-facing messages.

create or replace function public.change_profile_role(target_profile_id uuid, new_role text)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := private.current_org_id();
  target public.profiles;
  remaining_admins integer;
begin
  if not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if new_role not in ('admin', 'manager', 'sales_rep') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;

  select * into target from public.profiles
  where id = target_profile_id and organization_id = org and archived_at is null
  for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if target.role = 'admin' and new_role <> 'admin' then
    select count(*) into remaining_admins from public.profiles
    where organization_id = org and role = 'admin' and is_active and archived_at is null and id <> target.id;
    if remaining_admins = 0 then
      raise exception 'last_admin' using errcode = 'P0001';
    end if;
  end if;

  update public.profiles set role = new_role where id = target.id returning * into target;
  return target;
end;
$$;

create or replace function private.assert_terminal_stages(org uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.pipeline_stages where organization_id = org and is_won) <> 1
     or (select count(*) from public.pipeline_stages where organization_id = org and is_lost) <> 1 then
    raise exception 'terminal_stage' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.create_pipeline_stage(stage_name text, stage_probability integer, stage_is_won boolean, stage_is_lost boolean)
returns public.pipeline_stages
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := private.current_org_id();
  insert_at integer;
  created public.pipeline_stages;
begin
  if not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  set constraints public.pipeline_stages_position_unique deferred;

  -- New open stages go before the won/lost stages; terminal stages go last.
  if stage_is_won or stage_is_lost then
    select count(*) into insert_at from public.pipeline_stages where organization_id = org;
  else
    select coalesce(
      (select min(position) from public.pipeline_stages where organization_id = org and (is_won or is_lost)),
      (select count(*) from public.pipeline_stages where organization_id = org)
    ) into insert_at;
  end if;

  update public.pipeline_stages set position = position + 1 where organization_id = org and position >= insert_at;
  insert into public.pipeline_stages (organization_id, name, position, probability, is_won, is_lost)
  values (org, stage_name, insert_at, stage_probability, stage_is_won, stage_is_lost)
  returning * into created;

  perform private.assert_terminal_stages(org);
  return created;
end;
$$;

create or replace function public.update_pipeline_stage(stage_id uuid, stage_name text, stage_probability integer, stage_is_won boolean, stage_is_lost boolean)
returns public.pipeline_stages
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := private.current_org_id();
  updated public.pipeline_stages;
begin
  if not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.pipeline_stages
  set name = stage_name, probability = stage_probability, is_won = stage_is_won, is_lost = stage_is_lost
  where id = stage_id and organization_id = org
  returning * into updated;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  perform private.assert_terminal_stages(org);
  return updated;
end;
$$;

create or replace function public.reorder_pipeline_stages(ordered_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := private.current_org_id();
  total integer;
begin
  if not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select count(*) into total from public.pipeline_stages where organization_id = org;
  if total <> cardinality(ordered_ids)
     or total <> (select count(distinct x) from unnest(ordered_ids) x)
     or total <> (select count(*) from public.pipeline_stages where organization_id = org and id = any (ordered_ids)) then
    raise exception 'invalid_order' using errcode = '22023';
  end if;

  set constraints public.pipeline_stages_position_unique deferred;
  update public.pipeline_stages s
  set position = o.ord - 1
  from unnest(ordered_ids) with ordinality as o(id, ord)
  where s.id = o.id and s.organization_id = org;
end;
$$;

revoke execute on function public.change_profile_role(uuid, text) from public, anon;
revoke execute on function public.create_pipeline_stage(text, integer, boolean, boolean) from public, anon;
revoke execute on function public.update_pipeline_stage(uuid, text, integer, boolean, boolean) from public, anon;
revoke execute on function public.reorder_pipeline_stages(uuid[]) from public, anon;
grant execute on function public.change_profile_role(uuid, text) to authenticated;
grant execute on function public.create_pipeline_stage(text, integer, boolean, boolean) to authenticated;
grant execute on function public.update_pipeline_stage(uuid, text, integer, boolean, boolean) to authenticated;
grant execute on function public.reorder_pipeline_stages(uuid[]) to authenticated;
revoke execute on function private.assert_terminal_stages(uuid) from public;
