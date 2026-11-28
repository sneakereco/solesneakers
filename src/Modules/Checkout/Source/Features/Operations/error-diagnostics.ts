// Only these literal values may cross the logging boundary. Never emit an
// arbitrary provider message, PostgreSQL detail, stack or nested error cause.
export const errorTypes = [
  "Error",
  "TypeError",
  "RangeError",
  "TimeoutError",
  "AbortError",
  "SquareError",
  "ZodError",
  "unknown",
] as const;
export const errorCodes = [
  "unclassified",
  "timeout",
  "aborted",
  "network_unavailable",
  "database_unique_conflict",
  "database_reference_conflict",
  "database_check_conflict",
  "database_serialization",
  "database_deadlock",
  "database_capacity",
  "database_timeout",
  "database_unavailable",
  "checkout_provider_busy",
  "checkout_provider_lease_elapsed",
  "checkout_protection_unavailable",
  "checkout_inventory_unavailable",
  "checkout_resume_inconsistent",
  "checkout_retry_qualification_unavailable",
  "square_configuration_invalid",
  "square_merchant_configuration_invalid",
  "terminal_attempt_outcome",
  "invalid_verified_payment",
  "missing_recovery_attempt",
  "square_checkout_order_not_cancelable",
  "analytics_configuration_unavailable",
  "analytics_dataset_unavailable",
  "analytics_claim_unavailable",
] as const;
export const diagnosticPhases = [
  "load",
  "create",
  "attach",
  "tokenize",
  "tenant",
  "configuration",
  "browser_verification",
  "session",
  "identity",
  "existing",
  "access",
  "admission",
  "address_verification",
  "catalog",
  "pricing",
  "provider_calculate",
  "reservation",
  "provider_create",
  "provider_attach",
  "guest_access",
  "original_retry",
  "recovery",
  "analytics_drain",
] as const;
export type DiagnosticPhase = (typeof diagnosticPhases)[number];

const databaseCodes: Record<string, (typeof errorCodes)[number]> = {
  "23505": "database_unique_conflict",
  "23503": "database_reference_conflict",
  "23514": "database_check_conflict",
  "40001": "database_serialization",
  "40P01": "database_deadlock",
  "53300": "database_capacity",
  "57014": "database_timeout",
  "08006": "database_unavailable",
};
const analyticsMessages: Record<string, (typeof errorCodes)[number]> = {
  "Analytics configuration unavailable": "analytics_configuration_unavailable",
  "Analytics dataset unavailable": "analytics_dataset_unavailable",
  "Analytics publication claim failed": "analytics_claim_unavailable",
};
export function errorDiagnostics(error: unknown) {
  const value =
    error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  const errorType = errorTypes.find((type) => type === value.name) ?? "unknown";
  const known = errorCodes.find((code) => code === value.message);
  const code =
    typeof value.code === "string" && Object.hasOwn(databaseCodes, value.code)
      ? databaseCodes[value.code]
      : undefined;
  const analyticsCode =
    typeof value.message === "string" && Object.hasOwn(analyticsMessages, value.message)
      ? analyticsMessages[value.message]
      : undefined;
  const errorCode =
    code ??
    known ??
    analyticsCode ??
    (errorType === "TimeoutError"
      ? "timeout"
      : errorType === "AbortError"
        ? "aborted"
        : value.message === "fetch failed"
          ? "network_unavailable"
          : "unclassified");
  return { errorType, errorCode };
}
