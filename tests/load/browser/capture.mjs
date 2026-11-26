const routeName = (url) =>
  new URL(url).pathname.replace(/[a-f0-9]{8}-[a-f0-9-]{27}/gi, ":id");
export function captureJourneyRequests(page, baseUrl) {
  const requests = [],
    assets = new Set(),
    replay = [];
  const listener = async (response) => {
    const request = response.request(),
      url = new URL(response.url());
    if (url.origin !== baseUrl) return;
    const type = request.resourceType();
    if (
      ["script", "stylesheet", "font", "image"].includes(type) &&
      !url.search &&
      !/token|auth|order/i.test(url.pathname)
    )
      assets.add(url.pathname);
    if (
      type === "image" &&
      url.pathname === "/_next/image" &&
      [...url.searchParams.keys()].every((key) => ["url", "w", "q"].includes(key)) &&
      /^\/images\/[\w/.-]+$/.test(url.searchParams.get("url") ?? "") &&
      /^\d+$/.test(url.searchParams.get("w") ?? "") &&
      /^\d+$/.test(url.searchParams.get("q") ?? "")
    )
      assets.add(url.pathname + url.search);
    const headers = request.headers();
    if (
      headers.rsc === "1" &&
      url.pathname === "/store" &&
      [...url.searchParams.keys()].every((key) => key === "_rsc")
    ) {
      try {
        const state = headers["next-router-state-tree"],
          decoded = state ? decodeURIComponent(state) : "";
        if (
          state &&
          state.length < 8000 &&
          !/token|checkout|order|auth|email|secret|bearer/i.test(decoded)
        ) {
          JSON.parse(decoded);
          const selected = { rsc: "1", "next-router-state-tree": state };
          if (headers["next-router-prefetch"] === "1")
            selected["next-router-prefetch"] = "1";
          replay.push({ path: url.pathname + url.search, headers: selected });
        }
      } catch {
        /* Private or malformed router state is never replayed. */
      }
    }
    const timing = request.timing();
    requests.push({
      type: "request",
      route: routeName(url.href),
      method: request.method(),
      status: response.status(),
      resourceType: type,
      rsc: request.headers().rsc === "1",
      at: Date.now(),
      ttfbMs:
        timing.responseStart >= 0 ? timing.responseStart - timing.requestStart : null,
    });
  };
  page.on("response", listener);
  return {
    requests,
    assets,
    replay,
    stop() {
      page.off("response", listener);
      return { requests: [...requests], assets: [...assets], replay: [...replay] };
    },
  };
}
