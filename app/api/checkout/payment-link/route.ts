import type { NextRequest } from "next/server";

import { createPaymentLinkHandler } from "@/lib/checkout/create-payment-link";
import { createPaymentLinkDependencies } from "@/lib/checkout/create-payment-link-dependencies";
import { getRequestIdFromHeaders } from "@/lib/http/request-id";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<Response> {
  const requestId = getRequestIdFromHeaders(request.headers);
  return createPaymentLinkHandler(request, createPaymentLinkDependencies(requestId));
}
