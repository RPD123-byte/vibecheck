## ADDED Requirements

### Requirement: Language-neutral Supabase migration contract
The system SHALL keep the authoritative database schema under root
`supabase/migrations/` so TypeScript and future Python services can use the same
contract with language-specific clients. This change SHALL add database objects
only for LLM inference governance.

#### Scenario: Apply migrations to an empty database
- **WHEN** the Supabase migrations are applied in order to an empty supported database
- **THEN** the LLM job-type lookup and LLM inference job tables, constraints, indexes, and initial job type are created successfully

#### Scenario: Preserve emotion runtime scope
- **WHEN** the LLM governance migrations are applied
- **THEN** no emotion, click, gaze, video, display, or local-outbox table or runtime integration is created

### Requirement: Generated TypeScript database contract
The system SHALL generate the checked-in TypeScript Supabase database types
from the fully migrated local database with a project-pinned Supabase CLI. The
generated artifact SHALL NOT be manually maintained, and CI SHALL fail when
regeneration differs from the checked-in file.

#### Scenario: Regenerate database types
- **WHEN** the generation command runs against the migrated local Supabase database
- **THEN** it replaces `database.types.ts` with direct Supabase CLI output

#### Scenario: Detect schema/type drift
- **WHEN** CI regenerates database types from all migrations
- **THEN** the check fails if the generated output differs from `database.types.ts`

### Requirement: Governed job types
The system SHALL maintain an `llm_inference_job_types` lookup table keyed by
stable text name and SHALL require every inference job row to reference an
existing lookup value. The initial migration SHALL register the
`valence_arousal_label` job type.

#### Scenario: Persist a registered type
- **WHEN** a job is prepared for a registered inference definition
- **THEN** its job type satisfies the lookup-table foreign key

#### Scenario: Reject an unknown type
- **WHEN** persistence is attempted with a job type absent from the lookup table
- **THEN** the database rejects the row

### Requirement: Minimal inference job record
The system SHALL store one `llm_inference_jobs` row per logical inference job
with an ID, optional user reference, job type, definition version, semantic
idempotency key, constrained status, normalized JSON input, optional validated
JSON output, optional bounded error, optional Trigger run ID, creation time, and
update time. The schema SHALL NOT add an attempt table or token, cost, latency,
started-at, or completed-at fields in this change.

#### Scenario: Store a queued job
- **WHEN** a new valid logical job is prepared
- **THEN** one queued row contains its normalized input, definition identity, semantic key, and creation/update timestamps without attempt-level telemetry

#### Scenario: Store a completed result
- **WHEN** provider output passes the registered output schema
- **THEN** the same row becomes completed and stores the validated JSON output

#### Scenario: Avoid storing image bytes
- **WHEN** a multimodal job is persisted
- **THEN** its JSON input stores image references and immutable content digests but not inline image bytes or base64 blobs

### Requirement: Stable semantic idempotency
The system SHALL compute a SHA-256 semantic idempotency key from the registered
job type, definition version, and deterministically canonicalized semantic
identity selected from validated input. Transport-only values such as expiring
URL signatures SHALL NOT affect that identity. The database SHALL enforce key
uniqueness.

#### Scenario: Equivalent submissions produce one key
- **WHEN** two inputs describe the same target content, definition version, anchors, and labels but differ only in JSON property order or excluded transport details
- **THEN** they produce the same semantic idempotency key and cannot create two logical job rows

#### Scenario: Meaningful labeling input changes the key
- **WHEN** the target image digest, anchor digest, anchor label, job type, or definition version changes
- **THEN** the semantic idempotency key changes

### Requirement: Idempotent job preparation and reuse
The repository SHALL atomically create or reuse a job by semantic key. It SHALL
reuse validated output from completed jobs, return the existing identity for
queued or running jobs, and allow an explicit retry to atomically requeue a
failed job using the same row.

#### Scenario: Reuse a completed job
- **WHEN** an equivalent invocation finds a completed job whose stored output still passes the registered output schema
- **THEN** the system returns that job and output without dispatching or invoking the provider again

#### Scenario: Observe an in-progress duplicate
- **WHEN** an equivalent invocation finds a queued or running job
- **THEN** the system returns the existing job identity and does not create or claim a second logical job

#### Scenario: Retry a failed job
- **WHEN** retry is requested for an equivalent failed job
- **THEN** a conditional update requeues the existing row and clears its prior terminal error without changing its semantic key

### Requirement: Atomic lifecycle claims
The executor SHALL use conditional persistence operations so only one execution
owner can transition an eligible queued or retryable failed job to running and
invoke the provider. Lifecycle transitions SHALL be limited to valid queued,
running, completed, and failed states.

#### Scenario: Concurrent claims
- **WHEN** two executors attempt to claim the same queued job concurrently
- **THEN** exactly one claim succeeds and only its owner may invoke the provider

#### Scenario: Complete the claimed job
- **WHEN** the claim owner persists schema-valid output
- **THEN** the row conditionally transitions from running to completed and clears any previous error

#### Scenario: Fail the claimed job
- **WHEN** the claim owner encounters an execution or validation error
- **THEN** the row conditionally transitions from running to failed with a bounded error message

### Requirement: Trigger run correlation and layered idempotency
Durable dispatch SHALL submit the semantic key to Trigger.dev's idempotency
mechanism, persist or recover the Trigger run ID on the governed job, and retain
the database unique key as the permanent logical-job invariant.

#### Scenario: Correlate a durable run
- **WHEN** Trigger.dev accepts or starts a durable job
- **THEN** the corresponding inference row records the Trigger run ID without creating an attempt row

#### Scenario: Dispatch the same semantic job twice
- **WHEN** the durable entry point receives two equivalent invocations
- **THEN** Trigger.dev idempotency and database uniqueness converge on the same logical job rather than two completed records

#### Scenario: Provider execution is at least once
- **WHEN** a provider response succeeds but the subsequent database completion write fails
- **THEN** a retry may call the provider again while still preventing multiple completed logical job rows

### Requirement: Server-only database access
The LLM inference package SHALL create its Supabase client from server-side
environment configuration, inject persistence through a repository interface,
and keep server credentials out of job payloads and the Electron dependency
graph. Row-level security SHALL be enabled without adding browser write policies
for these tables in this change.

#### Scenario: Execute in the Trigger environment
- **WHEN** the durable task starts with valid server environment configuration
- **THEN** it constructs the server repository and reads and writes governed jobs

#### Scenario: Missing server configuration
- **WHEN** required Supabase server configuration is absent or invalid
- **THEN** startup or invocation fails clearly before a provider request is made

#### Scenario: Import Electron application code
- **WHEN** the Electron workspace is built
- **THEN** it does not import the LLM inference server client or contain the Supabase server credential
