import { observeCheckoutRequest } from "@/Modules/Checkout/Source/Features/Operations/request-metrics";
import type { NextRequest } from "next/server";

import { issuePaymentPermitHandler } from "@/lib/checkout/issue-payment-permit";
import { createIssuePaymentPermitDependencies } from "@/lib/checkout/payment-api-dependencies";
import { getRequestIdFromHeaders } from "@/lib/http/request-id";

export const runtime = "nodejs";

export function POST(request: NextRequest): Promise<Response> {
  const requestId = getRequestIdFromHeaders(request.headers);
  return observeCheckoutRequest("/api/checkout/payment-permit", "POST", requestId, () =>
    issuePaymentPermitHandler(request, createIssuePaymentPermitDependencies(requestId)),
  );
}
