const MAX_ERROR_MESSAGE_LENGTH = 2_048;

export class InferenceJobInProgressError extends Error {
  readonly jobId: string;

  constructor(jobId: string) {
    super(`Inference job is already in progress: ${jobId}`);
    this.name = "InferenceJobInProgressError";
    this.jobId = jobId;
  }
}

export class InferenceJobStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InferenceJobStateError";
  }
}

export function boundedErrorMessage(error: unknown): string {
  const candidate = error instanceof Error ? error.message : String(error);
  const normalized = candidate.trim();
  const message = normalized === "" ? "Unknown inference error" : normalized;
  return message.slice(0, MAX_ERROR_MESSAGE_LENGTH);
}
