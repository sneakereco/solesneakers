import test from "node:test";
import assert from "node:assert/strict";
import { enrollTarget } from "../operator/enroll.mjs";
import { targetFixture } from "./fixtures.mjs";
import { manifestDigest } from "../shared/contracts.mjs";
test("immutable staging enrollment resolves only known markers and rejects production before a request", async () => {
  const source = targetFixture(),
    template = {
      ...source,
      baseUrl: "$VERCEL_URL",
      expected: {
        ...source.expected,
        commit: "$VERCEL_GIT_COMMIT_SHA",
        deploymentId: "$VERCEL_DEPLOYMENT_ID",
      },
    },
    attestation = {
      ...source.expected,
      baseUrl: source.baseUrl,
      resourceDigest: manifestDigest(source.resources),
      schema: source.migrationHeads,
      providerMode: source.providerMode,
      capabilities: ["shopping"],
    };
  const result = await enrollTarget(
    template,
    source.baseUrl,
    source.expected.commit,
    async () => attestation,
  );
  assert.equal(result.expected.deploymentId, source.expected.deploymentId);
  await assert.rejects(
    enrollTarget(
      template,
      "https://www.production.example.test",
      source.expected.commit,
      () => assert.fail("production request"),
    ),
  );
  await assert.rejects(
    enrollTarget(template, source.baseUrl, "b".repeat(40), async () => attestation),
    /attestation/,
  );
});
