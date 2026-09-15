import { squarePaymentDiagnostic } from "@/components/checkout/square-payment-diagnostics";

describe("squarePaymentDiagnostic", () => {
  it("preserves an actionable Square initialization error without leaking token-like values", () => {
    const error = new Error(
      "Property boxShadow is not allowed token abcdefghijklmnopqrstuvwxyz123456",
    );
    error.name = "InvalidInputStylePropertyError";

    expect(squarePaymentDiagnostic("card", "attach", error)).toEqual({
      level: "warn",
      layer: "frontend",
      message: "Square payment method unavailable",
      paymentMethod: "card",
      phase: "attach",
      errorName: "InvalidInputStylePropertyError",
      errorMessage: "Property boxShadow is not allowed token [redacted]",
    });
  });

  it("normalizes non-Error failures", () => {
    expect(squarePaymentDiagnostic("googlePay", "create", { reason: "hidden" })).toEqual({
      level: "warn",
      layer: "frontend",
      message: "Square payment method unavailable",
      paymentMethod: "googlePay",
      phase: "create",
      errorName: "UnknownError",
      errorMessage: "Square SDK operation failed",
    });
  });
});
