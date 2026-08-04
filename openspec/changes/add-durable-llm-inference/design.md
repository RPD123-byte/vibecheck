## Context

The repository currently contains a Python local runtime, a Rust interruption
consumer, and one private Electron TypeScript workspace. It has no server-side
TypeScript package, LLM provider dependency, durable task runner, Supabase
schema, or shared database client. The first server-side use case is an
individual Gemini multimodal call that estimates valence and arousal for one
unlabeled image from labeled image anchors; parallel dataset orchestration is a
separate future concern.

This change must establish a reusable inference boundary without importing
server credentials or network persistence into Electron or the Python emotion
daemon. Root Supabase migrations are the cross-language contract. Runtime
clients remain language-specific, and this pass adds only the server-side
TypeScript client needed by LLM inference.

The important architectural split is semantic rather than organizational:

```text
job definition (what)                 execution adapter (how)
type, version, schemas, prompt         direct call or Trigger.dev
model settings, semantic identity              │
                 └──────────────┬───────────────┘
                                ▼
                     shared job executor
                    ┌───────────┴───────────┐
                    ▼                       ▼
          AI SDK model resolver      Supabase repository
```

## Goals / Non-Goals

**Goals:**

- Create a private, testable TypeScript workspace for individual text and
  multimodal LLM jobs.
- Make job identity truthful by deriving it from a registered definition rather
  than accepting a free job-type string from callers.
- Run the same validated lifecycle directly or through Trigger.dev.
- Use Gemini through AI SDK now while preserving a narrow provider boundary for
  a later gateway.
- Record a small auditable job row and enforce durable semantic idempotency in
  Supabase.
- Define the first single-image valence/arousal labeling job without building
  its future parallel batch coordinator.

**Non-Goals:**

- LiteLLM, another LLM router, provider failover, model cooldown policy, or
  Kubernetes deployment.
- Agents, tools, multi-step reasoning loops, streaming responses, or caching.
- Parallel or batch image-label orchestration.
- Attempt rows, token counts, cost, latency, start/completion timestamps, or
  other router-grade telemetry.
- Login UI, general user-event storage, emotion threshold persistence, local
  durable outboxes, video, clicks, gaze, display state, or model-file storage.
- Changes to camera permission, emotion inference, stream publication,
  heartbeat freshness, notch presentation, interruption, or Electron control.

## Decisions

### 1. Add one private TypeScript workspace under `src/llm-inference/`

The root npm workspace list gains `src/llm-inference`. The package is private
and exposes a small public API while keeping provider, persistence, and Trigger
implementation details internal:

```text
src/llm-inference/
  package.json
  tsconfig.json
  trigger.config.ts
  src/
    core/
      config.ts
      definition.ts
      model-resolver.ts
      registry.ts
      semantic-key.ts
      execute-job.ts
    persistence/
      job-store.ts
      supabase-job-store.ts
    operations/
      valence-arousal-label/
        definition.ts
        prompt.ts
        schemas.ts
    trigger/
      enqueue.ts
      execute-inference-task.ts
    index.ts
```

The exact internal filenames may change during implementation, but these
responsibility boundaries must remain. The package is not published and is not
imported by Electron in this change.

Alternative considered: place miscellaneous TypeScript files directly under
the existing Electron workspace. That would bundle server dependencies and
credential assumptions into a local desktop application and make later
server-side deployment harder to isolate.

Alternative considered: create separate core, provider, persistence, and task
npm packages immediately. The current single use case does not justify that
release and dependency overhead; internal interfaces provide the needed seams.

### 2. Definitions describe job semantics and own their job type

`defineInferenceJob` accepts a stable job type, positive definition version,
Zod input and output schemas, provider/model settings, a prompt/message builder,
and a function that selects the semantic identity from validated input. The
registry rejects duplicate job types. It exposes a derived TypeScript union or
constant catalog for discovery, but callers invoke a definition object rather
than supplying an unrelated job-type parameter.

The inference configuration schema includes the model identifier and AI SDK
settings used in this pass, such as temperature, output limits, and retry count.
It does not include Trigger selection, cache mode, router cooldowns, cost
controls, or LiteLLM-specific settings. Runtime prompt variables belong in the
typed job input; each production operation owns its prompt builder rather than
accepting an arbitrary caller-provided prompt under a misleading job name.

Meaningful changes to the prompt, schemas, model behavior, or semantic identity
increment `definitionVersion`. This single explicit version is the V1
provenance mechanism instead of storing prompt and configuration hashes in
separate columns.

Production entry points require the exact definition object held by the
compiled registry, not merely a structurally similar object with the same type
and version. Parsed configuration is frozen. Definition schemas are
validation-only persistence contracts whose parsed values must be JSON-native;
they do not use Zod transforms, pipes, or codecs. Domain conversion belongs
outside the persisted definition so direct and durable execution read the same
shape without an additional round-trip abstraction.

