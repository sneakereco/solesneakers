const sensitive =
  /(?:authorization|cookie|password|secret|token|credential|signing.?key|email|address|instagram|handle|sourceId|^mac$)/i;
export function redactString(value) {
  return value
    .replace(
      /([?&](?:token|guestAccessToken|access_token|refresh_token|permit|secret|signature)=)[^&\s"'<>]+/gi,
      "$1[REDACTED]",
    )
    .replace(/\bBearer\s+[^\s"',;]+/gi, "Bearer [REDACTED]")
    .replace(
      /((?:password|secret|cookie|authorization|guestAccessToken|access_token|refresh_token)\s*[:=]\s*)[^\s,;]+/gi,
      "$1[REDACTED]",
    )
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED EMAIL]");
}
export function redactArtifact(value, seen = new WeakSet()) {
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object")
    return typeof value === "bigint" ? String(value) : value;
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (value instanceof Error)
    return { name: value.name, message: redactString(value.message) };
  if (Array.isArray(value)) return value.map((item) => redactArtifact(item, seen));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      sensitive.test(key) ? "[REDACTED]" : redactArtifact(item, seen),
    ]),
  );
}
