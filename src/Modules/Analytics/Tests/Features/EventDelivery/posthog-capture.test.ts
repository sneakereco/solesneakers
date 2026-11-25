import { readServerAnalyticsConfig } from "../../../Source/Features/Configuration/server-config";
import {
  captureBatch,
  type PublishedEvent,
} from "../../../Source/Features/EventDelivery/posthog-capture";

import {
  mockFetch,
  now,
  privateQueryKey,
  publicProjectKey,
  validEnv,
} from "../Configuration/config-fixture";

jest.mock("server-only", () => ({}), { virtual: true });

const factId = "03b07c49-2b23-47e5-ac65-8bbc51226520";
const fact: PublishedEvent = {
  uuid: "d9dedef0-f51b-403d-a3f9-27c40820edea",
  event: "sole_analytics_fact_v2",
  timestamp: "2026-11-24T22:05:46.000Z",
  distinctId: `commerce:${factId}`,
  properties: {
    schema_version: 2,
    storefront: "sole",
    environment: "staging",
    dataset_id: "sole-staging-v2",
    fact_id: factId,
    fact_revision: 1,
    fact_kind: "order",
    effective_at: "2026-11-24T22:05:46.000Z",
    recorded_at: "2026-11-24T22:05:47.000Z",
    currency: "USD",
    buyer_key: null,
    order_id: factId,
  },
};

it.each([1, "Ok"])("accepts legacy batch acknowledgement %s", async (status) => {
  const fetch = mockFetch().mockResolvedValue(Response.json({ status }));
  const config = readServerAnalyticsConfig(validEnv);
  const result = await captureBatch([fact], { config, fetch, now });

  expect(result).toEqual({ status: "accepted", count: 1 });
  expect(fetch).toHaveBeenCalledTimes(1);
  const [[url, request]] = fetch.mock.calls;
  expect(url).toBe("https://us.i.posthog.com/batch/");
  expect(request).toMatchObject({
    method: "POST",
    redirect: "manual",
    cache: "no-store",
  });
  expect(new Headers(request?.headers).has("authorization")).toBe(false);
  expect(JSON.parse(String(request?.body))).toEqual({
    api_key: publicProjectKey,
    batch: [
      {
        uuid: fact.uuid,
        event: fact.event,
        timestamp: fact.timestamp,
        distinct_id: fact.distinctId,
        properties: {
          ...fact.properties,
          $geoip_disable: true,
          $process_person_profile: false,
        },
      },
    ],
  });
  expect(String(request?.body)).not.toContain(privateQueryKey);
});

it("rejects custom injected hosts before sending", async () => {
  const fetch = mockFetch();
  const config = readServerAnalyticsConfig(validEnv)!;
  const result = await captureBatch([fact], {
    config: { ...config, host: "https://custom.example.com" } as unknown as typeof config,
    fetch,
    now,
  });
  expect(result).toEqual({ status: "configuration-failure", reason: "not-configured" });
  expect(fetch).not.toHaveBeenCalled();
});

it.each([
  [
    "extra property",
    [{ ...fact, properties: { ...fact.properties, email: "buyer@example.com" } }],
  ],
  [
    "plaintext buyer key",
    [{ ...fact, properties: { ...fact.properties, buyer_key: "buyer@example.com" } }],
  ],
  [
    "cross-environment value",
    [{ ...fact, properties: { ...fact.properties, environment: "production" } }],
  ],
  [
    "profile override",
    [{ ...fact, properties: { ...fact.properties, $process_person_profile: true } }],
  ],
  ["unsupported event", [{ ...fact, event: "$identify" }]],
  ["plaintext distinct ID", [{ ...fact, distinctId: "buyer@example.com" }]],
  ["changed effective timestamp", [{ ...fact, timestamp: "2026-11-25T22:05:46.000Z" }]],
  ["invalid UUID", [{ ...fact, uuid: "bad-uuid" }]],
  ["duplicate UUID", [fact, fact]],
  ["over-limit batch", Array.from({ length: 51 }, () => fact)],
])("rejects %s before sending", async (_label, events) => {
  const fetch = mockFetch();
  const result = await captureBatch(events as PublishedEvent[], {
    config: readServerAnalyticsConfig(validEnv),
    fetch,
    now,
  });
  expect(result).toEqual({ status: "permanent-failure", reason: "invalid-events" });
  expect(fetch).not.toHaveBeenCalled();
});

it.each([
  [307, "configuration-failure", "redirect"],
  [401, "configuration-failure", "unauthorized"],
  [403, "configuration-failure", "unauthorized"],
  [422, "permanent-failure", "provider-rejected"],
  [429, "retryable", "rate-limited"],
  [502, "retryable", "provider-unavailable"],
])(
  "classifies HTTP %s without retaining the provider body",
  async (code, status, reason) => {
    const fetch = mockFetch().mockResolvedValue(
      new Response(privateQueryKey, { status: code }),
    );
    expect(
      await captureBatch([fact], {
        config: readServerAnalyticsConfig(validEnv),
        fetch,
        now,
      }),
    ).toEqual({ status, reason });
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);

it("treats an invalid success payload as ambiguous and retryable", async () => {
  const fetch = mockFetch().mockResolvedValue(
    Response.json({ status: 0, detail: privateQueryKey }),
  );
  expect(
    await captureBatch([fact], {
      config: readServerAnalyticsConfig(validEnv),
      fetch,
      now,
    }),
  ).toEqual({ status: "retryable", reason: "invalid-response" });
});

it("preserves the original capture payload across a retry", async () => {
  const fetch = mockFetch()
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ status: 1 }));
  const deps = { config: readServerAnalyticsConfig(validEnv), fetch, now };

  expect(await captureBatch([fact], deps)).toMatchObject({ status: "retryable" });
  expect(await captureBatch([fact], deps)).toMatchObject({ status: "accepted" });
  expect(fetch.mock.calls[0]?.[1]?.body).toBe(fetch.mock.calls[1]?.[1]?.body);
});

it("aborts a stalled capture request at its deadline", async () => {
  jest.useFakeTimers();
  try {
    const fetch = mockFetch().mockReturnValue(new Promise(() => {}));
    const result = captureBatch([fact], {
      config: readServerAnalyticsConfig(validEnv),
      fetch,
      now,
      timeoutMs: 30,
    });
    await jest.advanceTimersByTimeAsync(30);
    expect(await result).toEqual({ status: "retryable", reason: "timeout" });
    expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  } finally {
    jest.useRealTimers();
  }
});

it("does not acknowledge an explicit quota limit", async () => {
  const fetch = mockFetch().mockResolvedValue(
    Response.json({ status: "Ok", quota_limited: ["events"] }),
  );
  expect(
    await captureBatch([fact], {
      config: readServerAnalyticsConfig(validEnv),
      fetch,
      now,
    }),
  ).toEqual({ status: "retryable", reason: "rate-limited" });
});
