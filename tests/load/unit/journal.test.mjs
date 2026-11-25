import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openJournal } from "../operator/journal.mjs";

test("atomic private journal recovers write-ahead identity and rejects changed target", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sole-load-"));
  try {
    const plan = { runId: "run-one", targetDigest: "a".repeat(64) };
    const journal = await openJournal(plan, dir);
    await journal.intent("account", "one", {
      id: "stable-id",
      password: "private-secret",
    });
    const recovered = await openJournal(plan, dir);
    assert.equal(recovered.records()[0].data.id, "stable-id");
    await recovered.commit("account", "one", { email: "synthetic@test.invalid" });
    assert.equal(
      JSON.parse(await readFile(join(dir, "journal.json"), "utf8")).entries.length,
      1,
    );
    await assert.rejects(
      openJournal({ ...plan, targetDigest: "b".repeat(64) }, dir),
      /identity/,
    );
    await assert.rejects(
      recovered.intent("account", "one", { id: "foreign" }),
      /identity/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
