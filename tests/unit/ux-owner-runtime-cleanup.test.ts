import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readdirSync,
  rmSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";

it.each(["copy", "hash"])(
  "removes its partial recovery runtime after a %s failure",
  (phase) => {
    const parent = realpathSync(tmpdir());
    const root = mkdtempSync(join(parent, "ux-setup-check-"));
    try {
      mkdirSync(join(root, "src"));
      if (phase === "hash") {
        mkdirSync(join(root, "node_modules"));
        for (const name of [
          "package.json",
          "next.config.ts",
          "tsconfig.json",
          "next-env.d.ts",
          "postcss.config.js",
          "tailwind.config.ts",
        ])
          writeFileSync(join(root, name), "{}");
      }
      const run = spawnSync(
        process.execPath,
        [resolve("tests/browser/ux-local-recovery-owner.mjs")],
        {
          cwd: root,
          windowsHide: true,
          encoding: "utf8",
          env: {
            ...process.env,
            NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:64331",
            SUPABASE_SECRET_KEY: "unused-local-setup-fixture",
          },
        },
      );
      expect(run.status).toBe(1);
      expect(run.stderr).toContain(phase === "copy" ? "package.json" : "route.ts");
      expect(
        readdirSync(join(root, "test-results", "ux-implementation")).filter((name) =>
          name.startsWith("ownership-runtime-"),
        ),
      ).toEqual([]);
      if (phase === "hash") expect(readdirSync(join(root, "node_modules"))).toEqual([]);
    } finally {
      if (dirname(realpathSync(root)) !== parent)
        throw Error("Unexpected setup fixture path");
      rmSync(root, { recursive: true, force: true });
    }
  },
);
