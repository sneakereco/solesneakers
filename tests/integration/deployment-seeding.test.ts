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

  it.each([
    ["staging", stagingWorkflow],
    ["production", productionWorkflow],
  ])(
    "maps and validates the public site URL before the %s build",
    (_environment, workflow) => {
      expect(workflow).toContain(
        "NEXT_PUBLIC_SITE_URL: ${{ vars.NEXT_PUBLIC_SITE_URL || secrets.NEXT_PUBLIC_SITE_URL }}",
      );
      expect(workflow).toContain(
        "Invalid NEXT_PUBLIC_SITE_URL: expected an absolute http(s) URL",
      );
      expect(workflow.indexOf("Invalid NEXT_PUBLIC_SITE_URL")).toBeLessThan(
        workflow.indexOf("- name: Build"),
      );
    },
  );

  it.each([
    ["staging", stagingWorkflow],
    ["production", productionWorkflow],
  ])(
    "passes and validates browser payment configuration before the %s build",
    (_environment, workflow) => {
      expect(workflow).toContain(
        "SQUARE_APPLICATION_ID: ${{ vars.SQUARE_APPLICATION_ID || secrets.SQUARE_APPLICATION_ID }}",
      );
      expect(workflow).toContain(
        "NEXT_PUBLIC_TURNSTILE_SITE_KEY: ${{ vars.NEXT_PUBLIC_TURNSTILE_SITE_KEY || secrets.NEXT_PUBLIC_TURNSTILE_SITE_KEY }}",
      );
      expect(workflow).toContain(
        "TURNSTILE_SECRET_KEY: ${{ secrets.TURNSTILE_SECRET_KEY }}",
      );
      expect(workflow).toContain('[[ -n "$SQUARE_APPLICATION_ID" ]]');
      expect(workflow).toContain('[[ -n "$NEXT_PUBLIC_TURNSTILE_SITE_KEY" ]]');
      expect(workflow).toContain('[[ -n "$TURNSTILE_SECRET_KEY" ]]');
      expect(workflow.indexOf('[[ -n "$SQUARE_APPLICATION_ID" ]]')).toBeLessThan(
        workflow.indexOf("- name: Build"),
      );
    },
  );
});
