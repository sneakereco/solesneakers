import type { PaymentPermitRequest } from "@/lib/checkout/checkout-request";

export type SquarePaymentPhase = "load" | "create" | "attach" | "tokenize";

const TOKEN_LIKE_VALUE = /\b[A-Za-z0-9_-]{32,}\b/g;

export function squarePaymentDiagnostic(
  paymentMethod: PaymentPermitRequest["method"],
  phase: SquarePaymentPhase,
  error: unknown,
) {
  const errorMessage =
    error instanceof Error && error.message
      ? error.message.slice(0, 240).replace(TOKEN_LIKE_VALUE, "[redacted]")
      : "Square SDK operation failed";

  return {
    level: "warn" as const,
    layer: "frontend" as const,
    message: "Square payment method unavailable",
    paymentMethod,
    phase,
    errorName: error instanceof Error ? error.name : "UnknownError",
    errorMessage,
  };
}
