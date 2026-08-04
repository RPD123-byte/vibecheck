import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";

import { inferenceConfigSchema } from "../src/core/config";
import {
  defineInferenceJob,
  type InferJobInput,
  type InferJobOutput,
} from "../src/core/definition";
import { canonicalizeJson, normalizeJsonValue } from "../src/core/json";
import {
  DuplicateInferenceJobTypeError,
  InferenceJobRegistry,
  UnknownInferenceJobDefinitionError,
} from "../src/core/registry";
import {
  createSemanticIdempotencyKey,
  semanticKeyMaterial,
} from "../src/core/semantic-key";

const inputSchema = z
  .object({
    label: z.string().trim().min(1),
    weight: z.number().finite(),
  })
  .strict();

const outputSchema = z.object({ score: z.number().finite() }).strict();

function createDefinition(version = 1) {
  return defineInferenceJob({
    jobType: "test_score",
    definitionVersion: version,
    inputSchema,
    outputSchema,
    config: { provider: "google", model: "test-model" },
    instructions: "Score the supplied label.",
    outputName: "test_score",
    buildMessages: (input) => [
      {
        role: "user",
        content: [{ type: "text", text: input.label }],
      },
    ],
    semanticIdentity: (input) => ({
      weight: input.weight,
      label: input.label,
    }),
  });
}

describe("inference definitions and registry", () => {
  it("preserves schema-derived input and output types", () => {
    const definition = createDefinition();

    expectTypeOf<InferJobInput<typeof definition>>().toEqualTypeOf<{
      label: string;
      weight: number;
    }>();
    expectTypeOf<InferJobOutput<typeof definition>>().toEqualTypeOf<{
      score: number;
    }>();
    expect(definition.config.maxRetries).toBe(2);
    expect(definition.instructions).toBe("Score the supplied label.");
    expect(Object.isFrozen(definition)).toBe(true);
    expect(Object.isFrozen(definition.config)).toBe(true);
    expect(() => {
      Object.assign(definition.config, { model: "mutated-model" });
    }).toThrow(TypeError);
    expect(definition.config.model).toBe("test-model");
  });

  it.each([
    ["job type", () => createDefinition().jobType],
    ["definition version", () => createDefinition().definitionVersion],
  ])("constructs a valid %s", (_name, value) => {
    expect(value()).toBeTruthy();
  });

  it("rejects invalid names, versions, and unsupported configuration", () => {
    const base = {
      inputSchema,
      outputSchema,
      outputName: "test_score",
      buildMessages: () => [],
      semanticIdentity: () => ({}),
    };

    expect(() =>
      defineInferenceJob({
        ...base,
        jobType: "Not Valid",
        definitionVersion: 1,
        config: { provider: "google", model: "test" },
      }),
    ).toThrow();
    expect(() =>
      defineInferenceJob({
        ...base,
        jobType: `a${"b".repeat(63)}`,
        definitionVersion: 1,
        config: { provider: "google", model: "test" },
      }),
    ).toThrow();
    expect(() =>
      defineInferenceJob({
        ...base,
        jobType: "valid_name",
        definitionVersion: 0,
        config: { provider: "google", model: "test" },
      }),
    ).toThrow();
    expect(() =>
      defineInferenceJob({
        ...base,
        jobType: "valid_name",
        definitionVersion: 1,
        config: { provider: "google", model: "test" },
        instructions: "   ",
      }),
    ).toThrow();
    expect(() =>
      inferenceConfigSchema.parse({
        provider: "google",
        model: "test",
        cacheMode: "read-write",
      }),
    ).toThrow();
    expect(() =>
      inferenceConfigSchema.parse({
        provider: "litellm",
        model: "test",
      }),
    ).toThrow();
  });

  it("rejects duplicate job types and resolves exact versions", () => {
    const definition = createDefinition();
    const registry = new InferenceJobRegistry();
    registry.register(definition);

    expect(registry.listJobTypes()).toEqual(["test_score"]);
    expect(registry.resolve("test_score", 1)).toBe(definition);
    expect(() => registry.register(createDefinition(2))).toThrow(
      DuplicateInferenceJobTypeError,
    );
    expect(() => registry.resolve("test_score", 2)).toThrow(
      UnknownInferenceJobDefinitionError,
    );
    expect(() => registry.resolve("missing")).toThrow(
      UnknownInferenceJobDefinitionError,
    );
  });
});

describe("canonical JSON and semantic keys", () => {
  it("canonicalizes object keys recursively without reordering arrays", () => {
    const normalized = normalizeJsonValue({
      z: [{ b: 2, a: 1 }],
      a: true,
      omitted: undefined,
    });

    expect(canonicalizeJson(normalized)).toBe('{"a":true,"z":[{"a":1,"b":2}]}');
    expect(() => normalizeJsonValue(Number.NaN)).toThrow("non-finite number");
    expect(() => normalizeJsonValue([undefined])).toThrow("undefined");
  });

  it("produces a stable SHA-256 key and changes it for semantic changes", () => {
    const definition = createDefinition();
    const first = { label: "calm", weight: 0.5 };
    const equivalent = { weight: 0.5, label: "calm" };

    const firstKey = createSemanticIdempotencyKey(definition, first);
    expect(firstKey).toMatch(/^[0-9a-f]{64}$/);
    expect(createSemanticIdempotencyKey(definition, equivalent)).toBe(firstKey);
    expect(
      createSemanticIdempotencyKey(definition, {
        label: "calm",
        weight: 0.6,
      }),
    ).not.toBe(firstKey);
    expect(createSemanticIdempotencyKey(createDefinition(2), first)).not.toBe(
      firstKey,
    );
    expect(semanticKeyMaterial(definition, first)).toEqual({
      jobType: "test_score",
      definitionVersion: 1,
      identity: { label: "calm", weight: 0.5 },
    });
  });
});
