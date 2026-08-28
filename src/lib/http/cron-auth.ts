import { timingSafeEqual } from "node:crypto";

export function isAuthorizedCronRequest(request: Request, secret: string): boolean {
  if (secret.length < 32) {
    return false;
  }

  const authorization = request.headers.get("authorization");
  const expected = `Bearer ${secret}`;
  if (!authorization || authorization.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(authorization), Buffer.from(expected));
}

export function getCronSecret(): string {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error("cron_secret_missing");
  }
  return secret;
}
