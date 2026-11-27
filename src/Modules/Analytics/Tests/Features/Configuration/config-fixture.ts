export const publicProjectKey = "phc_analyticscapturefixture012345";
export const privateQueryKey = "phs_analyticsquerysecretfixture012345";
export const identitySecret = "analytics-identity-fixture-only-with-strong-length";

export const validEnv = {
  NEXT_PUBLIC_POSTHOG_ENABLED: "true",
  NEXT_PUBLIC_MEASUREMENT_ENVIRONMENT: "staging",
  NEXT_PUBLIC_POSTHOG_PROJECT_KEY: publicProjectKey,
  NEXT_PUBLIC_POSTHOG_HOST: "https://us.i.posthog.com",
  POSTHOG_PROJECT_ID: "741",
  POSTHOG_QUERY_API_KEY: privateQueryKey,
  POSTHOG_API_HOST: "https://us.posthog.com",
  ANALYTICS_IDENTITY_SECRET: identitySecret,
};

export const now = () => new Date("2026-11-25T12:00:00.000Z");

export function mockFetch(): jest.MockedFunction<typeof fetch> {
  return jest.fn();
}
