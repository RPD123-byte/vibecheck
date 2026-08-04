## ADDED Requirements

### Requirement: Versioned typed inference definitions
The system SHALL define every production inference operation through a
registered object containing a stable job type, positive definition version,
Zod input schema, Zod output schema, model configuration, prompt/message
builder, and semantic-identity selector. The job type used for persistence
SHALL be derived from that definition rather than accepted as an independent
caller-controlled value. Definition schemas SHALL be validation-only contracts
that produce JSON-native values without Zod transforms, pipes, or codecs.

#### Scenario: Register a valid definition
- **WHEN** a definition with a unique job type and valid required fields is registered
- **THEN** the registry exposes that definition and derives its supported job-type catalog from registered definitions

#### Scenario: Reject a duplicate job type
- **WHEN** two definitions attempt to register the same stable job type
- **THEN** initialization fails before either definition can be used ambiguously

#### Scenario: Reject invalid input before side effects
- **WHEN** a caller supplies input that fails the selected definition's input schema
- **THEN** the system rejects the invocation before preparing a database job, dispatching Trigger.dev, or calling a provider

#### Scenario: Reject non-JSON schema output before side effects
- **WHEN** an input schema produces a value that cannot be normalized as JSON
- **THEN** the system rejects the invocation before preparing a database job, dispatching Trigger.dev, or calling a provider

### Requirement: Scoped inference configuration
The system SHALL validate the provider, model identifier, and supported AI SDK
generation settings used by each definition. Execution mode, cache mode,
router cooldowns, and LiteLLM-specific settings SHALL NOT be part of the V1 job
configuration.

#### Scenario: Use AI SDK retry defaults
- **WHEN** a definition does not override provider retries
- **THEN** the Gemini invocation uses AI SDK `maxRetries: 2`, representing at most two retries after the initial request

#### Scenario: Reject unsupported configuration
- **WHEN** a definition contains an unsupported or invalid inference setting
- **THEN** definition validation fails before the operation is registered

### Requirement: Shared direct inference lifecycle
The system SHALL provide an explicit direct-execution entry point that validates
the definition input, prepares or reuses the governed job, invokes the shared
executor in-process, validates provider output, and persists the terminal
result.

#### Scenario: Complete direct execution
- **WHEN** a valid direct invocation receives provider output satisfying the definition output schema
- **THEN** the invocation returns the validated output and the corresponding governed job becomes completed

#### Scenario: Reject malformed provider output
- **WHEN** the provider returns output that fails the definition output schema
- **THEN** the executor records a failed job with a bounded error and does not expose the malformed value as a successful result

### Requirement: Explicit durable inference entry point
The system SHALL provide a distinct durable enqueue entry point that prepares or
reuses the same governed job and dispatches a Trigger.dev task. Execution mode
SHALL NOT be stored on or selected by the semantic job definition.

#### Scenario: Enqueue a new durable job
- **WHEN** a caller durably invokes a valid definition and no logically equivalent job exists
- **THEN** the system prepares one queued job and dispatches its identifier to the Trigger.dev adapter

#### Scenario: Direct and durable paths use the same executor
- **WHEN** equivalent jobs are run through direct and Trigger.dev entry points
- **THEN** both paths use the same definition resolution, AI SDK model invocation, output validation, and persistence implementation

### Requirement: Native AI SDK model boundary with Gemini V1 support
The system SHALL use AI SDK's native `LanguageModel`, `ModelMessage`,
`generateText`, and structured-output contracts instead of maintaining a
parallel provider/message abstraction. The executor SHALL resolve an AI SDK
model through an injectable resolver and SHALL implement V1 text and
referenced-image inference with AI SDK's Google Gemini provider. Provider
credentials SHALL be resolved from the server environment rather than accepted
in job input.

#### Scenario: Invoke Gemini with multimodal input
- **WHEN** a valid job definition produces native AI SDK instructions and referenced-image `ModelMessage` parts
- **THEN** the shared executor calls `generateText` with the resolved Gemini model and schema-oriented output

#### Scenario: Test without a live provider
- **WHEN** core execution is tested with AI SDK's injected mock language model
- **THEN** schemas, lifecycle behavior, and persistence can be verified without a Gemini credential or network request

### Requirement: Durable task retry policy
The Trigger.dev inference task SHALL use two total workflow attempts, including
the first, and SHALL invoke the shared executor using a registered job and task
context. The task SHALL NOT contain a second job-specific inference
implementation.

#### Scenario: Retry a transient task failure
- **WHEN** the first task attempt throws a retryable execution error
- **THEN** Trigger.dev may perform one additional task attempt against the same logical job

#### Scenario: Exhaust durable attempts
- **WHEN** both configured task attempts fail
- **THEN** the Trigger.dev run ends failed and the governed job retains a failed lifecycle state and bounded error

### Requirement: Single-image valence and arousal labeling definition
The system SHALL register a versioned `valence_arousal_label` operation for one
target image. Its input SHALL include a server-resolvable target image
reference and SHA-256 digest plus labeled anchor image references, digests,
valence values, and arousal values. Its output SHALL contain schema-validated
numeric valence and arousal labels. Each invocation SHALL contain between one
and eight anchors.

#### Scenario: Label one target from anchors
- **WHEN** the operation receives one target image and valid labeled anchors using the configured valence/arousal scale
- **THEN** it constructs the versioned multimodal prompt and returns numeric valence and arousal values satisfying its output schema

#### Scenario: Reject an incomplete labeling input
- **WHEN** the target digest, target reference, required anchors, or anchor labels are missing or invalid
- **THEN** input validation rejects the job before persistence, task dispatch, or Gemini inference

#### Scenario: Reject too many anchors
- **WHEN** an invocation contains more than eight anchors
- **THEN** input validation rejects the job before persistence, task dispatch, or Gemini inference

#### Scenario: Exclude batch orchestration
- **WHEN** a caller needs to label multiple target images
- **THEN** this capability exposes only individual job invocations and does not create or coordinate a parallel batch workflow
