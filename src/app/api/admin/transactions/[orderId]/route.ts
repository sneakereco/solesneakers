// app/api/admin/transactions/[orderId]/route.ts
// Returns a complete transaction detail payload for the admin transaction detail page.
// Aggregates: order + items + payment_transaction + Square lifecycle + email_audit_log + shipping

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/service-role";
import { createStaffCostReader } from "@/repositories/staff-cost-reader";
import { hydrateStaffOrderCosts } from "@/repositories/staff-order-costs";
import { requireAdminApi } from "@/lib/auth/session";
import { buildCustomerDisplayId } from "@/lib/admin/customer-identifiers";
import { getRequestIdFromHeaders } from "@/lib/http/request-id";
import { logError } from "@/lib/utils/log";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const requestId = getRequestIdFromHeaders(request.headers);
  const { orderId } = await params;

  try {
    await requireAdminApi();
    const supabase = await createSupabaseServerClient();

    // --- Order + items + shipping ---
    const { data: scopedOrder, error: orderError } = await supabase
      .from("orders")
      .select(
        `
        *,
        items:order_items(
          id, product_name, brand, model, category, condition, variant_sku, size_label,
          quantity, unit_price, line_total, refund_amount, refunded_at,
          product:products(
            id, name, category, description, created_at,
            images:product_images(url, is_primary, sort_order)
          ),
          variant:product_variants(id, sku, sale_price_cents)
        )
        `,
      )
      .eq("id", orderId)
      .maybeSingle();

    if (orderError) {
      throw orderError;
    }
    if (!scopedOrder) {
      return NextResponse.json(
        { error: "Order not found", requestId },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }

    const [pricedOrder] = await hydrateStaffOrderCosts(
      [scopedOrder],
      createStaffCostReader(supabase),
    );
    // Profiles and shipping details may require service access. Bind the joins to the order returned by RLS.
    const admin = createSupabaseAdminClient();
    const { data: details, error: detailsError } = await admin
      .from("orders")
      .select("profiles!user_id(email, full_name), shipping_address:order_shipping(*)")
      .eq("id", scopedOrder.id)
      .maybeSingle();
    if (detailsError) throw detailsError;
    if (!details)
      return NextResponse.json(
        { error: "Order not found", requestId },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    const order = {
      ...pricedOrder,
      profiles: details.profiles,
      shipping_address: details.shipping_address,
    };

    // --- Payment transaction ---
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: paymentTxRows } = await (admin as any)
      .from("payment_transactions")
      .select("*")
      .eq("order_id", order.id)
      .order("created_at", { ascending: false });
    const paymentTx =
      paymentTxRows?.find(
        (payment: { square_payment_id?: string }) =>
          order.payment_transaction_id &&
          payment.square_payment_id === order.payment_transaction_id,
      ) ??
      paymentTxRows?.[0] ??
      null;
    const customerEmail =
      order.profiles?.email ?? order.guest_email ?? paymentTx?.customer_email ?? null;
    const customerName =
      (Array.isArray(order.shipping_address)
        ? order.shipping_address[0]?.name
        : order.shipping_address?.name) ??
      order.profiles?.full_name ??
      paymentTx?.billing_name ??
      customerEmail ??
      "Customer";
    const customerIdentity = order.user_id
      ? { kind: "account" as const, userId: order.user_id }
      : customerEmail
        ? { kind: "guest" as const, email: customerEmail }
        : null;

    // Square refund and standard dispute records share the checkout timeline.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: squareRefunds, error: squareRefundsError } = await (admin as any)
      .from("square_refunds")
      .select("square_refund_id, status, amount_cents, currency, reason, updated_at")
      .eq("order_id", order.id)
      .order("updated_at", { ascending: true });
    if (squareRefundsError) {
      throw squareRefundsError;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: squareDisputes, error: squareDisputesError } = await (admin as any)
      .from("square_disputes")
      .select(
        "square_dispute_id, state, reason, amount_cents, currency, due_at, updated_at",
      )
      .eq("order_id", order.id)
      .order("updated_at", { ascending: true });
    if (squareDisputesError) {
      throw squareDisputesError;
    }

    const squareLifecycleEvents = [
      ...(squareRefunds ?? []).map(
        (refund: {
          square_refund_id: string;
          status: string;
          amount_cents: number;
          currency: string;
          reason: string | null;
          updated_at: string;
        }) => ({
          id: `square-refund-${refund.square_refund_id}`,
          event_type: `square_refund_${refund.status.toLowerCase()}`,
          event_data: refund,
          created_at: refund.updated_at,
        }),
      ),
      ...(squareDisputes ?? []).map(
        (dispute: {
          square_dispute_id: string;
          state: string;
          reason: string;
          amount_cents: number;
          currency: string;
          due_at: string | null;
          updated_at: string;
        }) => ({
          id: `square-dispute-${dispute.square_dispute_id}`,
          event_type: "square_dispute_alert",
          event_data: dispute,
          created_at: dispute.updated_at,
        }),
      ),
    ];

    // --- Email audit log ---
    const { data: emailLogs, error: emailReadError } = await supabase
      .from("email_audit_log")
      .select(
        "id, email_type, recipient_email, subject, sent_at, delivered_at, opened_at, delivery_status, message_id, html_snapshot, plain_text_snapshot",
      )
      .eq("order_id", order.id)
      .order("sent_at", { ascending: true });

    return NextResponse.json(
      {
        order,
        paymentTransaction: paymentTx,
        paymentEvents: squareLifecycleEvents.sort(
          (left, right) =>
            new Date(left.created_at).getTime() - new Date(right.created_at).getTime(),
        ),
        squareRefunds: squareRefunds ?? [],
        squareDisputes: squareDisputes ?? [],
        emailLogs: emailLogs ?? [],
        emailLogsAvailable: !emailReadError && Array.isArray(emailLogs),
        customer: customerIdentity
          ? {
              displayId: buildCustomerDisplayId(customerIdentity),
              kind: customerIdentity.kind,
              name: customerName,
              email: customerEmail,
            }
          : null,
        requestId,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    logError(error, {
      layer: "api",
      requestId,
      route: `/api/admin/transactions/${orderId}`,
    });
    return NextResponse.json(
      { error: "Failed to fetch transaction", requestId },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
