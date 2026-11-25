import assert from "node:assert/strict";
import test from "node:test";
import { redactArtifact } from "../shared/redact.mjs";
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
