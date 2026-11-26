import { NextResponse, type NextRequest } from "next/server";
import {
  acceptsMeasurementHost,
  preferenceCookie,
  privateHeaders,
  readServerConsent,
  updateServerConsent,
} from "@/Modules/Analytics/Source/Features/VisitorMeasurement/server-consent";

export async function GET(request: NextRequest) {
  if (!acceptsMeasurementHost(request.nextUrl.hostname))
    return NextResponse.json(null, { status: 403, headers: privateHeaders });
  try {
    return NextResponse.json(await readServerConsent(), { headers: privateHeaders });
  } catch {
    return NextResponse.json(
      { error: "Preference unavailable" },
      { status: 503, headers: privateHeaders },
    );
  }
}
export async function POST(request: NextRequest) {
  if (
    !acceptsMeasurementHost(request.nextUrl.hostname) ||
    request.headers.get("origin") !== request.nextUrl.origin
  )
    return NextResponse.json(
      { error: "Invalid origin" },
      { status: 403, headers: privateHeaders },
    );
  const input = await request.json().catch(() => null);
  if (
    request.nextUrl.search ||
    !input ||
    Object.keys(input).length !== 1 ||
    !["accepted", "declined"].includes(input.choice)
  )
    return NextResponse.json(
      { error: "Invalid choice" },
      { status: 400, headers: privateHeaders },
    );
  try {
    const state = await updateServerConsent(input.choice);
    const response = NextResponse.json(state, { headers: privateHeaders });
    response.cookies.set(
      preferenceCookie,
      state.choice === "accepted" ? state.receiptId : "declined",
      { path: "/", secure: true, httpOnly: true, sameSite: "lax", maxAge: 365 * 86400 },
    );
    return response;
  } catch {
    return NextResponse.json(
      { error: "Preference unavailable" },
      { status: 503, headers: privateHeaders },
    );
  }
}
