const BEACON_URL = "https://static.cloudflareinsights.com/beacon.min.js";

export function CloudflareWebAnalytics({ token }: { token?: string }) {
  if (process.env.NODE_ENV !== "production" || !token) {
    return null;
  }

  return (
    <script
      async
      type="module"
      src={BEACON_URL}
      data-cf-beacon={JSON.stringify({ token })}
    />
  );
}