Alternative considered: make callers pass a job-type enum and generic prompt.
That permits a call to be persisted under a false semantic label and weakens
both typing and auditability.

### 3. Direct and durable entry points share one executor

The public API provides explicit entry points equivalent to:

```ts
runInferenceDirect(definition, input)
enqueueInference(definition, input)
```

Execution mode is not a field on the job definition. Direct execution prepares
the job and invokes the shared executor in-process. Durable execution prepares
the same job and dispatches a thin Trigger.dev task carrying the job identifier;
the task then invokes the same executor. Unit tests can inject an in-memory
repository and AI SDK mock language model without production side effects.

The shared executor performs, in order:

1. resolve the registered definition and validate input;
2. compute or verify the semantic key;
3. atomically claim the prepared job;
4. resolve the configured AI SDK `LanguageModel` and invoke `generateText`;
5. validate the provider output with the definition output schema;
6. persist `completed` plus the normalized output, or persist `failed` plus a
   bounded error message and rethrow when durable retry remains appropriate.

All direct production-like calls use the same persistence lifecycle. The AI
SDK language-model resolver remains injectable for isolated unit tests but is
not the main application API.

Alternative considered: a `useTriggerDev` boolean in every definition. That
mixes deployment policy with job semantics and prevents the same operation from
being exercised directly in tests and durably in production.

### 4. Use native AI SDK contracts with a direct Gemini model in V1

Job definitions produce AI SDK `ModelMessage` values directly and keep system
guidance in AI SDK's `instructions` field. The shared executor calls
`generateText` with `Output.object`, and production wiring injects only a small
resolver from validated inference configuration to AI SDK `LanguageModel`.
There is no parallel message, request/result, or provider-generation wrapper.

The V1 resolver uses AI SDK's Google provider package and supports text and
referenced-image file parts. AI SDK retains its configured `maxRetries: 2`,
meaning one initial provider request plus at most two retries. Tests inject AI
SDK's `MockLanguageModelV4`; live Gemini tests are opt-in and require an
explicit environment credential.

LiteLLM is not installed. A later LiteLLM deployment would be a separate HTTP
service exposed through an AI SDK-compatible provider that returns another
`LanguageModel`, without changing job definitions or the executor.

### 5. Register one single-image valence/arousal labeling definition

The first operation has a stable type such as `valence_arousal_label` and a
versioned definition. Its validated input contains:

- a server-resolvable target image reference and immutable SHA-256 digest;
- one to eight labeled anchor image references with their immutable digests,
  valence values, and arousal values; and
- only the prompt variables needed by this labeling procedure.

Its output schema contains numeric valence and arousal labels. V1 uses a closed
`[-1, 1]` scale for both dimensions: valence runs from strongly unpleasant
through neutral to strongly pleasant, while arousal runs from very calm through
moderate activation to highly activated. Image bytes are not stored in
`llm_inference_jobs`; persisted input contains references and digests. Each
image reference is an HTTPS URL, a lowercase hexadecimal SHA-256 content
digest, and one of the supported JPEG, PNG, or WebP media types.

The semantic identity includes the target digest and canonicalized anchor
digests and labels. It excludes expiring URL signatures and other transport
details. The job type and definition version are added by the core key builder.

Alternative considered: key only on the image URL or storage path. Those are
mutable transport locations and cannot prove that two submissions label the
same content with the same anchors.

### 6. Keep Trigger.dev as a thin durable execution adapter

One Trigger.dev task resolves the prepared job's registered definition and
calls the shared executor. Its task-level retry policy sets `maxAttempts: 2`,
which is two total workflow attempts including the first. Combined with AI SDK
`maxRetries: 2`, a persistent failure can make up to six Gemini requests; tests
and documentation make this multiplication explicit.

`enqueueInference` supplies the semantic key to Trigger.dev's idempotency
mechanism and the database separately enforces the same semantic identity.
Trigger idempotency reduces duplicate task runs; the unique database key is the
permanent application invariant. Exactly-once provider billing is not claimed:
a provider response followed by a failed database write can still be retried.

The task payload contains a job identifier, not credentials or image bytes.
The task loads the stored normalized input and records the Trigger run ID. Task
registration remains framework-specific, while lifecycle logic remains in the
shared executor.

### 7. Prepare jobs before direct execution or durable dispatch

Both public entry points first validate input, compute the semantic key, and ask
the repository to create or reuse a `queued` job. The unique key determines the
result:

- a completed job reuses its validated stored output;
- a queued or running job returns the existing job identity and does not create
  a second logical job;
- a failed job can be atomically requeued using the same row and key.

The executor conditionally transitions `queued` or retryable `failed` to
`running`. A concurrent executor that does not own the claim cannot invoke the
provider. Trigger attempts for the same run may reclaim their failed row. State
changes use conditional updates so duplicate callers cannot both claim the
same job.

