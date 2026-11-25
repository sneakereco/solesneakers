import { withRequestDeadline } from "./request-deadline";

type AuthResponse = {
  ok?: boolean;
  error?: unknown;
  requiresEmailVerification?: boolean;
  isAdmin?: boolean;
  requiresTwoFASetup?: boolean;
  requiresTwoFAChallenge?: boolean;
  nextPath?: string;
};

export async function postAuthJson<T extends AuthResponse = AuthResponse>(
  path: string,
  body: unknown,
  fallback: string,
  allowEmailVerification = false,
): Promise<T> {
  return withRequestDeadline(async (signal) => {
    const response = await fetch(path, {
      method: "POST",
      ...(body === undefined
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
      signal,
    }).catch(() => {
      throw new Error(fallback);
    });
    const data: T | null = await response.json().catch(() => null);
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new Error(fallback);

    if (
      allowEmailVerification &&
      response.status === 401 &&
      data.requiresEmailVerification === true
    ) {
      return data;
    }
    if (!response.ok || data.ok === false || data.error) {
      throw new Error(
        response.status < 500 && typeof data.error === "string" ? data.error : fallback,
      );
    }
    return data;
  });
}
