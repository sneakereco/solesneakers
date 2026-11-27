import { validEnv } from "./config-fixture";
import {
  pairOwnerProject,
  readNativeRetention,
} from "../../../Source/Features/Configuration/operator-pairing";
import { readServerAnalyticsConfig } from "../../../Source/Features/Configuration/server-config";

const org = "a7261a18-126b-49e5-9add-a92381af087a";
const env = {
  ...validEnv,
  NEXT_PUBLIC_POSTHOG_ENABLED: "false",
  POSTHOG_OWNER_ORGANIZATION_ID: org,
  POSTHOG_OWNER_STAGING_PROJECT_ID: "741",
  POSTHOG_OPERATOR_API_KEY: "phx_operatorcredentialfixture098765",
};
const metadata = {
  organization: org,
  id: 741,
  anonymize_ips: true,
  api_token: validEnv.NEXT_PUBLIC_POSTHOG_PROJECT_KEY,
};
const fetchMetadata = (response: unknown) =>
  jest.fn(() => Promise.resolve(Response.json(response)));

test("pairs the disabled capture configuration with one owner-only metadata GET", async () => {
  expect(readServerAnalyticsConfig(env)).toBeNull();
  const fetch = fetchMetadata(metadata);
  await expect(pairOwnerProject(env, "staging", fetch)).resolves.toMatchObject({
    projectId: "741",
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith(
    `https://us.posthog.com/api/organizations/${org}/projects/741/`,
    expect.objectContaining({ method: "GET", redirect: "error" }),
  );
});
test.each([
  { api_token: "phc_wrongcontributorproject01234567" },
  { id: 742 },
  { organization: "another-owner" },
  { anonymize_ips: false },
])(
  "rejects incorrect project or IP settings without sending a capture",
  async (change) => {
    const fetch = fetchMetadata({ ...metadata, ...change });
    await expect(pairOwnerProject(env, "staging", fetch)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);
test("rejects stage/prod project reuse before contacting the provider", async () => {
  const fetch = fetchMetadata(metadata);
  await expect(
    pairOwnerProject(
      { ...env, POSTHOG_OWNER_PRODUCTION_PROJECT_ID: "741" },
      "staging",
      fetch,
    ),
  ).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});

test("reads the effective current retention from the paired project's GET-only resource", async () => {
  const config = await pairOwnerProject(env, "staging", fetchMetadata(metadata));
  const fetch = fetchMetadata({
    retention_months: 24,
    retained_from: "2024-11-27",
    plan_retention_months: 84,
  });
  await expect(
    readNativeRetention(config, env.POSTHOG_OPERATOR_API_KEY, fetch),
  ).resolves.toEqual({ months: 24, retainedFrom: "2024-11-27" });
  expect(fetch).toHaveBeenCalledWith(
    config.apiHost + "/api/projects/741/events_retention/",
    expect.objectContaining({
      method: "GET",
      redirect: "error",
      headers: { Authorization: "Bearer " + env.POSTHOG_OPERATOR_API_KEY },
    }),
  );
  await expect(
    readNativeRetention(
      config,
      env.POSTHOG_OPERATOR_API_KEY,
      fetchMetadata({ retention_months: null, retained_from: null }),
    ),
  ).resolves.toEqual({ months: null, retainedFrom: null });
  await expect(
    readNativeRetention(
      config,
      env.POSTHOG_OPERATOR_API_KEY,
      fetchMetadata({ max_retention_months: 84 }),
    ),
  ).rejects.toThrow();
});
