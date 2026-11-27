import { postAuthJson } from "@/lib/http/post-auth-json";

type Enrollment = {
  ok?: boolean;
  factorId?: string;
  uri?: string;
  qrCode?: string;
};

export async function mfaEnroll(skipQR = false) {
  const fallback = "Could not generate authenticator setup details. Please try again.";
  const result = await postAuthJson<Enrollment>(
    `/api/auth/2fa/enroll${skipQR ? "?skipQR=true" : ""}`,
    undefined,
    fallback,
  );
  if (typeof result.factorId !== "string" || !result.factorId) throw new Error(fallback);

  return {
    factorId: result.factorId,
    uri: typeof result.uri === "string" ? result.uri : undefined,
    qrCode: typeof result.qrCode === "string" ? result.qrCode : undefined,
  };
}

export async function mfaVerifyEnrollment(factorId: string, code: string) {
  const fallback = "Could not verify the setup code. Please try again.";
  const result = await postAuthJson(
    "/api/auth/2fa/verify-enrollment",
    { factorId, code },
    fallback,
  );
  if (result.ok !== true) throw new Error(fallback);
}

export async function mfaVerifyChallenge(code: string) {
  const fallback = "Could not verify the authentication code. Please try again.";
  const result = await postAuthJson("/api/auth/2fa/challenge/verify", { code }, fallback);
  if (result.ok !== true) throw new Error(fallback);
}
