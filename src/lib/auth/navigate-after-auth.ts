export function getSameOriginAuthDestination(
  destination: unknown,
  origin: string,
): string {
  if (typeof destination !== "string") return "/";
  try {
    const target = new URL(destination, origin);
    if (target.origin === origin && !target.pathname.startsWith("//"))
      return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    // A malformed or external next value must not become a navigation target.
  }
  return "/";
}

export function navigateAfterAuth(destination: unknown): void {
  // Route-handler cookie changes do not invalidate every prefetched client route.
  // Re-enter the server gate with the new session instead of reusing that cache.
  window.location.replace(
    getSameOriginAuthDestination(destination, window.location.origin),
  );
}
