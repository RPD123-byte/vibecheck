create table public.llm_inference_job_types (
  name text primary key,
  description text,
  constraint llm_inference_job_types_name_format_check
    check (name ~ '^[a-z][a-z0-9_]{0,62}$'),
  constraint llm_inference_job_types_description_length_check
    check (description is null or char_length(description) <= 512)
);

insert into public.llm_inference_job_types (name, description)
values (
  'valence_arousal_label',
  'Estimate typed valence and arousal labels for one target image from labeled anchors.'
);

create table public.llm_inference_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  job_type text not null references public.llm_inference_job_types (name),
  definition_version integer not null,
  semantic_idempotency_key text not null,
  status text not null default 'queued',
  input jsonb not null,
  output jsonb,
  error_message text,
  trigger_run_id text,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint llm_inference_jobs_definition_version_check
    check (definition_version > 0),
  constraint llm_inference_jobs_semantic_key_format_check
    check (semantic_idempotency_key ~ '^[0-9a-f]{64}$'),
  constraint llm_inference_jobs_semantic_key_unique
    unique (semantic_idempotency_key),
  constraint llm_inference_jobs_status_check
    check (status in ('queued', 'running', 'completed', 'failed')),
  constraint llm_inference_jobs_error_length_check
    check (
      error_message is null
      or char_length(btrim(error_message)) between 1 and 2048
    ),
  constraint llm_inference_jobs_trigger_run_id_check
    check (
      trigger_run_id is null
      or (
        char_length(btrim(trigger_run_id)) between 1 and 512
        and trigger_run_id = btrim(trigger_run_id)
      )
    ),
  constraint llm_inference_jobs_state_shape_check
    check (
      (
        status = 'queued'
        and output is null
        and error_message is null
      )
      or (
        status = 'running'
        and output is null
        and error_message is null
      )
      or (
        status = 'completed'
        and output is not null
        and error_message is null
      )
      or (
        status = 'failed'
        and output is null
        and error_message is not null
      )
    )
);

create unique index llm_inference_jobs_trigger_run_id_unique
  on public.llm_inference_jobs (trigger_run_id)
  where trigger_run_id is not null;

create index llm_inference_jobs_user_created_at_idx
  on public.llm_inference_jobs (user_id, created_at desc)
  where user_id is not null;

create function public.set_llm_inference_job_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if
    new.trigger_run_id is distinct from old.trigger_run_id
    and row(
      new.id,
      new.user_id,
      new.job_type,
      new.definition_version,
      new.semantic_idempotency_key,
      new.status,
      new.input,
      new.output,
      new.error_message,
      new.created_at
    ) is not distinct from row(
      old.id,
      old.user_id,
      old.job_type,
      old.definition_version,
      old.semantic_idempotency_key,
      old.status,
      old.input,
      old.output,
      old.error_message,
      old.created_at
    )
  then
    -- Correlation must not invalidate an active executor's optimistic claim.
    new.updated_at := old.updated_at;
  else
    new.updated_at := greatest(
      pg_catalog.clock_timestamp(),
      old.updated_at + interval '1 microsecond'
    );
  end if;
  return new;
end;
$$;

create trigger set_llm_inference_job_updated_at
before update on public.llm_inference_jobs
for each row
execute function public.set_llm_inference_job_updated_at();

