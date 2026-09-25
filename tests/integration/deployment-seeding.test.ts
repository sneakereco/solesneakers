import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const seed = readFileSync(resolve("supabase/seed.sql"), "utf8");
const ciWorkflow = readFileSync(resolve(".github/workflows/ci.yml"), "utf8");

function job(workflow: string, name: string): string {
  const match = workflow.match(
    new RegExp(`^  ${name}:\\r?\\n([\\s\\S]*?)(?=^  [\\w-]+:|$(?![\\s\\S]))`, "m"),
  );
  expect(match).not.toBeNull();
  return match![1];
}

describe("deployment configuration", () => {
  it("accepts stable, alpha, and beta production tags with canonical version numbers", () => {
    const workflow = readFileSync(resolve(".github/workflows/production.yml"), "utf8");
    const pattern = workflow.match(/"\$GITHUB_REF_NAME" =~ (\S+) \]\]/)?.[1];
    expect(pattern).toBeDefined();
    const releaseTag = new RegExp(pattern!);
    for (const tag of [
      "v0.0.0",
      "v1.2.3",
      "v12.34.56",
      "v1.0.0-alpha.0",
      "v1.0.0-alpha.1",
      "v1.0.0-beta.1",
      "v1.0.0-beta.12",
    ]) {
      expect({ tag, accepted: releaseTag.test(tag) }).toEqual({ tag, accepted: true });
    }
    for (const tag of [
      "1.2.3",
      "v1.2",
      "v01.2.3",
      "v1.02.3",
      "v1.2.03",
      "v1.2.3-beta",
      "v1.2.3-beta.01",
      "v1.2.3-alpha.-1",
      "v1.2.3-rc.1",
      "v1.2.3-BETA.1",
      "v1.2.3-beta.1.extra",
      "v1.2.3+build.1",
    ]) {
      expect({ tag, accepted: releaseTag.test(tag) }).toEqual({ tag, accepted: false });
    }
  });

  it("builds remote source without requiring the local Doppler CLI", () => {
    const config = JSON.parse(readFileSync(resolve("vercel.json"), "utf8"));
    expect(config.buildCommand).toBe("next build");
  });

  it("keeps the local seed's legacy tenant rename and bootstrap", () => {
    expect(seed).toContain("set name = 'Solesneakers'");
    expect(seed).toContain("where name = 'Realdealkickzsc'");
    expect(seed).toContain("select 'Solesneakers'");
  });

  it.each(["staging", "production"])(
    "gates %s source deployment on migrations and checks deployed readiness",
    (environment) => {
      const workflow = readFileSync(
        resolve(`.github/workflows/${environment}.yml`),
        "utf8",
      );
      const migrate = job(workflow, "migrate");
      const deploy = job(workflow, "deploy");
      const verify = job(workflow, "verify");
      expect(migrate).toContain(
        `needs: ${environment === "production" ? "validate-release" : "validate"}`,
      );
      expect(migrate).toContain('supabase db push --db-url "$SUPABASE_DB_URL" --dry-run');
      expect(migrate).toMatch(/supabase db push --db-url "\$SUPABASE_DB_URL"\r?\n/);
      expect(deploy).toContain("needs: migrate");
      expect(deploy).toContain('deploy --prod --yes --token="$VERCEL_TOKEN"');
      expect(deploy).toContain(
        'echo "deployment_url=$deployment_url" >> "$GITHUB_OUTPUT"',
      );
      expect(verify).toContain("needs: deploy");
      expect(verify).toContain("${{ needs.deploy.outputs.deployment_url }}");
      expect(verify).toContain('"$DEPLOYMENT_URL/api/readyz"');
      expect(verify.trim()).toMatch(/exit 1$/);
    },
  );

  it.each(["staging", "production"])(
    "injects environment-scoped Doppler secrets before %s migration and deployment",
    (environment) => {
      const workflow = readFileSync(
        resolve(`.github/workflows/${environment}.yml`),
        "utf8",
      );
      for (const [name, command] of [
        ["migrate", "supabase db push"],
        ["deploy", "vercel@"],
      ]) {
        const section = job(workflow, name);
        expect(section).toContain(`environment: ${environment}`);
        expect(section).toContain("uses: dopplerhq/secrets-fetch-action@");
        expect(section).toContain("doppler-token: ${{ secrets.DOPPLER_TOKEN }}");
        expect(section).toContain("inject-env-vars: true");
        expect(section.indexOf("inject-env-vars: true")).toBeLessThan(
          section.indexOf(command),
        );
      }
    },
  );

  it("builds PRs with schema-valid placeholders and no deployment credentials", () => {
    const envBlock = ciWorkflow.split("    env:")[1].split("    steps:")[0];
    const placeholders = Object.fromEntries(
      [...envBlock.matchAll(/^      ([A-Z_]+): (.+)$/gm)].map(([, key, value]) => [
        key,
        value.trim(),
      ]),
    );
    jest.replaceProperty(process, "env", { ...placeholders, NODE_ENV: "production" });
    try {
      jest.isolateModules(() => {
        expect(() => jest.requireActual("../../src/config/env")).not.toThrow();
      });
    } finally {
      jest.restoreAllMocks();
    }
    expect(ciWorkflow).toContain("run: npx next build");
    expect(ciWorkflow).not.toContain("secrets.");
    expect(ciWorkflow).not.toContain("doppler");
  });
});
