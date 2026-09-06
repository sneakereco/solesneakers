import type { NextRequest } from "next/server";

import { issuePaymentPermitHandler } from "@/lib/checkout/issue-payment-permit";
import { createIssuePaymentPermitDependencies } from "@/lib/checkout/payment-api-dependencies";
import { getRequestIdFromHeaders } from "@/lib/http/request-id";

export const runtime = "nodejs";

export function POST(request: NextRequest): Promise<Response> {
  return issuePaymentPermitHandler(
    request,
    createIssuePaymentPermitDependencies(getRequestIdFromHeaders(request.headers)),
  );
}
