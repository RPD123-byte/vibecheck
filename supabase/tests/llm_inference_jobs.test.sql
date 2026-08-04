begin;

select plan(18);

create function pg_temp.raises_sqlstate(statement text, expected text)
returns boolean
language plpgsql
as $$
begin
  execute statement;
  return false;
exception when others then
  return sqlstate = expected;
end;
$$;

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_tables
    where schemaname = 'public'
      and tablename like 'llm_inference_%'
  ),
  2,
  'migration creates exactly two LLM governance tables'
);

select results_eq(
  $$select name from public.llm_inference_job_types order by name$$,
  $$values ('valence_arousal_label'::text)$$,
  'initial registered job type is seeded'
);

select is(
  (
    select count(*)::integer
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'llm_inference_jobs'
      and column_name in (
        'attempt',
        'claim_token',
        'input_tokens',
        'output_tokens',
        'cost_usd',
        'latency_ms',
        'started_at',
        'completed_at'
      )
  ),
  0,
  'job rows contain no attempt or router telemetry columns'
);

select is(
  (
    select relrowsecurity
    from pg_catalog.pg_class
    where oid = 'public.llm_inference_jobs'::regclass
  ),
  true,
  'row-level security is enabled'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'llm_inference_jobs'
  ),
  0,
  'no browser RLS policy exists'
);

select ok(
  not has_table_privilege('anon', 'public.llm_inference_jobs', 'select'),
  'anonymous role cannot read jobs'
);

select ok(
  has_table_privilege('service_role', 'public.llm_inference_jobs', 'select'),
  'service role can read jobs'
);

select ok(
  not has_table_privilege('service_role', 'public.llm_inference_jobs', 'insert'),
  'service role cannot bypass lifecycle functions with direct inserts'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.create_or_get_llm_inference_job(text,integer,text,jsonb,uuid)',
    'execute'
  ),
  'anonymous role cannot invoke lifecycle functions'
);

insert into public.llm_inference_jobs (
  id,
  job_type,
  definition_version,
  semantic_idempotency_key,
  input
)
values (
  '00000000-0000-0000-0000-000000000001',
  'valence_arousal_label',
  1,
  repeat('a', 64),
  '{"valid":true}'::jsonb
);

select ok(
  exists (
    select 1
    from public.llm_inference_jobs
    where id = '00000000-0000-0000-0000-000000000001'
      and status = 'queued'
  ),
  'a minimal queued job is valid'
);

select ok(
  pg_temp.raises_sqlstate(
    $$insert into public.llm_inference_jobs
      (job_type, definition_version, semantic_idempotency_key, input)
      values ('unknown_type', 1, repeat('b', 64), '{}'::jsonb)$$,
    '23503'
  ),
  'unknown job types violate the foreign key'
);

select ok(
  pg_temp.raises_sqlstate(
    $$insert into public.llm_inference_jobs
      (job_type, definition_version, semantic_idempotency_key, input)
      values ('valence_arousal_label', 0, repeat('c', 64), '{}'::jsonb)$$,
    '23514'
  ),
  'definition versions must be positive'
);

select ok(
  pg_temp.raises_sqlstate(
    $$insert into public.llm_inference_jobs
      (job_type, definition_version, semantic_idempotency_key, input)
      values ('valence_arousal_label', 1, 'not-a-digest', '{}'::jsonb)$$,
    '23514'
  ),
  'semantic keys must be lowercase SHA-256 digests'
);

select ok(
  pg_temp.raises_sqlstate(
    $$insert into public.llm_inference_jobs
      (job_type, definition_version, semantic_idempotency_key, status, input)
      values ('valence_arousal_label', 1, repeat('d', 64), 'unknown', '{}'::jsonb)$$,
    '23514'
  ),
  'status values are constrained'
);

select ok(
  pg_temp.raises_sqlstate(
    $$insert into public.llm_inference_jobs
      (job_type, definition_version, semantic_idempotency_key, status, input)
      values ('valence_arousal_label', 1, repeat('e', 64), 'completed', '{}'::jsonb)$$,
    '23514'
  ),
  'completed jobs require output'
);

select ok(
  pg_temp.raises_sqlstate(
    $$insert into public.llm_inference_jobs
      (job_type, definition_version, semantic_idempotency_key, status, input, error_message)
      values ('valence_arousal_label', 1, repeat('f', 64), 'failed', '{}'::jsonb, '   ')$$,
    '23514'
  ),
  'failed jobs require a nonblank bounded error'
);

select ok(
  pg_temp.raises_sqlstate(
    $$insert into public.llm_inference_jobs
      (job_type, definition_version, semantic_idempotency_key, input)
      values ('valence_arousal_label', 1, repeat('a', 64), '{}'::jsonb)$$,
    '23505'
  ),
  'semantic idempotency keys are unique'
);

select ok(
  pg_temp.raises_sqlstate(
    $$insert into public.llm_inference_jobs
      (job_type, definition_version, semantic_idempotency_key, input, trigger_run_id)
      values ('valence_arousal_label', 1, repeat('1', 64), '{}'::jsonb, '   ')$$,
    '23514'
  ),
  'Trigger run identifiers must be nonblank'
);

select * from finish();

rollback;
