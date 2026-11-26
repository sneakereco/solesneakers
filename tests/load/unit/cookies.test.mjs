import test from "node:test";
import assert from "node:assert/strict";
import { browserCookies } from "../browser/cookies.mjs";
test("real SSR cookie flags remain readable to the browser auth client when issued that way", () => {
  const values = browserCookies(
    [
      {
        name: "sb-auth",
        value: "private",
        options: { httpOnly: false, sameSite: "lax", path: "/" },
      },
    ],
    "https://staging.test",
  );
  assert.equal(values[0].httpOnly, false);
  assert.equal(values[0].sameSite, "Lax");
  assert.equal(values[0].secure, true);
  assert.equal(values[0].url, "https://staging.test");
});
