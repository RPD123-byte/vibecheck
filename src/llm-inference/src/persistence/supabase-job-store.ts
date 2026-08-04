import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { normalizeJsonValue, type JsonValue } from "../core/json";
import type {
  CreateInferenceJobInput,
  CreateOrGetInferenceJobResult,
  InferenceJobRecord,
  InferenceJobStore,
} from "./job-store";
import type { Database, Json } from "../../../../supabase/database.types";

type LlmInferenceJobRow =
  Database["public"]["Tables"]["llm_inference_jobs"]["Row"];

const jobStatusSchema = z.enum(["queued", "running", "completed", "failed"]);

export type InferenceSupabaseClient = SupabaseClient<Database>;

function toDatabaseJson(value: JsonValue): Json {
  return value;
}

function toJobRecord(rawRow: LlmInferenceJobRow): InferenceJobRecord {
  return {
    id: rawRow.id,
    userId: rawRow.user_id,
    jobType: rawRow.job_type,
    definitionVersion: rawRow.definition_version,
    semanticIdempotencyKey: rawRow.semantic_idempotency_key,
    status: jobStatusSchema.parse(rawRow.status),
    input: normalizeJsonValue(rawRow.input),
    output: rawRow.output === null ? null : normalizeJsonValue(rawRow.output),
    errorMessage: rawRow.error_message,
    triggerRunId: rawRow.trigger_run_id,
    createdAt: rawRow.created_at,
    updatedAt: rawRow.updated_at,
  };
}

function throwRepositoryError(
  operation: string,
  error: PostgrestError | null,
): void {
  if (error !== null) {
    throw new Error(`Supabase ${operation} failed: ${error.message}`, {
      cause: error,
    });
  }
}

export class SupabaseJobStore implements InferenceJobStore {
  readonly #client: InferenceSupabaseClient;

  constructor(client: InferenceSupabaseClient) {
    this.#client = client;
  }

  async createOrGet(
    input: CreateInferenceJobInput,
  ): Promise<CreateOrGetInferenceJobResult> {
    const args: Database["public"]["Functions"]["create_or_get_llm_inference_job"]["Args"] =
      {
        p_job_type: input.jobType,
        p_definition_version: input.definitionVersion,
        p_semantic_idempotency_key: input.semanticIdempotencyKey,
        p_input: toDatabaseJson(input.input),
        ...(input.userId === null ? {} : { p_user_id: input.userId }),
      };
    const { data, error } = await this.#client
      .rpc("create_or_get_llm_inference_job", args)
      .single();
    throwRepositoryError("create-or-get", error);
    if (data === null) {
      throw new Error("Supabase create-or-get returned no job");
    }
    return { job: toJobRecord(data), created: data.was_created };
  }

  async getById(jobId: string): Promise<InferenceJobRecord | null> {
    const { data, error } = await this.#client
      .from("llm_inference_jobs")
      .select("*")
      .eq("id", jobId)
      .maybeSingle();
    throwRepositoryError("get-by-id", error);
    return data === null ? null : toJobRecord(data);
  }

  async requeueFailed(
    jobId: string,
    input: JsonValue,
  ): Promise<InferenceJobRecord | null> {
    const args: Database["public"]["Functions"]["requeue_failed_llm_inference_job"]["Args"] =
      {
        p_job_id: jobId,
        p_input: toDatabaseJson(input),
      };
    const { data, error } = await this.#client
      .rpc("requeue_failed_llm_inference_job", args)
      .maybeSingle();
    throwRepositoryError("requeue-failed", error);
    return data === null ? null : toJobRecord(data);
  }

  async claim(jobId: string): Promise<InferenceJobRecord | null> {
    const args: Database["public"]["Functions"]["claim_llm_inference_job"]["Args"] =
      {
        p_job_id: jobId,
      };
    const { data, error } = await this.#client
      .rpc("claim_llm_inference_job", args)
      .maybeSingle();
    throwRepositoryError("claim", error);
    return data === null ? null : toJobRecord(data);
  }

  async complete(
    jobId: string,
    claimVersion: string,
    output: JsonValue,
  ): Promise<InferenceJobRecord | null> {
    const args: Database["public"]["Functions"]["complete_llm_inference_job"]["Args"] =
      {
        p_job_id: jobId,
        p_claimed_updated_at: claimVersion,
        p_output: toDatabaseJson(output),
      };
    const { data, error } = await this.#client
      .rpc("complete_llm_inference_job", args)
      .maybeSingle();
    throwRepositoryError("complete", error);
    return data === null ? null : toJobRecord(data);
  }

  async fail(
    jobId: string,
    errorMessage: string,
    claimVersion?: string,
  ): Promise<InferenceJobRecord | null> {
    const args: Database["public"]["Functions"]["fail_llm_inference_job"]["Args"] =
      {
        p_job_id: jobId,
        p_error_message: errorMessage,
        ...(claimVersion === undefined
          ? {}
          : { p_claimed_updated_at: claimVersion }),
      };
    const { data, error } = await this.#client
      .rpc("fail_llm_inference_job", args)
      .maybeSingle();
    throwRepositoryError("fail", error);
    return data === null ? null : toJobRecord(data);
  }

  async attachTriggerRunId(
    jobId: string,
    triggerRunId: string,
  ): Promise<InferenceJobRecord | null> {
    const args: Database["public"]["Functions"]["attach_llm_inference_trigger_run"]["Args"] =
      {
        p_job_id: jobId,
        p_trigger_run_id: triggerRunId,
      };
    const { data, error } = await this.#client
      .rpc("attach_llm_inference_trigger_run", args)
      .maybeSingle();
    throwRepositoryError("attach-trigger-run", error);
    return data === null ? null : toJobRecord(data);
  }
}
