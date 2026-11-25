import { parseLoadTarget, type LoadTarget } from "./contracts";

export type LoadTestSettings = {
  target: LoadTarget;
  signingKey: string;
  redisToken: string;
};
export function readLoadTestSettings(
  values: Record<string, string | undefined> = process.env,
): LoadTestSettings | null {
  if (values.LOAD_TEST_ENABLED !== "true") return null;
  const target = parseLoadTarget(
    JSON.parse(values.LOAD_TEST_RESOURCE_MANIFEST ?? "null"),
  );
  if (
    !values.LOAD_TEST_SIGNING_KEY ||
    values.LOAD_TEST_SIGNING_KEY.length < 32 ||
    values.LOAD_TEST_ALLOWED_PROJECT_ID !== target.expected.projectId ||
    values.VERCEL_PROJECT_ID !== target.expected.projectId ||
    values.VERCEL_DEPLOYMENT_ID !== target.expected.deploymentId ||
    values.VERCEL_GIT_COMMIT_SHA !== target.expected.commit ||
    new URL(values.NEXT_PUBLIC_SUPABASE_URL ?? "https://invalid.invalid").origin !==
      new URL(target.resources.supabase.url).origin ||
    new URL(values.UPSTASH_REDIS_REST_URL ?? "https://invalid.invalid").origin !==
      new URL(target.resources.redis.url).origin ||
    !values.UPSTASH_REDIS_REST_TOKEN
  )
    throw new Error("Load-test deployment/resource identity invalid");
  if (values.LOAD_TEST_RESOURCE_MANIFEST_SHA256 !== target.digest)
    throw new Error("Load-test configured digest invalid");
  return {
    target,
    signingKey: values.LOAD_TEST_SIGNING_KEY,
    redisToken: values.UPSTASH_REDIS_REST_TOKEN,
  };
}
