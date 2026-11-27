// Values that reach stdout must come from this vocabulary or from typed, bounded fields.
// Never traverse request bodies, arbitrary metadata, error causes or stacks.
const events = [
  "application_event",
  "application_error",
  "checkout_request",
  "checkout_gateway_call",
  "checkout_attempt",
  "checkout_admission",
  "checkout_lease",
  "checkout_worker",
  "checkout_alert",
  "checkout_notification_post_delivery_failed",
  "shipping_label_created",
  "square_payment_reconciliation_failed",
  "checkout_expiration_job_failed",
  "checkout_notification_job_failed",
  "checkout_notification_prompt_delivery_failed",
  "square_method_unavailable",
  "shippo_rate_retrieval_failed",
  "shippo_create_shipment_failed",
  "shippo_purchase_label_failed",
  "shippo_shipment_no_id",
  "admin_guard",
  "csrf_block",
  "bot_mitigation",
  "path_normalization",
  "rate_limit_missing_ip",
  "rate_limit_exceeded",
  "rate_limit_outage",
  "site_lock_admin_bypass_lookup_failed",
  "site_lock_settings_lookup_failed",
  "account_error",
  "admin_error",
  "cart_error",
  "checkout_error",
  "store_error",
  "error_boundary",
  "cache_revalidate_failed",
  "image_compression_failed",
  "inventory_image_upload_queue",
  "account_load_addresses",
  "account_load_orders",
  "account_load_profile",
  "featured_items_search",
  "admin_load_dashboard",
  "admin_load_pickup_counts",
  "admin_load_pickup_orders",
  "admin_load_profile",
  "admin_load_settings_shipping",
  "admin_load_shipping_counts",
  "admin_load_shipping_defaults",
  "admin_load_shipping_orders",
  "admin_load_shipping_origin",
  "admin_load_transaction_counts",
  "admin_load_transactions",
  "admin_store_access_load",
  "inventory_load_brand_catalog",
  "inventory_load_model_catalog",
  "inventory_parse_title",
  "load_featured_items_home",
  "load_featured_items",
  "load_homepage_category_brands",
  "search_overlay_error",
  "add_featured_item",
  "admin_mark_shipped",
  "admin_store_access_save",
  "inventory_form_submit",
  "remove_featured_item",
  "reorder_featured_items",
  "admin_load_shipping_profiles",
] as const;
const knownMessages = [
  "Unexpected error during label creation",
  "account_orders_error",
  "admin_guard_insufficient_role",
  "admin_guard_invalid_admin_token",
  "admin_guard_mfa_required",
  "admin_guard_mfa_state_error",
  "admin_guard_missing_admin_cookie",
  "admin_guard_no_user_session",
  "admin_guard_profile_lookup_failed",
  "admin_guard_profile_missing",
  "admin_guard_signout_failed",
  "admin_guard_token_user_mismatch",
  "admin_guard_token_verify_error",
  "canonicalize_redirect",
  "contact_email_failed",
  "contact_rate_limit_failed",
  "featured_item_added",
  "featured_item_removed",
  "featured_items_reordered",
  "formdata_parse_failed",
  "password_change_email_failed",
  "rate_limit_block",
  "rate_limit_missing_ip_fail_open",
  "rate_limit_unavailable_fail_open",
  "refund_notification_missing_recipient",
  "refund_notification_missing_tenant",
  "server_session_lookup_failed",
  "shippo_webhook_event_ignored",
  "shippo_webhook_invalid_token",
  "shippo_webhook_missing_tracking_data",
  "shippo_webhook_processed",
  "shippo_webhook_status_ignored",
  "shippo_webhook_transaction_created_ignored",
] as const;
const routes = [
  "/api/account/addresses",
  "/api/account/addresses/:addressId",
  "/api/account/orders",
  "/api/account/password",
  "/api/account/shipping",
  "/api/admin/orders",
  "/api/admin/orders/:orderId/fulfill",
  "/api/admin/orders/:orderId/pickup",
  "/api/admin/products",
  "/api/admin/products/:id",
  "/api/admin/products/:id/duplicate",
  "/api/admin/profile",
  "/api/admin/shipping/carriers",
  "/api/admin/shipping/defaults",
  "/api/admin/shipping/origin",
  "/api/admin/shipping/rates",
  "/api/admin/store-access",
  "/api/admin/tags/aliases",
  "/api/admin/tags/aliases/:id",
  "/api/admin/tags/brands",
  "/api/admin/tags/brands/:id",
  "/api/admin/tags/candidates",
  "/api/admin/tags/candidates/:id/accept",
  "/api/admin/tags/candidates/:id/reject",
  "/api/admin/tags/models",
  "/api/admin/tags/models/:id",
  "/api/admin/tags/parse-title",
  "/api/admin/uploads/product-image",
  "/api/auth/2fa/challenge/start",
  "/api/auth/2fa/challenge/verify",
  "/api/auth/2fa/enroll",
  "/api/auth/2fa/verify-enrollment",
  "/api/auth/forgot-password",
  "/api/auth/forgot-password/verify-code",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/otp/request",
  "/api/auth/otp/verify",
  "/api/auth/register",
  "/api/auth/resend-verification",
  "/api/auth/session",
  "/api/auth/update-password",
  "/api/auth/verify-email",
  "/api/contact",
  "/api/store/filters",
  "/api/store/products",
  "/api/store/products/:id",
  "/checkout",
  "/api/orders/:orderId",
  "/order-status/:orderId",
  "/api/checkout/prepare",
  "/api/checkout/quote",
  "/api/checkout/payment-permit",
  "/api/checkout/pay",
  "/api/cart/validate",
  "/api/webhooks/square",
  "/api/webhooks/shippo",
  "/api/cron/expire-checkouts",
  "/api/cron/checkout-notifications",
  "/api/cron/checkout-health",
  "/api/admin/shipping/labels",
] as const;
const outcomes = [
  "allowed",
  "denied",
  "unavailable",
  "busy",
  "acquired",
  "release_failed",
  "retry",
  "done",
  "review",
  "dispatch",
  "observe",
  "sent",
  "failed",
  "lost",
  "completed",
  "degraded",
  "observed",
  "recovery_fallback",
] as const;
const operations = [
  "new_prepare",
  "resume",
  "gateway_attempt",
  "decline",
  "address",
  "coarse",
  "recovery",
  "mail",
  "square",
  "smtp",
  "shippo",
] as const;
const levels = ["debug", "info", "warn", "error"] as const;
const layers = [
  "proxy",
  "auth",
  "api",
  "service",
  "repository",
  "job",
  "cache",
  "infra",
  "lib",
  "observability",
  "frontend",
  "unknown",
] as const;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function member<T extends string>(choices: readonly T[], value: unknown): T | undefined {
  return choices.find((choice) => choice === value);
}
function reference(value: unknown) {
  return typeof value === "string" && uuid.test(value) ? value : undefined;
}
function routeTemplate(value: unknown) {
  if (typeof value !== "string" || value.length > 8192) return undefined;
  try {
    const { pathname } = new URL(value, "https://route.invalid");
    if (/^\/api\/orders\/[^/]+\/?$/.test(pathname)) return "/api/orders/:orderId";
    if (/^\/order-status\/[^/]+\/?$/.test(pathname)) return "/order-status/:orderId";
    return member(routes, pathname);
  } catch {
    return undefined;
  }
}
function integer(value: unknown, min: number, max: number) {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= min &&
    value <= max
    ? value
    : undefined;
}
export type SafeLifecycleEvent = ReturnType<typeof safeFields>;
function safeFields(v: Record<string, unknown>) {
  const level = member(levels, v.level) ?? "info";
  const event =
    member(events, v.event) ??
    member(events, v.message) ??
    (v.message === "Square payment method unavailable"
      ? "square_method_unavailable"
      : undefined) ??
    (level === "error" ? "application_error" : "application_event");
  return {
    level,
    layer: member(layers, v.layer) ?? "unknown",
    event,
    message: member(knownMessages, v.message) ?? event,
    method: member(
      ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const,
      v.method,
    ),
    route: routeTemplate(v.route),
    status: integer(v.status, 100, 599),
    latency_ms: integer(v.latencyMs ?? v.latency_ms, 0, 86400000),
    requestId: reference(v.requestId),
    orderId: reference(v.orderId),
    attemptId: reference(v.attemptId),
    state: member(
      [
        "ready",
        "dispatch_started",
        "pending",
        "unknown",
        "succeeded",
        "declined",
        "canceled",
        "review",
      ] as const,
      v.state,
    ),
    release:
      typeof v.release === "string" && /^[\da-f]{40}$/i.test(v.release)
        ? v.release
        : undefined,
    paymentMethod: member(
      ["card", "applePay", "cashAppPay", "afterpay"] as const,
      v.paymentMethod,
    ),
    alert: member(
      [
        "health_unavailable",
        "missing_heartbeat",
        "stale_heartbeat",
        "manual_review",
        "old_unknown",
        "old_pending",
        "overdue_recovery",
        "overdue_hold",
        "overdue_webhook",
        "overdue_mail",
        "expired_lease",
        "database_pressure",
        "foreground_admission_unconfigured",
      ] as const,
      v.alert,
    ),
    phase: member(["load", "create", "attach", "tokenize"] as const, v.phase),
    admissionPhase: member(["preflight", "authority"] as const, v.admissionPhase),
    denialReason: member(["quota", "paused", "not_payable"] as const, v.denialReason),
    operation: member(operations, v.operation),
    outcome: member(outcomes, v.outcome),
  };
}
export function sanitizeLifecycleEvent(input: unknown): SafeLifecycleEvent {
  return safeFields(
    input && typeof input === "object" ? (input as Record<string, unknown>) : {},
  );
}
