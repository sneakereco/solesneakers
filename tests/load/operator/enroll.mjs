import { parseTarget, assertAttestation } from "../shared/contracts.mjs";
export async function enrollTarget(template, baseUrl, commit, attest) {
  if (!/^[a-f0-9]{40}$/.test(commit))
    throw Error("Expected deployment commit must be a complete SHA");
  const candidate = {
    ...template,
    baseUrl: template.baseUrl === "$VERCEL_URL" ? baseUrl : template.baseUrl,
    expected: {
      ...template.expected,
      commit:
        template.expected.commit === "$VERCEL_GIT_COMMIT_SHA"
          ? commit
          : template.expected.commit,
      deploymentId:
        template.expected.deploymentId === "$VERCEL_DEPLOYMENT_ID"
          ? "dpl_enrollment_pending"
          : template.expected.deploymentId,
    },
  };
  const provisional = parseTarget(candidate);
  if (provisional.baseUrl !== baseUrl)
    throw Error("Immutable deployment URL differs from enrollment");
  const actual = await attest(provisional);
  const target = parseTarget({
    ...candidate,
    expected: {
      ...candidate.expected,
      deploymentId:
        template.expected.deploymentId === "$VERCEL_DEPLOYMENT_ID"
          ? actual.deploymentId
          : candidate.expected.deploymentId,
    },
  });
  assertAttestation(target, actual, ["shopping"]);
  return target;
}
