import { NextResponse, type NextRequest } from "next/server";
import { resolveConsentedIdentity } from "@/Modules/Analytics/Source/Features/VisitorMeasurement/identity";
import {
  acceptsMeasurementHost,
  privateHeaders,
} from "@/Modules/Analytics/Source/Features/VisitorMeasurement/server-consent";

export async function GET(request: NextRequest) {
  if (!acceptsMeasurementHost(request.nextUrl.hostname))
    return NextResponse.json(null, { status: 403, headers: privateHeaders });
  if (request.nextUrl.search)
    return NextResponse.json(null, { status: 400, headers: privateHeaders });
  try {
    const identity = await resolveConsentedIdentity();
    return NextResponse.json(identity, {
      status: identity ? 200 : 403,
      headers: privateHeaders,
    });
  } catch {
    return NextResponse.json(null, { status: 503, headers: privateHeaders });
  }
}
