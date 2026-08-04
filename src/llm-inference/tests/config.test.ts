import { describe, expect, it } from "vitest";

import {
  parseInferenceServerEnvironment,
  parseTriggerServerEnvironment,
} from "../src/core/config";

describe("server environment validation", () => {
  it("parses only the required inference server settings", () => {
    expect(
      parseInferenceServerEnvironment({
        GEMINI_API_KEY: "gemini-key",
        SUPABASE_URL: "https://project.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service-key",
        UNRELATED: "ignored",
      }),
    ).toEqual({
      GEMINI_API_KEY: "gemini-key",
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-key",
    });
  });

  it("fails before execution when inference configuration is absent", () => {
    expect(() => parseInferenceServerEnvironment({})).toThrow();
    expect(() =>
      parseInferenceServerEnvironment({
        GEMINI_API_KEY: "key",
        SUPABASE_URL: "not-a-url",
        SUPABASE_SERVICE_ROLE_KEY: "service-key",
      }),
    ).toThrow();
    expect(() =>
      parseInferenceServerEnvironment({
        GEMINI_API_KEY: "key",
        SUPABASE_URL: "ftp://project.example.test/database",
        SUPABASE_SERVICE_ROLE_KEY: "service-key",
      }),
    ).toThrow("HTTP or HTTPS");
  });

  it("validates Trigger.dev settings independently", () => {
    expect(
      parseTriggerServerEnvironment({
        TRIGGER_PROJECT_REF: "proj_example",
        TRIGGER_SECRET_KEY: "tr_dev_example",
      }),
    ).toEqual({
      TRIGGER_PROJECT_REF: "proj_example",
      TRIGGER_SECRET_KEY: "tr_dev_example",
    });
    expect(() => parseTriggerServerEnvironment({})).toThrow();
  });
});
