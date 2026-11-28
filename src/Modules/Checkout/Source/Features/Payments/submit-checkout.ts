import { NextRequest } from "next/server";
import { z } from "zod";
import { prepareCheckoutRequestSchema } from "@/lib/checkout/checkout-request";

const submissionSchema = z
  .object({
    preparation: prepareCheckoutRequestSchema.refine((value) => !value.recoveryOnly),
    sourceId: z.string().trim().min(1).max(2048),
    turnstileToken: z.string().trim().min(1).max(2048).nullable().optional(),
  })
  .strict();
export type CheckoutSubmission = z.infer<typeof submissionSchema>;

export type SubmitCheckoutDependencies = {
  verify(request: NextRequest, submission: CheckoutSubmission): Promise<Response | null>;
  prepare(request: NextRequest): Promise<Response>;
  permit(request: NextRequest): Promise<Response>;
  pay(request: NextRequest): Promise<Response>;
  reportError(error: Error): void;
};

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

// Compose the same guarded operations without browser round trips between the
// inventory claim and payment dispatch. Sources and permits never leave memory.
export async function submitCheckoutHandler(
  request: NextRequest,
  deps: SubmitCheckoutDependencies,
): Promise<Response> {
  const parsed = submissionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "Invalid checkout submission" }, 400);
  const submission = parsed.data;
  const internalRequest = (path: string, body: unknown) =>
    new NextRequest(new URL(path, request.url), {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(body),
    });
  try {
    const refusal = await deps.verify(request, submission);
    if (refusal) return refusal;
    const prepared = await deps.prepare(
      internalRequest("/api/checkout/prepare", submission.preparation),
    );
    const order = await prepared.json();
    if (!prepared.ok || order?.code === "CHECKOUT_RECOVERY_REQUIRED")
      return json(order, prepared.status);
    if (!z.uuid().safeParse(order?.orderId).success)
      throw new Error("checkout_submission_order_missing");

    let paymentResult: { status: number; body: Record<string, unknown> };
    try {
      const permit = await deps.permit(
        internalRequest("/api/checkout/payment-permit", {
          orderId: order.orderId,
          guestAccessToken: order.guestAccessToken,
          deviceSessionId: submission.preparation.deviceSessionId,
          method: submission.preparation.paymentMethod,
          turnstileToken: submission.turnstileToken,
        }),
      );
      const authorization = await permit.json();
      if (!permit.ok || typeof authorization?.permit !== "string") {
        paymentResult = {
          status: permit.status,
          body: {
            error: authorization?.error || "Payment authorization is unavailable.",
            ...(order.reused || authorization?.code === "CHECKOUT_RECOVERY_REQUIRED"
              ? { status: "UNKNOWN" }
              : { code: "PAYMENT_NOT_SUBMITTED" }),
          },
        };
      } else {
        const payment = await deps.pay(
          internalRequest("/api/checkout/pay", {
            permit: authorization.permit,
            sourceId: submission.sourceId,
          }),
        );
        paymentResult = { status: payment.status, body: await payment.json() };
      }
    } catch {
      // Even a lost response inside this request can hide a committed dispatch.
      deps.reportError(new Error("checkout_submission_outcome_unavailable"));
      paymentResult = { status: 503, body: { status: "UNKNOWN" } };
    }
    return json({ ...order, paymentResult });
  } catch {
    deps.reportError(new Error("checkout_submission_unavailable"));
    return json(
      {
        error: "Check your original order status before trying another payment.",
        code: "CHECKOUT_RECOVERY_REQUIRED",
      },
      503,
    );
  }
}
