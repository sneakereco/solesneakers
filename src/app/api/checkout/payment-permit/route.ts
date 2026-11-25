import type { NextRequest } from "next/server";

import { issuePaymentPermitHandler } from "@/lib/checkout/issue-payment-permit";
import { createIssuePaymentPermitDependencies } from "@/lib/checkout/payment-api-dependencies";
import { getRequestIdFromHeaders } from "@/lib/http/request-id";
import { withLoadTestRequest } from "@/Modules/Checkout/Source/Features/LoadTesting/context";

export const runtime = "nodejs";

export function POST(request: NextRequest): Promise<Response> {
  return withLoadTestRequest(request, () =>
    issuePaymentPermitHandler(
      request,
      createIssuePaymentPermitDependencies(getRequestIdFromHeaders(request.headers)),
    ),
  );
}
