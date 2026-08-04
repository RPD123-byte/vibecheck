import { defineConfig } from "@trigger.dev/sdk";

const project = process.env.TRIGGER_PROJECT_REF?.trim();

if (project === undefined || project.length === 0) {
  throw new Error("TRIGGER_PROJECT_REF is required by trigger.config.ts");
}

export default defineConfig({
  project,
  runtime: "node-22",
  dirs: ["./src/trigger"],
  tsconfig: "./tsconfig.json",
  maxDuration: 300,
  retries: {
    enabledInDev: true,
  },
});
