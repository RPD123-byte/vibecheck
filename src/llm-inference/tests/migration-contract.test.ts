import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL(
    "../../../supabase/migrations/20260804000000_create_llm_inference_jobs.sql",
    import.meta.url,
  ),
);

async function readMigration(): Promise<string> {
  return readFile(migrationPath, "utf8");
}

describe("LLM inference migration contract", () => {
  it("creates only the two scoped governance tables", async () => {
    const sql = await readMigration();
    const tableNames = [...sql.matchAll(/create table\s+([\w.]+)/giu)].map(
      (match) => match[1],
    );

    expect(tableNames).toEqual([
      "public.llm_inference_job_types",
      "public.llm_inference_jobs",
    ]);
    expect(sql).toContain("'valence_arousal_label'");
  });

  it("keeps the job record minimal and free of excluded storage", async () => {
    const sql = await readMigration();
    const jobsTable = sql.match(
      /create table public\.llm_inference_jobs \(([\s\S]*?)\n\);/u,
    )?.[1];

    expect(jobsTable).toBeDefined();
    expect(jobsTable).not.toMatch(
      /^\s*(?:attempt|input_tokens|output_tokens|cost_usd|latency_ms|started_at|completed_at|claim_token)\b/gimu,
    );
    expect(sql).not.toMatch(
      /create table\s+[^\s(]*(?:emotion|click|gaze|video|display|outbox|attempt)[^\s(]*/giu,
    );
  });

  it("enforces identity, lifecycle, output, and bounded-error constraints", async () => {
    const sql = await readMigration();

    expect(sql).toMatch(/definition_version > 0/u);
    expect(sql).toContain("^[0-9a-f]{64}$");
    expect(sql).toMatch(/unique \(semantic_idempotency_key\)/u);
    expect(sql).toContain(
      "status in ('queued', 'running', 'completed', 'failed')",
    );
    expect(sql).toMatch(
      /char_length\(btrim\(error_message\)\) between 1 and 2048/u,
    );
    expect(sql).toMatch(/status = 'completed'[\s\S]*output is not null/u);
    expect(sql).toMatch(/status = 'failed'[\s\S]*error_message is not null/u);
  });

  it("defines atomic RPCs and optimistic claim-version checks", async () => {
    const sql = await readMigration();
    const expectedFunctions = [
      "create_or_get_llm_inference_job",
      "requeue_failed_llm_inference_job",
      "claim_llm_inference_job",
      "complete_llm_inference_job",
      "fail_llm_inference_job",
      "attach_llm_inference_trigger_run",
    ];

    for (const functionName of expectedFunctions) {
      expect(sql).toContain(`create function public.${functionName}`);
      expect(sql).toContain(`grant execute on function public.${functionName}`);
    }

    expect(sql).toMatch(
      /complete_llm_inference_job[\s\S]*status = 'running'[\s\S]*updated_at = p_claimed_updated_at/u,
    );
    expect(sql).toMatch(
      /fail_llm_inference_job[\s\S]*status = 'running'[\s\S]*updated_at = p_claimed_updated_at/u,
    );
    expect(sql).toMatch(
      /p_claimed_updated_at is null[\s\S]*status = 'queued'[\s\S]*trigger_run_id is null/u,
    );
  });

  it("uses a server-only RLS and function-permission posture", async () => {
    const sql = await readMigration();

    expect(sql).toContain(
      "alter table public.llm_inference_job_types enable row level security",
    );
    expect(sql).toContain(
      "alter table public.llm_inference_jobs enable row level security",
    );
    expect(sql).not.toMatch(/create policy/giu);
    expect(sql).toContain(
      "revoke all on table public.llm_inference_jobs from public, anon, authenticated, service_role",
    );
    expect(sql).toContain(
      "grant select on table public.llm_inference_jobs to service_role",
    );
    expect(sql).toMatch(/security definer[\s\S]*set search_path = ''/u);
  });
});
