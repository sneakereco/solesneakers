import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runMigrationDeployment } from "../../scripts/single-store/deploy-migrations.mjs";

const files = ["supabase/migrations/20261127040000_checkout_authority.sql"];
const plan = {
  head: "a".repeat(40),
  inventoryDigest: "b".repeat(64),
  recordedDigest: "c".repeat(64),
  databaseFingerprint: "d".repeat(64),
  includeAll: true,
  pendingFiles: files,
};
const report = (migrationPlan = plan) => ({
  ready: true,
  pendingCount: migrationPlan.pendingFiles.length,
  blockers: [],
  migrationPlan,
});
const preview = (migrations = files.map((file) => file.split("/").at(-1))) =>
  JSON.stringify({ dryRun: true, migrations, seeds: [], roles: [] });

async function fixture(callback) {
  const directory = await mkdtemp(join(tmpdir(), "migration-deployment-"));
  try {
    await callback(join(directory, "plan.json"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("preview saves a credential-free plan and apply verifies the completed ledger", async () => {
  await fixture(async (planPath) => {
    const calls = [];
    const runCli = async (args) => {
      calls.push(args);
      return args.includes("--version")
        ? "2.117.0\n"
        : args.includes("--dry-run")
          ? preview()
          : JSON.stringify({ migrations: files });
    };
    const options = {
      planPath,
      connectionString: "postgres://user:secret@db/app",
      runCli,
    };
    await runMigrationDeployment({
      ...options,
      phase: "preview",
      check: async () => report(),
    });
    const saved = await readFile(planPath, "utf8");
    assert.equal(saved.includes("secret"), false);
    assert.deepEqual(JSON.parse(saved).migrationPlan, plan);
    let reads = 0;
    const result = await runMigrationDeployment({
      ...options,
      phase: "apply",
      check: async () =>
        report(
          ++reads <= 2
            ? plan
            : {
                ...plan,
                recordedDigest: "e".repeat(64),
                includeAll: false,
                pendingFiles: [],
              },
        ),
    });
    assert.equal(result.pendingCount, 0);
    const pushes = calls.filter((args) => args[0] === "db");
    assert.equal(pushes.length, 3);
    for (const args of pushes) {
      assert.ok(args.includes("--include-all"));
      assert.ok(args.includes("--skip-vault"));
      assert.ok(args.includes("--output-format"));
    }
    assert.equal(pushes.at(-1).includes("--dry-run"), false);
  });
});

test("ordinary prefix never opts into include-all", async () => {
  await fixture(async (planPath) => {
    await runMigrationDeployment({
      phase: "preview",
      planPath,
      connectionString: "postgres://user:secret@db/app",
      check: async () => report({ ...plan, includeAll: false }),
      runCli: async (args) => {
        assert.equal(args.includes("--include-all"), false);
        return args.includes("--version") ? "2.117.0" : preview();
      },
    });
  });
});

for (const [name, output] of [
  [
    "extra migration",
    preview([...files.map((f) => f.split("/").at(-1)), "20261127041000_extra.sql"]),
  ],
  ["missing migration", preview([])],
  [
    "duplicate migration",
    preview([
      "20261127040000_checkout_authority.sql",
      "20261127040000_checkout_authority.sql",
    ]),
  ],
  [
    "vault or seed payload",
    JSON.stringify({ dryRun: true, migrations: files, seeds: ["seed.sql"], roles: [] }),
  ],
  ["non-preview payload", JSON.stringify({ migrations: files, seeds: [], roles: [] })],
  ["unparseable output", "unexpected CLI output"],
]) {
  test(`preview refuses ${name}`, async () => {
    await fixture(async (planPath) => {
      await assert.rejects(
        runMigrationDeployment({
          phase: "preview",
          planPath,
          connectionString: "postgres://user:secret@db/app",
          check: async () => report(),
          runCli: async (args) => (args.includes("--version") ? "2.117.0" : output),
        }),
        /migration_preview_mismatch/,
      );
      await assert.rejects(readFile(planPath), { code: "ENOENT" });
    });
  });
}

for (const key of [
  "head",
  "inventoryDigest",
  "recordedDigest",
  "databaseFingerprint",
  "includeAll",
  "pendingFiles",
]) {
  test(`apply blocks a stale ${key} before any migration command`, async () => {
    await fixture(async (planPath) => {
      const runCli = async (args) => (args.includes("--version") ? "2.117.0" : preview());
      const options = {
        planPath,
        connectionString: "postgres://user:secret@db/app",
        runCli,
      };
      await runMigrationDeployment({
        ...options,
        phase: "preview",
        check: async () => report(),
      });
      const changed = {
        ...plan,
        [key]:
          key === "includeAll"
            ? false
            : key === "pendingFiles"
              ? []
              : "f".repeat(key === "head" ? 40 : 64),
      };
      await assert.rejects(
        runMigrationDeployment({
          ...options,
          phase: "apply",
          check: async () => report(changed),
          runCli: async () => {
            assert.fail("stale plan reached CLI");
          },
        }),
        /migration_plan_stale/,
      );
    });
  });
}

test("wrong CLI version and blocked baseline never reach a migration preview", async () => {
  await fixture(async (planPath) => {
    const options = {
      phase: "preview",
      planPath,
      connectionString: "postgres://user:secret@db/app",
    };
    await assert.rejects(
      runMigrationDeployment({
        ...options,
        check: async () => report(),
        runCli: async () => "3.4.0",
      }),
      /migration_cli_version_mismatch/,
    );
    await assert.rejects(
      runMigrationDeployment({
        ...options,
        check: async () => ({ ready: false, blockers: ["prefix_gap"] }),
        runCli: async () => {
          assert.fail("blocked baseline reached CLI");
        },
      }),
      /migration_baseline_blocked/,
    );
  });
});

test("apply repeats exact preview and rejects an incomplete post-apply ledger", async () => {
  await fixture(async (planPath) => {
    let applied = 0;
    const runCli = async (args) => {
      if (args.includes("--version")) return "2.117.0";
      if (args.includes("--dry-run")) return preview();
      applied++;
      return "{}";
    };
    const options = {
      planPath,
      connectionString: "postgres://user:secret@db/app",
      check: async () => report(),
      runCli,
    };
    await runMigrationDeployment({ ...options, phase: "preview" });
    await assert.rejects(
      runMigrationDeployment({ ...options, phase: "apply" }),
      /migration_postcheck_failed/,
    );
    assert.equal(applied, 1);
    applied = 0;
    await assert.rejects(
      runMigrationDeployment({
        ...options,
        phase: "apply",
        runCli: async (args) => (args.includes("--version") ? "2.117.0" : preview([])),
      }),
      /migration_preview_mismatch/,
    );
    assert.equal(applied, 0);
  });
});

for (const key of ["inventoryDigest", "recordedDigest", "head"]) {
  test(`apply refuses ${key} drift during the dry run before mutation`, async () => {
    await fixture(async (planPath) => {
      let changed = false;
      let mutations = 0;
      const options = {
        planPath,
        connectionString: "postgres://user:secret@db/app",
        check: async () =>
          report(
            changed ? { ...plan, [key]: "f".repeat(key === "head" ? 40 : 64) } : plan,
          ),
        runCli: async (args) => {
          if (args.includes("--version")) return "2.117.0";
          if (args.includes("--dry-run")) {
            changed = true;
            return preview();
          }
          mutations++;
          return "{}";
        },
      };
      await runMigrationDeployment({ ...options, phase: "preview" });
      changed = false;
      await assert.rejects(
        runMigrationDeployment({ ...options, phase: "apply" }),
        /migration_plan_stale/,
      );
      assert.equal(mutations, 0);
    });
  });
}
