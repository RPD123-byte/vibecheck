import { schemaTask } from "@trigger.dev/sdk";

import { createProductionInferenceDependencies } from "../server/production-dependencies.js";
import {
  EXECUTE_INFERENCE_TASK_ID,
  EXECUTE_INFERENCE_TASK_RETRY,
  executeInferenceTaskPayloadSchema,
} from "./contract";
import { executeInferenceTaskHandler } from "./execute-inference-handler";

export const executeInferenceTask = schemaTask({
  id: EXECUTE_INFERENCE_TASK_ID,
  schema: executeInferenceTaskPayloadSchema,
  retry: EXECUTE_INFERENCE_TASK_RETRY,
  run: async (payload, { ctx }) => {
    const dependencies = await createProductionInferenceDependencies();
    return executeInferenceTaskHandler(
      payload,
      {
        triggerRunId: ctx.run.id,
        attemptNumber: ctx.attempt.number,
      },
      dependencies,
    );
  },
});
