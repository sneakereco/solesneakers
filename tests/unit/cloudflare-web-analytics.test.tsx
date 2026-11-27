import { execFileSync } from "node:child_process";
it.each(["production", "development"] as const)(
  "does not emit a configured analytics beacon without consent in %s",
  (environment) => {
    const markup = execFileSync(
      process.execPath,
      ["--require", "tsx/cjs", "tests/fixtures/render-optional-beacon.ts"],
      { encoding: "utf8", env: { ...process.env, NODE_ENV: environment } },
    );
    expect(markup).toBe("");
  },
);
