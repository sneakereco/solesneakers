import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const seed = readFileSync(resolve("supabase/seed.sql"), "utf8");
const stagingWorkflow = readFileSync(resolve(".github/workflows/staging.yml"), "utf8");
const productionWorkflow = readFileSync(
  resolve(".github/workflows/production.yml"),
  "utf8",
);

describe("deployment reference-data seeding", () => {
  it("renames the legacy tenant and bootstraps Solesneakers", () => {
    expect(seed).toContain("set name = 'Solesneakers'");
    expect(seed).toContain("where name = 'Realdealkickzsc'");
    expect(seed).toContain("select 'Solesneakers'");
  });

  it.each([
    ["staging", stagingWorkflow],
    ["production", productionWorkflow],
  ])("seeds %s before building and fails on SQL errors", (_environment, workflow) => {
    const seedStep = workflow.indexOf("-v ON_ERROR_STOP=1");
    const buildStep = workflow.indexOf("- name: Build");

    expect(seedStep).toBeGreaterThan(-1);
    expect(buildStep).toBeGreaterThan(seedStep);
    expect(workflow).toContain("Seed verification failed: missing taxonomy data");
  });
});
