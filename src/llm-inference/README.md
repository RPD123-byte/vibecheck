# Vibecheck LLM inference

This private, server-only TypeScript workspace provides typed individual LLM
jobs. A versioned definition owns its input/output Zod schemas, Gemini model
settings, prompt construction, and semantic identity. Direct calls and durable
Trigger.dev calls share the same Supabase lifecycle executor.

Definitions use AI SDK `ModelMessage` values directly. The executor calls
`generateText` with `Output.object`, while production wiring resolves the
configured Google model as an AI SDK `LanguageModel`; there is no parallel
provider or message wrapper.

This package is deliberately not part of the Electron dependency graph. Never
expose its Supabase service-role key or Gemini credential to the desktop app.

## V1 operation

`valence_arousal_label` labels one target facial-expression image using one to
eight labeled image anchors. Valence and arousal both use the closed interval
`[-1, 1]`:

- valence: `-1` strongly unpleasant, `0` neutral, `1` strongly pleasant;
- arousal: `-1` very calm, `0` moderately activated, `1` highly activated.

Each image is represented by an HTTPS URL, lowercase SHA-256 content digest,
and JPEG, PNG, or WebP media type. The URL must remain reachable by Gemini's
Google-side fetcher long enough for retries, typically through a scoped signed
URL. No image bytes or base64 data are stored in the job row.

The semantic identity trusts the supplied digest; V1 does not download the
image and verify its bytes. Produce digests from trusted immutable object
metadata and do not reuse a digest with mutable content.

## Setup

Use Node 22, then install all root workspaces:

```sh
npm install
cp src/llm-inference/.env.example src/llm-inference/.env.local
```

Supply these server-only values through the process environment:

```text
GEMINI_API_KEY
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
TRIGGER_PROJECT_REF
TRIGGER_SECRET_KEY
```

The Trigger values are needed only for durable enqueue/deployment. Direct
execution still requires Gemini and Supabase.

Start local Supabase and apply the root migrations:

```sh
npx --no-install supabase start
npx --no-install supabase db reset
```

The authoritative, language-neutral schema lives in root
`supabase/migrations/`; the TypeScript client in this package is not the schema
owner. The migration creates only `llm_inference_job_types` and
`llm_inference_jobs`, enables RLS without browser policies, and permits server
mutations only through constrained lifecycle functions.

Root `supabase/database.types.ts` is generated directly from that migrated
database and must not be edited manually. After changing a migration, run:

```sh
npm run db:types:generate
npm run db:types:check
```

The Supabase CLI is pinned in the root development dependencies. The generation
command atomically replaces the checked-in file; the check command regenerates
into a temporary file and rejects drift. CI runs the same check against a fresh
local Supabase stack.

## Direct inference

```ts
import {
  runInferenceDirect,
  valenceArousalLabelDefinition,
} from "@vibecheck/llm-inference";

const result = await runInferenceDirect(
  valenceArousalLabelDefinition,
  {
    target: {
      url: "https://assets.example.com/target.webp",
      sha256: "<lowercase 64-character SHA-256>",
      mediaType: "image/webp",
    },
    anchors: [
      {
        image: {
          url: "https://assets.example.com/anchor.webp",
          sha256: "<lowercase 64-character SHA-256>",
          mediaType: "image/webp",
        },
        valence: 0.7,
        arousal: 0.2,
      },
    ],
  },
  { userId: null },
);

console.log(result.output.valence, result.output.arousal);
```

Inputs are rejected by Zod before database or provider work. The result is also
Zod-validated before the job can become `completed`. Definition schemas are
validation-only persistence contracts: their parsed values must be JSON-native,
and they must not use Zod transforms, pipes, or codecs. Perform domain
conversion before invoking a job or after reading its result.

## Durable inference

Run the Trigger.dev worker from this workspace:

```sh
npm run trigger:dev --workspace @vibecheck/llm-inference
```

Then enqueue the same registered definition:

```ts
import {
  enqueueInference,
  valenceArousalLabelDefinition,
} from "@vibecheck/llm-inference";

const queued = await enqueueInference(valenceArousalLabelDefinition, input);

console.log(queued.job.id, queued.triggerRunId);
```

The Trigger payload contains only the governed job UUID. The task recovers the
stored input, correlates its run ID, resolves the registered definition, and
calls the same executor as the direct path.

## Idempotency and retries

The permanent database identity is a SHA-256 hash of job type, definition
version, target content digest, and sorted anchor digests/labels. Signed URL
query parameters, hosts, and media transport details are intentionally excluded.
Supabase uniquely constrains this key; Trigger.dev receives it as a global
idempotency key for durable dispatch.

Semantic idempotency prevents multiple logical job rows. It does **not** promise
exactly-once provider execution or billing. A Gemini response followed by a
failed completion write can be retried. The AI SDK permits two retries after
its initial request, and Trigger.dev permits two total task attempts, so one
persistent durable failure can make at most:

```text
2 Trigger attempts × (1 Gemini request + 2 Gemini retries) = 6 requests
```

Failed jobs can be explicitly requeued on the same row. Trigger.dev clears the
idempotency key for a terminal failed run, allowing that requeue to create a new
run. V1 intentionally has no attempt, token, cost, or latency table. A hard kill
while a row is `running` requires manual recovery; automatic leases are a later
concern.

Semantic uniqueness is global in V1. If multiple users submit identical
content, the row retains the first submitter's `user_id` and input reference.
Do not expose raw governed job rows through a multi-tenant client API; add a
per-user invocation/reference table when the login and authorization model is
implemented.

## Verification

```sh
npm run llm:verify
npm run llm:test:migration
npm run llm:test:database
```

With local Supabase running and its URL/service-role key exported:

```sh
npm run llm:test:supabase
```

The real Gemini integration test is opt-in, requires local Supabase, uses
publicly hosted facial images, persists the typed result, verifies semantic
reuse, and guarantees at least one provider request on every run:

```sh
GEMINI_API_KEY=... \
SUPABASE_URL=http://127.0.0.1:54321 \
SUPABASE_SERVICE_ROLE_KEY=... \
npm run llm:test:live
```

Google Pub/Sub, emotion-threshold persistence, gaze/click/video storage, batch
label orchestration, LiteLLM, and changes to the local emotion runtime are all
outside this implementation.
