-- Several sales pipelines (wholesale, retail, tenders…). Every stage belongs to one pipeline; each
-- pipeline has exactly one won and one lost stage. Existing stages move into a default "Sales" pipeline.

create table public.pipelines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  position integer not null default 0 check (position between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, organization_id)
);
create unique index pipelines_name_unique on public.pipelines (organization_id, lower(name)) where archived_at is null;

insert into public.pipelines (organization_id, name, position)
select id, 'Sales', 0 from public.organizations;

alter table public.pipeline_stages add column pipeline_id uuid;
update public.pipeline_stages s set pipeline_id = p.id from public.pipelines p where p.organization_id = s.organization_id;
alter table public.pipeline_stages alter column pipeline_id set not null;
alter table public.pipeline_stages
  add constraint pipeline_stages_pipeline_fk foreign key (pipeline_id, organization_id) references public.pipelines (id, organization_id) on delete cascade;

-- Positions and names are unique within a pipeline, not across the organization.
alter table public.pipeline_stages drop constraint pipeline_stages_position_unique;
alter table public.pipeline_stages add constraint pipeline_stages_position_unique unique (pipeline_id, position) deferrable initially deferred;
drop index public.pipeline_stages_name_unique;
create unique index pipeline_stages_name_unique on public.pipeline_stages (pipeline_id, lower(name));

alter table public.pipelines enable row level security;
create policy "members read pipelines" on public.pipelines
  for select to authenticated using (organization_id = private.current_org_id());
-- Pipeline writes go through the admin-only functions below.
revoke insert, update, delete on public.pipelines from authenticated, anon;

-- ---------------------------------------------------------------------------
-- Admin functions, now per pipeline
-- ---------------------------------------------------------------------------

drop function public.create_pipeline_stage(text, integer, boolean, boolean);
drop function public.reorder_pipeline_stages(uuid[]);
drop function private.assert_terminal_stages(uuid);

create function private.assert_terminal_stages(target_pipeline uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.pipeline_stages where pipeline_id = target_pipeline and is_won) <> 1
     or (select count(*) from public.pipeline_stages where pipeline_id = target_pipeline and is_lost) <> 1 then
    raise exception 'terminal_stage' using errcode = 'P0001';
  end if;
end;
$$;

create function private.org_pipeline(target_pipeline uuid)
returns uuid
language sql
stable
set search_path = ''
as $$
  select id from public.pipelines where id = target_pipeline and organization_id = private.current_org_id() and archived_at is null;
$$;

create function public.create_pipeline_stage(target_pipeline uuid, stage_name text, stage_probability integer, stage_is_won boolean, stage_is_lost boolean)
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
  if private.org_pipeline(target_pipeline) is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  set constraints public.pipeline_stages_position_unique deferred;

  -- New open stages go before the won/lost stages; terminal stages go last.
  if stage_is_won or stage_is_lost then
    select count(*) into insert_at from public.pipeline_stages where pipeline_id = target_pipeline;
  else
    select coalesce(
      (select min(position) from public.pipeline_stages where pipeline_id = target_pipeline and (is_won or is_lost)),
      (select count(*) from public.pipeline_stages where pipeline_id = target_pipeline)
    ) into insert_at;
  end if;

  update public.pipeline_stages set position = position + 1 where pipeline_id = target_pipeline and position >= insert_at;
  insert into public.pipeline_stages (organization_id, pipeline_id, name, position, probability, is_won, is_lost)
  values (org, target_pipeline, stage_name, insert_at, stage_probability, stage_is_won, stage_is_lost)
  returning * into created;

  perform private.assert_terminal_stages(target_pipeline);
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
  set name = stage_name, probability = stage_probability, is_won = stage_is_won, is_lost = stage_is_lost, updated_at = now()
  where id = stage_id and organization_id = org
  returning * into updated;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  perform private.assert_terminal_stages(updated.pipeline_id);
  return updated;
end;
$$;

create function public.reorder_pipeline_stages(target_pipeline uuid, ordered_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  total integer;
begin
  if not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if private.org_pipeline(target_pipeline) is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select count(*) into total from public.pipeline_stages where pipeline_id = target_pipeline;
  if total <> cardinality(ordered_ids)
     or total <> (select count(distinct x) from unnest(ordered_ids) x)
     or total <> (select count(*) from public.pipeline_stages where pipeline_id = target_pipeline and id = any (ordered_ids)) then
    raise exception 'invalid_order' using errcode = '22023';
  end if;

  set constraints public.pipeline_stages_position_unique deferred;
  update public.pipeline_stages s
  set position = o.ord - 1, updated_at = now()
  from unnest(ordered_ids) with ordinality as o(id, ord)
  where s.id = o.id and s.pipeline_id = target_pipeline;
end;
$$;

-- stages: [{ "name": "…", "probability": 10, "is_won": false, "is_lost": false }, …]
create function public.create_pipeline(pipeline_name text, stages jsonb)
returns public.pipelines
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := private.current_org_id();
  created public.pipelines;
  s jsonb;
  pos integer := 0;
begin
  if not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into public.pipelines (organization_id, name, position)
  values (org, pipeline_name, (select coalesce(max(position) + 1, 0) from public.pipelines where organization_id = org and archived_at is null))
  returning * into created;
  -- Open stages first, then won, then lost.
  for s in
    select value from jsonb_array_elements(stages)
    order by (value ->> 'is_lost')::boolean, (value ->> 'is_won')::boolean
  loop
    insert into public.pipeline_stages (organization_id, pipeline_id, name, position, probability, is_won, is_lost)
    values (org, created.id, s ->> 'name', pos, (s ->> 'probability')::integer, (s ->> 'is_won')::boolean, (s ->> 'is_lost')::boolean);
    pos := pos + 1;
  end loop;
  perform private.assert_terminal_stages(created.id);
  return created;
end;
$$;

create function public.rename_pipeline(target_pipeline uuid, pipeline_name text)
returns public.pipelines
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated public.pipelines;
begin
  if not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.pipelines set name = pipeline_name, updated_at = now()
  where id = target_pipeline and organization_id = private.current_org_id() and archived_at is null
  returning * into updated;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return updated;
end;
$$;

create function public.delete_pipeline(target_pipeline uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := private.current_org_id();
begin
  if not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if private.org_pipeline(target_pipeline) is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if (select count(*) from public.pipelines where organization_id = org and archived_at is null) = 1 then
    raise exception 'last_pipeline' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.deals d join public.pipeline_stages s on s.id = d.stage_id where s.pipeline_id = target_pipeline) then
    raise exception 'pipeline_has_deals' using errcode = 'P0001';
  end if;
  delete from public.pipelines where id = target_pipeline and organization_id = org;
end;
$$;

revoke execute on function public.create_pipeline_stage(uuid, text, integer, boolean, boolean) from public, anon;
revoke execute on function public.reorder_pipeline_stages(uuid, uuid[]) from public, anon;
revoke execute on function public.create_pipeline(text, jsonb) from public, anon;
revoke execute on function public.rename_pipeline(uuid, text) from public, anon;
revoke execute on function public.delete_pipeline(uuid) from public, anon;
grant execute on function public.create_pipeline_stage(uuid, text, integer, boolean, boolean) to authenticated;
grant execute on function public.reorder_pipeline_stages(uuid, uuid[]) to authenticated;
grant execute on function public.create_pipeline(text, jsonb) to authenticated;
grant execute on function public.rename_pipeline(uuid, text) to authenticated;
grant execute on function public.delete_pipeline(uuid) to authenticated;
revoke execute on function private.assert_terminal_stages(uuid) from public;
revoke execute on function private.org_pipeline(uuid) from public;
