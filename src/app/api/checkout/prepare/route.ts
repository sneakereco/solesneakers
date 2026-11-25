import type { NextRequest } from "next/server";

import { prepareCheckoutHandler } from "@/lib/checkout/prepare-checkout";
import { createPrepareCheckoutDependencies } from "@/lib/checkout/prepare-checkout-dependencies";
import { getRequestIdFromHeaders } from "@/lib/http/request-id";
import { withLoadTestRequest } from "@/Modules/Checkout/Source/Features/LoadTesting/context";

export const runtime = "nodejs";

export function POST(request: NextRequest): Promise<Response> {
  return withLoadTestRequest(request, () =>
    prepareCheckoutHandler(
      request,
      createPrepareCheckoutDependencies(getRequestIdFromHeaders(request.headers)),
    ),
  );
}
