## 1. Workspace and Contract Setup

- [x] 1.1 Add the private `src/llm-inference/` npm workspace, TypeScript/Vitest/Prettier configuration, locked AI SDK Google, Zod, Supabase, and Trigger.dev dependencies, and root workspace scripts without importing the package from Electron.
- [x] 1.2 Add validated server environment configuration for Gemini, Supabase, and Trigger.dev with fail-fast tests and no credentials accepted through job payloads.
- [x] 1.3 Select and document the initial valence/arousal numerical scale and the stable server-resolvable image-reference shape used by the single-image job.

## 2. Typed Inference Core

- [x] 2.1 Implement the scoped inference configuration schema and generic versioned job-definition API with Zod input/output schemas, prompt construction, and semantic-identity selection.
- [x] 2.2 Implement the job registry, derived supported-job-type catalog, unique type enforcement, and lookup by persisted job type and definition version.
- [x] 2.3 Implement deterministic JSON canonicalization and SHA-256 semantic-key generation from job type, definition version, and definition-selected semantic input.
- [x] 2.4 Use AI SDK's native model/message contracts, define an injectable language-model resolver, and define the injectable job-store interface used by the executor.
- [x] 2.5 Add unit tests for valid and invalid definitions, duplicate registration, unsupported configuration, canonicalization, stable equivalent keys, and meaningful key changes.

## 3. Supabase Governance

- [x] 3.1 Add root Supabase configuration and a migration creating `llm_inference_job_types` and the minimal `llm_inference_jobs` schema, constraints, indexes, timestamps, initial `valence_arousal_label` type, and server-only RLS posture.
- [x] 3.2 Generate checked TypeScript database types under root `supabase/` from the migrated local schema with the project-pinned Supabase CLI, add CI drift detection, and construct the typed server client in production wiring.
- [x] 3.3 Implement the Supabase job store with atomic create-or-reuse, conditional claim, completion, failure, requeue, Trigger run correlation, and bounded error behavior.
- [x] 3.4 Add migration and repository integration tests covering foreign keys, status constraints, unique semantic keys, completed reuse, in-progress duplicates, failed requeue, concurrent claims, and validated JSON round trips.
- [x] 3.5 Verify the migration creates no emotion, click, gaze, video, display, outbox, attempt, token, cost, or latency storage.

## 4. Gemini Provider and First Operation

- [x] 4.1 Implement direct AI SDK Google Gemini model resolution and native `generateText` execution for text and referenced-image inputs with default `maxRetries: 2` and schema-oriented JSON results.
- [x] 4.2 Implement the versioned `valence_arousal_label` input/output schemas, anchor-based multimodal prompt, message builder, and semantic identity using target and anchor content digests and labels.
- [x] 4.3 Ensure persisted labeling input normalizes references and digests without storing inline image bytes, base64 content, credentials, or expiring URL signatures in semantic identity.
- [x] 4.4 Add native AI SDK mock-model tests for multimodal messages and labeling input/output validation plus an explicitly opt-in live Gemini and local-Supabase integration test using real facial images.

## 5. Shared Lifecycle and Direct Execution

- [x] 5.1 Implement job preparation that validates input before side effects, computes the semantic key, creates or reuses the governed row, validates reused completed output, and supports explicit failed-job requeue.
- [x] 5.2 Implement the shared executor with atomic ownership, registered-definition resolution, native AI SDK model invocation, output validation, conditional completion, and conditional failure persistence.
- [x] 5.3 Implement the explicit `runInferenceDirect` API on top of job preparation and the shared executor.
- [x] 5.4 Add lifecycle tests for direct success, malformed provider output, provider failure, persistence failure, completed reuse, duplicate running jobs, failed retry, and concurrent execution claims.

## 6. Trigger.dev Durable Execution

- [x] 6.1 Add Trigger.dev project configuration and one inference task configured for `maxAttempts: 2`, with task discovery limited to the server-side LLM workspace.
- [x] 6.2 Implement `enqueueInference` to prepare or reuse a job, submit its semantic key to Trigger.dev idempotency, dispatch only the job identifier, attach the returned run ID, and mark dispatch failures safely.
- [x] 6.3 Implement the thin Trigger.dev task that loads the governed job, records or recovers its context run ID, resolves the registered definition, and delegates to the shared executor.
- [x] 6.4 Add adapter and integration tests for duplicate durable submissions, one retry after a transient failure, terminal failure after two attempts, run correlation recovery, and the documented maximum of six provider requests across layered retries.

## 7. Verification and Documentation

- [x] 7.1 Export only the intended definition, registry, direct execution, and durable enqueue public APIs and verify server-only modules remain outside Electron's dependency graph and bundle.
- [x] 7.2 Add setup documentation and environment examples covering local Supabase migration use, direct execution, Trigger.dev execution, retry multiplication, semantic idempotency limits, and the absence of exactly-once provider billing.
- [x] 7.3 Run formatting, generated-type drift checking, typechecking, unit tests, migration tests, direct lifecycle integration tests, and Trigger adapter tests through root scripts and CI.
- [x] 7.4 Confirm no implementation changes were made to the Python emotion daemon, realtime stream, startup heartbeat, camera lifecycle, notch, interruption, local uploader, or emotion persistence.
