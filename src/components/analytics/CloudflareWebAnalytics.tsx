const BEACON_URL = "https://static.cloudflareinsights.com/beacon.min.js";

export function CloudflareWebAnalytics({ token }: { token?: string }) {
  if (!token) {
    return null;
  }

  return (
    <script type="module" src={BEACON_URL} data-cf-beacon={JSON.stringify({ token })} />
  );
}