If Trigger dispatch itself fails, the enqueue adapter marks the prepared job
failed with a bounded error. If dispatch succeeds but attaching the returned
run ID fails, the task can still attach its own context run ID when it starts.
A pre-existing queued row with no Trigger run ID is dispatch-eligible so a
process exit between database preparation and dispatch does not strand it;
concurrent recovery dispatches converge through Trigger's global idempotency
key.

### 8. Use a minimal Supabase schema and server-only repository

Root `supabase/migrations/` contains the authoritative SQL contract. This pass
creates:

```text
llm_inference_job_types
  name text primary key
  description text null

llm_inference_jobs
  id uuid primary key
  user_id uuid null references auth.users
  job_type text references llm_inference_job_types(name)
  definition_version integer
  semantic_idempotency_key text unique
  status text check (queued, running, completed, failed)
  input jsonb
  output jsonb null
  error_message text null
  trigger_run_id text null
  created_at timestamptz
  updated_at timestamptz
```

The migration seeds the initial job type and enables row-level security without
adding browser/client write policies. Production wiring constructs a typed
Supabase client from a server credential supplied only to the LLM
workspace/Trigger environment. The Supabase job store is injected into core
execution through an `InferenceJobStore` interface.

Root `supabase/database.types.ts` is direct output from the project-pinned
Supabase CLI against the fully migrated local database. It is excluded from
formatting and must not be edited by hand. A generation command atomically
replaces it, while a separate check regenerates into a temporary file and fails
on any diff. CI runs that check in a dedicated Ubuntu job with a local Supabase
stack because the main macOS runner does not provide the required Docker
environment.

There is no attempts table and no token, cost, latency, started-at, or
completed-at columns. Trigger.dev remains the V1 attempt-level record. There is
also no general cross-language Supabase client: future Python services create a
Python client against the same migrations, while the local emotion daemon stays
unconnected in this pass.

The monotonically advanced `updated_at` value returned by a successful claim is
the V1 optimistic ownership version. Completion and claimed failure require
that exact value, so an older executor cannot overwrite a newer claim without
adding a claim-token column. Attaching a Trigger run ID is deliberately
version-neutral and may occur in any lifecycle state, so late durable
correlation cannot invalidate a simultaneous direct executor's claim.

Alternative considered: put migrations beside a TypeScript client under
`src/`. That would incorrectly make the TypeScript runtime the owner of a
database contract that future Python services also consume.

## Risks / Trade-offs

- **Retry multiplication can produce up to six provider requests** → Document
  the exact AI SDK and Trigger attempt semantics, test their configuration, and
  rely on the database key only for logical-job deduplication rather than
  claiming exactly-once billing.
- **A completed provider call can be repeated if persistence fails** → Keep the
  output write immediately after schema validation and accept at-least-once
  provider execution until a provider offers usable request idempotency.
- **Generic JSON job columns have weak database-level output typing** → Validate
  on every write and read with the registered Zod schemas; keep operation
  schemas versioned.
- **An expiring signed image URL may be unusable on retry** → Key on immutable
  content digest and prefer stable server-resolvable storage references; media
  upload and refresh infrastructure remain outside this change.
- **A hard worker exit can leave a claimed row running** → V1 does not reclaim
  running work automatically because doing so without a lease can overlap a
  still-active owner and duplicate provider calls. Recover such rows manually;
  add an explicit claim lease before enabling automatic stale-claim recovery.
- **A single generic Trigger task may later need per-operation concurrency** →
  Keep task dispatch behind an adapter so high-volume operations can gain
  dedicated tasks or queues without changing job definitions.
- **Server credentials could leak into the desktop bundle** → Keep the LLM
  workspace out of Electron's dependency graph and add tests or build checks
  that server-only modules are not imported by Electron.

## Migration Plan

1. Add the private workspace, locked dependencies, configuration validation,
   core interfaces, and tests without connecting existing runtime processes.
2. Add and locally validate the Supabase migration, generate the TypeScript
   database types from it, and enforce generated-type drift in CI.
3. Add the Supabase repository and fake-backed lifecycle tests.
4. Add native AI SDK Gemini model resolution and an opt-in live smoke test.
5. Add direct execution, the valence/arousal definition, and end-to-end direct
   lifecycle coverage.
6. Add Trigger.dev configuration, enqueue adapter, task, and durable integration
   coverage with two total task attempts.

Rollback removes or disables the new server deployment and workspace imports;
no existing application path depends on it. Database tables can remain unused
for audit preservation. Dropping them is an explicit later migration, not part
of application rollback.

## Resolved Implementation Questions

- Valence and arousal both use a closed `[-1, 1]` scale, documented directly in
  the versioned prompt and enforced by strict Zod input/output schemas.
- V1 image references use an HTTPS URL, lowercase SHA-256 content digest, and
  JPEG, PNG, or WebP media type. The digest—not the URL, its query signature, or
  media transport details—participates in semantic identity. Media upload and
  URL-refresh infrastructure remain outside this change.