create function public.create_or_get_llm_inference_job(
  p_job_type text,
  p_definition_version integer,
  p_semantic_idempotency_key text,
  p_input jsonb,
  p_user_id uuid default null
)
returns table (
  was_created boolean,
  id uuid,
  user_id uuid,
  job_type text,
  definition_version integer,
  semantic_idempotency_key text,
  status text,
  input jsonb,
  output jsonb,
  error_message text,
  trigger_run_id text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.llm_inference_jobs%rowtype;
begin
  insert into public.llm_inference_jobs (
    user_id,
    job_type,
    definition_version,
    semantic_idempotency_key,
    input
  )
  values (
    p_user_id,
    p_job_type,
    p_definition_version,
    p_semantic_idempotency_key,
    p_input
  )
  on conflict on constraint llm_inference_jobs_semantic_key_unique do nothing
  returning * into v_job;

  if found then
    return query
    select
      true,
      v_job.id,
      v_job.user_id,
      v_job.job_type,
      v_job.definition_version,
      v_job.semantic_idempotency_key,
      v_job.status,
      v_job.input,
      v_job.output,
      v_job.error_message,
      v_job.trigger_run_id,
      v_job.created_at,
      v_job.updated_at;
    return;
  end if;

  select jobs.*
  into strict v_job
  from public.llm_inference_jobs as jobs
  where jobs.semantic_idempotency_key = p_semantic_idempotency_key;

  if
    v_job.job_type <> p_job_type
    or v_job.definition_version <> p_definition_version
  then
    raise exception using
      errcode = '22023',
      message = 'Semantic idempotency key belongs to a different inference definition';
  end if;

  return query
  select
    false,
    v_job.id,
    v_job.user_id,
    v_job.job_type,
    v_job.definition_version,
    v_job.semantic_idempotency_key,
    v_job.status,
    v_job.input,
    v_job.output,
    v_job.error_message,
    v_job.trigger_run_id,
    v_job.created_at,
    v_job.updated_at;
end;
$$;

create function public.requeue_failed_llm_inference_job(
  p_job_id uuid,
  p_input jsonb
)
returns setof public.llm_inference_jobs
language sql
security definer
set search_path = ''
as $$
  update public.llm_inference_jobs
  set
    status = 'queued',
    input = p_input,
    output = null,
    error_message = null,
    trigger_run_id = null
  where id = p_job_id
    and status = 'failed'
  returning *;
$$;

create function public.claim_llm_inference_job(p_job_id uuid)
returns setof public.llm_inference_jobs
language sql
security definer
set search_path = ''
as $$
  update public.llm_inference_jobs
  set
    status = 'running',
    output = null,
    error_message = null
  where id = p_job_id
    and status in ('queued', 'failed')
  returning *;
$$;

create function public.complete_llm_inference_job(
  p_job_id uuid,
  p_claimed_updated_at timestamptz,
  p_output jsonb
)
returns setof public.llm_inference_jobs
language sql
security definer
set search_path = ''
as $$
  update public.llm_inference_jobs
  set
    status = 'completed',
    output = p_output,
    error_message = null
  where id = p_job_id
    and status = 'running'
    and updated_at = p_claimed_updated_at
  returning *;
$$;

create function public.fail_llm_inference_job(
  p_job_id uuid,
  p_error_message text,
  p_claimed_updated_at timestamptz default null
)
returns setof public.llm_inference_jobs
language sql
security definer
set search_path = ''
as $$
  update public.llm_inference_jobs
  set
    status = 'failed',
    output = null,
    error_message = left(
      coalesce(nullif(btrim(p_error_message), ''), 'Unknown inference failure'),
      2048
    )
  where id = p_job_id
    and (
      (
        p_claimed_updated_at is not null
        and status = 'running'
        and updated_at = p_claimed_updated_at
      )
      or (
        p_claimed_updated_at is null
        and status = 'queued'
        and trigger_run_id is null
      )
    )
  returning *;
$$;

create function public.attach_llm_inference_trigger_run(
  p_job_id uuid,
  p_trigger_run_id text
)
returns setof public.llm_inference_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.llm_inference_jobs%rowtype;
begin
  select jobs.*
  into v_job
  from public.llm_inference_jobs as jobs
  where jobs.id = p_job_id
  for update;

  if not found then
    return;
  end if;

  if v_job.trigger_run_id = p_trigger_run_id then
    return next v_job;
    return;
  end if;

  if v_job.trigger_run_id is not null then
    return;
  end if;

  update public.llm_inference_jobs
  set trigger_run_id = p_trigger_run_id
  where public.llm_inference_jobs.id = p_job_id
  returning * into v_job;

  return next v_job;
end;
$$;

alter table public.llm_inference_job_types enable row level security;
alter table public.llm_inference_jobs enable row level security;

revoke all on table public.llm_inference_job_types from public, anon, authenticated, service_role;
revoke all on table public.llm_inference_jobs from public, anon, authenticated, service_role;

grant select on table public.llm_inference_job_types to service_role;
grant select on table public.llm_inference_jobs to service_role;

revoke execute on function public.set_llm_inference_job_updated_at() from public, anon, authenticated;
revoke execute on function public.create_or_get_llm_inference_job(text, integer, text, jsonb, uuid) from public, anon, authenticated;
revoke execute on function public.requeue_failed_llm_inference_job(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.claim_llm_inference_job(uuid) from public, anon, authenticated;
revoke execute on function public.complete_llm_inference_job(uuid, timestamptz, jsonb) from public, anon, authenticated;
revoke execute on function public.fail_llm_inference_job(uuid, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.attach_llm_inference_trigger_run(uuid, text) from public, anon, authenticated;

grant execute on function public.create_or_get_llm_inference_job(text, integer, text, jsonb, uuid) to service_role;
grant execute on function public.requeue_failed_llm_inference_job(uuid, jsonb) to service_role;
grant execute on function public.claim_llm_inference_job(uuid) to service_role;
grant execute on function public.complete_llm_inference_job(uuid, timestamptz, jsonb) to service_role;
grant execute on function public.fail_llm_inference_job(uuid, text, timestamptz) to service_role;
grant execute on function public.attach_llm_inference_trigger_run(uuid, text) to service_role;
