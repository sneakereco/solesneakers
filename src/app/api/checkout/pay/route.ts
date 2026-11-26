import type { NextRequest } from "next/server";

import { createDirectPaymentHandler } from "@/lib/checkout/create-direct-payment";
import { createDirectPaymentDependencies } from "@/lib/checkout/payment-api-dependencies";
import { getRequestIdFromHeaders } from "@/lib/http/request-id";
import { withLoadTestRequest } from "@/Modules/Checkout/Source/Features/LoadTesting/context";

export const runtime = "nodejs";

export function POST(request: NextRequest): Promise<Response> {
  return withLoadTestRequest(request, () =>
    createDirectPaymentHandler(
      request,
      createDirectPaymentDependencies(getRequestIdFromHeaders(request.headers)),
    ),
  );
}
