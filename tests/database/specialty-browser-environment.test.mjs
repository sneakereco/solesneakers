import assert from "node:assert/strict";
import { test } from "node:test";
import { assertBrowserTestTarget } from "../browser/fixtures/specialty-claims.mjs";
const database =
  "postgresql://postgres:postgres@127.0.0.1:64332/specialty_test_native_20261125";
test("browser fixture refuses hosted origins and ordinary databases before starting services", () => {
  for (const origin of [
    "https://solesneakers.com",
    "https://staging.example.com",
    "http://localhost:3000/path",
    "http://user:pass@localhost:3000",
    "http://localhost:80",
  ]) {
    assert.throws(() => assertBrowserTestTarget(origin, database));
  }
  assert.throws(() =>
    assertBrowserTestTarget(
      "http://localhost:3000",
      database.replace("specialty_test_native_20261125", "postgres"),
    ),
  );
  assert.throws(() =>
    assertBrowserTestTarget(
      "http://localhost:3000",
      database.replace("127.0.0.1", "production.example.com"),
    ),
  );
});
test("browser fixture allows an explicit local origin and a disposable database namespace", () => {
  assert.doesNotThrow(() => assertBrowserTestTarget("http://localhost:3000", database));
});
