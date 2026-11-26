import type { CaptureResult } from "posthog-js";
import { filterOutgoingEvent } from "@/Modules/Analytics/Source/Features/VisitorMeasurement/client";
import { readPublicAnalyticsConfig } from "@/Modules/Analytics/Source/Features/Configuration/public-config";
import { validEnv } from "../Configuration/config-fixture";
const config = readPublicAnalyticsConfig(validEnv)!;
const uuid = "01990f14-c5f9-7bc8-9d22-f560a81f2381";
const base: CaptureResult = {
  event: "checkout_started",
  uuid,
  properties: {
    token: config.projectKey,
    distinct_id: uuid,
    $session_id: uuid,
    environment: "staging",
    storefront: "sole",
    schema_version: 2,
    pathname: "/checkout",
  },
};
it.each([
  { distinct_id: "not-a-uuid" },
  { distinct_id: "sole-buyer:v1:abc" },
  { $session_id: "invalid" },
  { token: "other" },
  { environment: "production" },
  { pathname: "/checkout?email=person@example.com" },
])("rejects invalid outgoing correlation and scope %p", (properties) => {
  expect(
    filterOutgoingEvent(
      { ...base, properties: { ...base.properties, ...properties } },
      config,
    ),
  ).toBeNull();
});
it("drops anonymous-to-anonymous or identified-to-identified merge controls", () => {
  for (const [to, from] of [
    [uuid, uuid],
    ["sole-buyer:v1:" + "b".repeat(64), "sole-buyer:v1:" + "a".repeat(64)],
  ]) {
    expect(
      filterOutgoingEvent(
        {
          ...base,
          event: "$identify",
          properties: { ...base.properties, distinct_id: to, $anon_distinct_id: from },
        },
        config,
      ),
    ).toBeNull();
  }
});
