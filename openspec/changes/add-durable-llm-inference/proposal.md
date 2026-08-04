## Why

Vibecheck needs a reusable, auditable TypeScript surface for individual text and
multimodal LLM calls before it can label unlabeled facial-expression images at
scale. The repository currently has no shared LLM job definition, provider,
durable execution, idempotency, or server-side persistence foundation.

## What Changes

- Add a private TypeScript LLM-inference workspace under `src/llm-inference/`
  that defines typed, versioned inference jobs with Zod-validated inputs and
  outputs, model settings, prompt construction, and semantic identity.
- Use AI SDK's native `LanguageModel`, `ModelMessage`, `generateText`, and
  structured-output primitives with the Google Gemini provider; do not add a
  parallel provider/message wrapper or introduce LiteLLM in this pass.
- Provide explicit direct and Trigger.dev execution entry points that converge
  on one shared job executor and lifecycle rather than embedding execution mode
  in job definitions.
- Add a Trigger.dev task adapter with two total workflow attempts and semantic
  idempotency propagation.
- Establish root Supabase migrations as the language-neutral database contract,
  with a job-type lookup table and a deliberately small `llm_inference_jobs`
  table for lifecycle, inputs, outputs, failures, Trigger run linkage, and a
  unique semantic idempotency key.
- Add the first registered inference operation for Gemini valence/arousal image
  labeling, while leaving parallel batch labeling for a later change.
- Add focused unit and integration tests for schemas, definition registration,
  semantic-key stability, lifecycle transitions, duplicate submission, direct
  execution, durable dispatch, and persistence behavior.

## Capabilities

### New Capabilities

- `llm-inference`: Typed job definitions, provider-neutral execution, direct
  and Trigger.dev entry points, Gemini multimodal inference, and the initial
  valence/arousal labeling operation.
- `llm-inference-governance`: Supabase job-type and job records, lifecycle
  persistence, semantic idempotency, durable retry behavior, and Trigger run
  correlation.

### Modified Capabilities

None. Existing local emotion inference, realtime streaming, interruption,
notch, runtime lifecycle, and Electron control requirements are unchanged.

## Impact

- Adds a private npm workspace at `src/llm-inference/` and updates root workspace
  and script configuration for its build, typecheck, format, and tests.
- Adds AI SDK, the Google Gemini provider, Zod, Supabase, and Trigger.dev
  TypeScript dependencies plus Trigger project configuration.
- Adds `supabase/` configuration and migrations for LLM inference job data only.
- Checks in Supabase CLI-generated TypeScript database types and verifies in CI
  that regeneration from the migrated schema produces no diff.
- Introduces a server-side Gemini API credential, Supabase server credential,
  and Trigger.dev project/environment configuration.
- Does not change the Python emotion daemon, camera startup, emotion-stream
  heartbeat, local process topology, or any emotion/click/gaze persistence.
- Does not add LiteLLM, agents, streaming model responses, continuous emotion
  uploads, batch image-label orchestration, attempt-level telemetry, token/cost
  accounting, latency fields, caching, or production Kubernetes resources.
