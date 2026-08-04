import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { describe, expect, expectTypeOf, it } from "vitest";

import {
  SUPPORTED_INFERENCE_JOB_TYPES,
  createInferenceJobRegistry,
  enqueueInference,
  runInferenceDirect,
  valenceArousalLabelDefinition,
  type SupportedInferenceJobType,
} from "../src";
import { defineInferenceJob } from "../src/core/definition";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const electronRoot = path.join(repositoryRoot, "src/electron");

async function sourceFiles(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.name !== "node_modules" &&
          entry.name !== "out" &&
          entry.name !== "dist",
      )
      .map(async (entry) => {
        const absolutePath = path.join(directory, entry.name);
        if (entry.isDirectory()) return sourceFiles(absolutePath);
        return /\.(?:c|m)?(?:j|t)sx?$|\.json$/u.test(entry.name)
          ? [absolutePath]
          : [];
      }),
  );
  return nested.flat();
}

describe("public inference API", () => {
  it("publishes the registered operation catalog without duplicate state", () => {
    const registry = createInferenceJobRegistry();

    expect(SUPPORTED_INFERENCE_JOB_TYPES).toEqual(["valence_arousal_label"]);
    expectTypeOf<SupportedInferenceJobType>().toEqualTypeOf<"valence_arousal_label">();
    expect(registry.listJobTypes()).toEqual(SUPPORTED_INFERENCE_JOB_TYPES);
    expect(registry.resolve("valence_arousal_label", 1)).toBe(
      valenceArousalLabelDefinition,
    );
  });

  it("exports distinct direct and durable production entry points", () => {
    expect(runInferenceDirect).toBeTypeOf("function");
    expect(enqueueInference).toBeTypeOf("function");
    expect(runInferenceDirect).not.toBe(enqueueInference);
  });

  it("rejects malformed public input before requiring server credentials", async () => {
    await expect(
      runInferenceDirect(valenceArousalLabelDefinition, {
        target: null,
        anchors: [],
      } as never),
    ).rejects.toThrow();
    await expect(
      enqueueInference(valenceArousalLabelDefinition, {
        target: null,
        anchors: [],
      } as never),
    ).rejects.toThrow();
  });

  it("rejects a spoofed definition before persistence or provider setup", async () => {
    const spoofed = defineInferenceJob({
      jobType: "valence_arousal_label",
      definitionVersion: 1,
      inputSchema: valenceArousalLabelDefinition.inputSchema,
      outputSchema: valenceArousalLabelDefinition.outputSchema,
      config: { provider: "google", model: "different-model" },
      outputName: "valence_arousal_label",
      buildMessages: () => [
        { role: "user", content: [{ type: "text", text: "spoofed" }] },
      ],
      semanticIdentity: () => ({ spoofed: true }),
    });
    const validInput = valenceArousalLabelDefinition.inputSchema.parse({
      target: {
        url: "https://example.test/target.png",
        sha256: "a".repeat(64),
        mediaType: "image/png",
      },
      anchors: [
        {
          image: {
            url: "https://example.test/anchor.png",
            sha256: "b".repeat(64),
            mediaType: "image/png",
          },
          valence: 0,
          arousal: 0,
        },
      ],
    });

    await expect(runInferenceDirect(spoofed, validInput)).rejects.toThrow(
      "not the registered catalog object",
    );
  });
});

describe("Electron isolation", () => {
  it("keeps the server package and credentials out of Electron source", async () => {
    const files = await sourceFiles(electronRoot);
    const contents = await Promise.all(
      files.map((file) => readFile(file, "utf8")),
    );
    const combined = contents.join("\n");

    expect(combined).not.toContain("@vibecheck/llm-inference");
    expect(combined).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(combined).not.toContain("@supabase/supabase-js");
    expect(combined).not.toContain("@trigger.dev/sdk");

    const electronPackage = JSON.parse(
      await readFile(path.join(electronRoot, "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    expect(electronPackage.dependencies).not.toHaveProperty(
      "@vibecheck/llm-inference",
    );
  });
});
