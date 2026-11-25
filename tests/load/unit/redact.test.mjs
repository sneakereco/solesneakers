import assert from "node:assert/strict";
import test from "node:test";
import { redactArtifact } from "../shared/redact.mjs";
test("shared report reasons remain arrays while actual cycles are scrubbed", () => {
  const reasons = ["slow operation"],
    input = { first: reasons, second: reasons };
  input.self = input;
  const output = redactArtifact(input);
  assert.deepEqual(output.first, reasons);
  assert.deepEqual(output.second, reasons);
  assert.equal(output.self, "[CIRCULAR]");
});
test("database URI credentials and arbitrary stack fields cannot enter exported artifacts", () => {
  const output = JSON.stringify(
    redactArtifact({
      stack: "private-stack",
      url: "postgresql://admin:private-password@db.test/catalog",
    }),
  );
  assert.ok(!output.includes("private-stack"));
  assert.ok(!output.includes("private-password"));
});
test("redact tokens nested in URLs/errors without deleting useful operation evidence", () => {
  const result = redactArtifact({
    operation: "order_poll",
    count: 5,
    nested: {
      authorization: "Bearer credential",
      cookie: "session=private",
      url: "https://load.example.test/api/orders/id?token=secret&reconcile=1",
      error:
        "GET /orders/id?guestAccessToken=another-secret failed; Authorization: Bearer credential",
    },
  });
  const output = JSON.stringify(result);
  for (const secret of [
    "credential",
    "session=private",
    "another-secret",
    "token=secret",
  ])
    assert.equal(output.includes(secret), false);
  assert.equal(result.count, 5);
  assert.equal(result.operation, "order_poll");
  assert.match(result.nested.url, /reconcile=1/);
});
test("PII, credentials, cyclic failures and error stacks are safe to export", () => {
  const input = {
    email: "someone@example.test",
    address: { line1: "1 Private St" },
    password: "pw",
    safe: 3,
    error: new Error("request ?token=secret failed"),
  };
  input.self = input;
  const result = redactArtifact(input);
  assert.equal(result.safe, 3);
  for (const secret of ["someone@", "Private St", '"pw"', "token=secret"])
    assert.equal(JSON.stringify(result).includes(secret), false);
});
test("scoped harness credentials and signing material are never public report fields", () => {
  const output = JSON.stringify(
    redactArtifact({
      headers: { "x-load-test-credential": "phase-secret" },
      signingKey: "root-secret",
    }),
  );
  assert.equal(output.includes("phase-secret"), false);
  assert.equal(output.includes("root-secret"), false);
});
