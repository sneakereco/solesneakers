import { readPublicAnalyticsConfig } from "../../../Source/Features/Configuration/public-config";
import { readServerAnalyticsConfig } from "../../../Source/Features/Configuration/server-config";

import {
  identitySecret,
  privateQueryKey,
  publicProjectKey,
  validEnv,
} from "./config-fixture";

jest.mock("server-only", () => ({}), { virtual: true });

describe("readPublicAnalyticsConfig", () => {
  it("only exposes capture settings even when passed server environment variables", () => {
    const config = readPublicAnalyticsConfig(validEnv);
    expect(config).toEqual({
      projectKey: publicProjectKey,
      host: "https://us.i.posthog.com",
      environment: "staging",
    });
    expect(JSON.stringify(config)).not.toContain(privateQueryKey);
    expect(JSON.stringify(config)).not.toContain(identitySecret);
  });

  it.each([
    ["NEXT_PUBLIC_POSTHOG_ENABLED", undefined],
    ["NEXT_PUBLIC_POSTHOG_ENABLED", "false"],
    ["NEXT_PUBLIC_MEASUREMENT_ENVIRONMENT", "preview"],
    ["NEXT_PUBLIC_POSTHOG_PROJECT_KEY", undefined],
    ["NEXT_PUBLIC_POSTHOG_PROJECT_KEY", privateQueryKey],
    ["NEXT_PUBLIC_POSTHOG_HOST", "https://custom.example.com"],
    ["NEXT_PUBLIC_POSTHOG_HOST", "https://us.i.posthog.com/"],
    ["NEXT_PUBLIC_POSTHOG_HOST", "https://us.i.posthog.com@custom.example.com"],
  ])("fails closed for %s = %s", (key, value) => {
    expect(readPublicAnalyticsConfig({ ...validEnv, [key]: value })).toBeNull();
  });
});

describe("readServerAnalyticsConfig", () => {
  it.each(["us", "eu"])("pairs %s capture and API cloud regions", (region) => {
    const config = readServerAnalyticsConfig({
      ...validEnv,
      NEXT_PUBLIC_POSTHOG_HOST: `https://${region}.i.posthog.com`,
      POSTHOG_API_HOST: `https://${region}.posthog.com`,
    });
    expect(config).toMatchObject({
      projectKey: publicProjectKey,
      host: `https://${region}.i.posthog.com`,
      environment: "staging",
      projectId: "741",
      apiHost: `https://${region}.posthog.com`,
      queryApiKey: privateQueryKey,
      identitySecret,
    });
  });

  it("permits a scoped personal API key", () => {
    expect(
      readServerAnalyticsConfig({
        ...validEnv,
        POSTHOG_QUERY_API_KEY: "phx_personalkeyfixture012345",
      }),
    ).not.toBeNull();
  });

  it.each([
    ["NEXT_PUBLIC_POSTHOG_ENABLED", "false"],
    ["POSTHOG_QUERY_API_KEY", undefined],
    ["POSTHOG_QUERY_API_KEY", publicProjectKey],
    ["POSTHOG_QUERY_API_KEY", "phs_fixturekeywithspaces 012345"],
    ["POSTHOG_PROJECT_ID", undefined],
    ["POSTHOG_PROJECT_ID", "0"],
    ["POSTHOG_PROJECT_ID", "../741"],
    ["POSTHOG_API_HOST", undefined],
    ["POSTHOG_API_HOST", "https://eu.posthog.com"],
    ["POSTHOG_API_HOST", "https://us.posthog.com/redirect"],
    ["POSTHOG_API_HOST", "https://us.posthog.com.attacker.example"],
    ["ANALYTICS_IDENTITY_SECRET", undefined],
    ["ANALYTICS_IDENTITY_SECRET", "short"],
    ["ANALYTICS_IDENTITY_SECRET", privateQueryKey],
  ])("fails closed for incomplete or mismatched %s", (key, value) => {
    expect(readServerAnalyticsConfig({ ...validEnv, [key]: value })).toBeNull();
  });
});
