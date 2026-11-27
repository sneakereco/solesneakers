import { NextResponse, type NextRequest } from "next/server";

export function temporaryUnavailableResponse(
  request: NextRequest,
  reason: "session" | "store" = "session",
) {
  const title =
    reason === "store"
      ? "Could not load store access settings"
      : "Could not verify your session";
  const headers = { "Cache-Control": "no-store", "Retry-After": "1" };
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: title + ". Try again." }, { status: 503, headers });
  }
  return new NextResponse(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><main><h1>${title}</h1><p>Try loading this page again.</p><a href="">Retry</a></main></html>`,
    { status: 503, headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } },
  );
}
