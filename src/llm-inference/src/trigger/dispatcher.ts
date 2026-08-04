import { idempotencyKeys, tasks } from "@trigger.dev/sdk";

import {
  EXECUTE_INFERENCE_TASK_ID,
  executeInferenceTaskPayloadSchema,
  semanticIdempotencyKeySchema,
  type ExecuteInferenceTaskPayload,
} from "./contract";
import type { executeInferenceTask } from "./execute-inference-task";

export interface InferenceTaskDispatchRequest {
  readonly jobId: string;
  readonly semanticIdempotencyKey: string;
}

export interface InferenceTaskDispatchResult {
  readonly runId: string;
}

export interface InferenceTaskDispatcher {
  dispatch(
    request: InferenceTaskDispatchRequest,
  ): Promise<InferenceTaskDispatchResult>;
}

export interface TriggerDevSdkAdapter {
  createIdempotencyKey(
    key: string,
    options: { readonly scope: "global" },
  ): Promise<string>;
  triggerTask(
    payload: ExecuteInferenceTaskPayload,
    options: { readonly idempotencyKey: string },
  ): Promise<{ readonly id: string }>;
}

const triggerDevSdkAdapter: TriggerDevSdkAdapter = {
  createIdempotencyKey: (key, options) => idempotencyKeys.create(key, options),
  triggerTask: (payload, options) =>
    tasks.trigger<typeof executeInferenceTask>(
      EXECUTE_INFERENCE_TASK_ID,
      payload,
      options,
    ),
};

export class TriggerDevInferenceTaskDispatcher implements InferenceTaskDispatcher {
  readonly #sdk: TriggerDevSdkAdapter;

  constructor(sdk: TriggerDevSdkAdapter = triggerDevSdkAdapter) {
    this.#sdk = sdk;
  }

  async dispatch(
    request: InferenceTaskDispatchRequest,
  ): Promise<InferenceTaskDispatchResult> {
    const payload = executeInferenceTaskPayloadSchema.parse({
      jobId: request.jobId,
    });
    const semanticIdempotencyKey = semanticIdempotencyKeySchema.parse(
      request.semanticIdempotencyKey,
    );
    const triggerIdempotencyKey = await this.#sdk.createIdempotencyKey(
      semanticIdempotencyKey,
      { scope: "global" },
    );
    const handle = await this.#sdk.triggerTask(payload, {
      idempotencyKey: triggerIdempotencyKey,
    });

    return { runId: parseTriggerRunId(handle.id) };
  }
}

function parseTriggerRunId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value !== value.trim() ||
    value.length > 512
  ) {
    throw new TypeError("Trigger.dev returned an invalid run ID");
  }
  return value;
}
