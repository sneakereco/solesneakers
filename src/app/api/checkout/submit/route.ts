import type { NextRequest } from "next/server";
import { prepareCheckoutHandler } from "@/lib/checkout/prepare-checkout";
import { createPrepareCheckoutDependencies } from "@/lib/checkout/prepare-checkout-dependencies";
import { issuePaymentPermitHandler } from "@/lib/checkout/issue-payment-permit";
import { createDirectPaymentHandler } from "@/lib/checkout/create-direct-payment";
import {
  createIssuePaymentPermitDependencies,
  createDirectPaymentDependencies,
} from "@/lib/checkout/payment-api-dependencies";
import { submitCheckoutHandler } from "@/Modules/Checkout/Source/Features/Payments/submit-checkout";
import { observeCheckoutRequest } from "@/Modules/Checkout/Source/Features/Operations/request-metrics";
import { getRequestIdFromHeaders } from "@/lib/http/request-id";

export const runtime = "nodejs";
export const maxDuration = 60;

export function POST(request: NextRequest): Promise<Response> {
  const requestId = getRequestIdFromHeaders(request.headers);
  const preparation = createPrepareCheckoutDependencies(requestId);
  const permit = createIssuePaymentPermitDependencies(requestId);
  const payment = createDirectPaymentDependencies(requestId);
  let session: ReturnType<typeof preparation.getSession> | undefined;
  const getSession = () => (session ??= preparation.getSession());
  let browser: ReturnType<typeof preparation.verifyBrowser> | undefined;
  const verifyBrowser = () => (browser ??= preparation.verifyBrowser());
  // One observed identity for all stages of this submission. Turnstile is
  // single-use: verify before claiming stock and reuse only this request's result.
  let verification:
    | {
        token: string;
        ip: string;
        verdict: Awaited<ReturnType<typeof permit.verifyTurnstile>>;
      }
    | undefined;
  const originalVerify = permit.verifyTurnstile;
  return observeCheckoutRequest("/api/checkout/submit", "POST", requestId, () =>
    submitCheckoutHandler(request, {
      verify: async (req, submission) => {
        const bot = await verifyBrowser();
        if (!bot.allowed)
          return Response.json(
            {
              error: "Checkout verification failed",
              code: "PAYMENT_NOT_SUBMITTED",
              paymentState: "not_submitted",
            },
            { status: bot.reason === "bot" ? 403 : 503 },
          );
        if (await getSession()) return null;
        const ip = permit.getClientIp(req);
        const token = submission.turnstileToken;
        if (!ip || !token)
          return Response.json(
            {
              error: "Complete the security check before paying.",
              code: "PAYMENT_NOT_SUBMITTED",
              paymentState: "not_submitted",
            },
            { status: 403 },
          );
        const verdict = await originalVerify(token, ip);
        verification = { token, ip, verdict };
        return verdict.allowed
          ? null
          : Response.json(
              {
                error: "Complete the security check again before paying.",
                code: "PAYMENT_NOT_SUBMITTED",
                paymentState: "not_submitted",
              },
              { status: verdict.reason === "invalid" ? 403 : 503 },
            );
      },
      prepare: (req) =>
        prepareCheckoutHandler(req, { ...preparation, getSession, verifyBrowser }),
      permit: (req) =>
        issuePaymentPermitHandler(req, {
          ...permit,
          getSession,
          verifyBrowser,
          verifyTurnstile: (token, ip) =>
            verification?.token === token && verification.ip === ip
              ? Promise.resolve(verification.verdict)
              : originalVerify(token, ip),
        }),
      pay: (req) => createDirectPaymentHandler(req, { ...payment, getSession }),
      reportError: payment.reportError,
    }),
  );
}
