import { createGoogle } from "@ai-sdk/google";
import { createClient } from "@supabase/supabase-js";

import { createInferenceJobRegistry } from "../catalog";
import { parseInferenceServerEnvironment } from "../core/config";
import { SupabaseJobStore } from "../persistence/supabase-job-store";
import type { Database } from "../../../../supabase/database.types";
import type { ExecuteInferenceTaskDependencies } from "../trigger/execute-inference-handler";

export function createProductionInferenceDependencies(
  environment: NodeJS.ProcessEnv = process.env,
): ExecuteInferenceTaskDependencies {
  const config = parseInferenceServerEnvironment(environment);
  const client = createClient<Database>(
    config.SUPABASE_URL,
    config.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
      db: { schema: "public" },
    },
  );
  const google = createGoogle({
    apiKey: config.GEMINI_API_KEY,
  });

  return {
    registry: createInferenceJobRegistry(),
    repository: new SupabaseJobStore(client),
    resolveLanguageModel(inferenceConfig) {
      if (inferenceConfig.provider !== "google") {
        throw new Error(`Unsupported provider: ${inferenceConfig.provider}`);
      }
      return google(inferenceConfig.model);
    },
  };
}
