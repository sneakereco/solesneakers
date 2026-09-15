// src/services/order-email-service.ts
import { emailSubjects, MAIL_REPLY_TO_EMAIL } from "@/config/constants/mail";
import { sendEmailWithRetry } from "@/lib/email/mailer";
import {
  buildOrderConfirmationEmail,
  buildOrderDeliveredEmail,
  buildOrderInTransitEmail,
  buildOrderLabelCreatedEmail,
  buildOrderRefundedEmail,
  buildPickupInstructionsEmail,
  type OrderConfirmationEmailInput,
  type OrderDeliveredEmailInput,
  type OrderInTransitEmailInput,
  type OrderLabelCreatedEmailInput,
  type OrderRefundedEmailInput,
  type PickupInstructionsEmailInput,
  type OrderItemEmail,
} from "@/lib/email/orders";
import { createSupabaseAdminClient } from "@/lib/supabase/service-role";
import type { TypedSupabaseClient } from "@/lib/supabase/server";

type EmailContent = { html: string; text: string };

/**
 * Mapper types: the "detailed" row shape you get from repo joins like:
 * order_items(*, product:products(..., images:product_images(...)), variant:product_variants(...))
 */
type ProductImageRow = {
  url: string;
  is_primary?: boolean | null;
  sort_order?: number | null;
};

type DetailedOrderItemRow = {
  quantity: number;
  unit_price?: number | null;
  line_total: number;
  product_name?: string | null;
  brand?: string | null;
  model?: string | null;
  category?: string | null;
  variant_sku?: string | null;
  size_label?: string | null;
  product: {
    name?: string | null;
    brand?: string | null;
    model?: string | null;
    category?: string | null;
    images?: ProductImageRow[] | null;
  } | null;
  variant: { sku?: string | null } | null;
};

const safeHttpsUrl = (value?: string | null) => {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
};

const pickPrimaryImage = (images?: ProductImageRow[] | null) => {
  if (!images?.length) {
    return null;
  }

  const primary = images.find((img) => img.is_primary);
  if (primary?.url) {
    return safeHttpsUrl(primary.url);
  }

  const sorted = [...images].sort(
    (a, b) => (a.sort_order ?? 9999) - (b.sort_order ?? 9999),
  );
  return safeHttpsUrl(sorted[0]?.url ?? null);
};

const mapOrderItemsToEmailItems = (rows: DetailedOrderItemRow[]): OrderItemEmail[] =>
  rows.map((row) => {
    const product = row.product;
    const title = row.product_name ?? product?.name ?? "Item";

    return {
      title,
      sizeLabel: row.size_label ?? null,
      quantity: row.quantity,
      unitPrice: row.unit_price ?? 0,
      lineTotal: row.line_total,

      imageUrl: pickPrimaryImage(product?.images ?? null),
      brand: row.brand ?? product?.brand ?? null,
      model: row.model ?? product?.model ?? null,
      category: row.category ?? product?.category ?? null,
      sku: row.variant_sku ?? row.variant?.sku ?? null,
    };
  });

export class OrderEmailService {
  constructor(
    private readonly supabase?: TypedSupabaseClient | null,
    private readonly tenantId?: string | null,
    private readonly notificationId?: string,
  ) {}

  private async send(
    to: string,
    subject: string,
    content: EmailContent,
    orderId: string,
    emailType: string,
  ) {
    const db = this.supabase ?? createSupabaseAdminClient();
    let tenantId = this.tenantId;
    if (!tenantId) {
      const { data, error } = await db
        .from("orders")
        .select("tenant_id")
        .eq("id", orderId)
        .single();
      if (error) {
        throw error;
      }
      tenantId = data.tenant_id;
    }
    if (!tenantId) {
      throw new Error("email_audit_missing_tenant");
    }
    const { data: audit, error: auditError } = await db
      .from("email_audit_log")
      .insert({
        order_id: orderId,
        tenant_id: tenantId,
        email_type: emailType,
        recipient_email: to,
        subject,
        html_snapshot: content.html,
        plain_text_snapshot: content.text,
        delivery_status: "pending",
        notification_id: this.notificationId ?? null,
      })
      .select("id")
      .single();
    if (auditError) {
      throw auditError;
    }

    let messageId: string | undefined;
    try {
      const result = await sendEmailWithRetry(
        {
          to,
          subject,
          html: content.html,
          text: content.text,
          replyTo: MAIL_REPLY_TO_EMAIL,
        },
        { maxAttempts: this.notificationId ? 1 : 3, baseDelayMs: 750, timeoutMs: 5000 },
      );
      messageId = result.messageId;
    } catch (error) {
      const { error: writeError } = await db
        .from("email_audit_log")
        .update({ delivery_status: "failed" })
        .eq("id", audit.id);
      if (writeError) {
        throw writeError;
      }
      throw error;
    }
    // SMTP acceptance is not proof of inbox delivery. Never mark this 'delivered'.
    const { error } = await db
      .from("email_audit_log")
      .update({ delivery_status: "sent", message_id: messageId ?? null })
      .eq("id", audit.id);
    if (error) {
      throw error;
    }
  }

  /**
   * Existing path (still supported): caller already supplies email-ready items.
   */
  async sendOrderConfirmation(input: OrderConfirmationEmailInput) {
    if (!input.to) {
      return;
    }
    const content = buildOrderConfirmationEmail(input);
    await this.send(
      input.to,
      emailSubjects.orderConfirmation(),
      content,
      input.orderId,
      "order_confirmation",
    );
  }

  /**
   * Preferred path when you have detailed repo-joined items and want guaranteed images + details.
   */
  async sendOrderConfirmationFromDetailed(params: {
    to: string | null;
    order: Omit<OrderConfirmationEmailInput, "items" | "to">;
    itemsDetailed: DetailedOrderItemRow[];
  }) {
    if (!params.to) {
      return;
    }

    const items = mapOrderItemsToEmailItems(params.itemsDetailed);

    const input: OrderConfirmationEmailInput = {
      ...params.order,
      to: params.to,
      items,
    };

    const content = buildOrderConfirmationEmail(input);
    await this.send(
      params.to,
      emailSubjects.orderConfirmation(),
      content,
      params.order.orderId,
      "order_confirmation",
    );
  }

  async sendPickupInstructions(input: PickupInstructionsEmailInput) {
    if (!input.to) {
      return;
    }
    const content = buildPickupInstructionsEmail(input);
    await this.send(
      input.to,
      emailSubjects.pickupInstructions(input.orderId),
      content,
      input.orderId,
      "pickup_instructions",
    );
  }

  async sendOrderLabelCreated(input: OrderLabelCreatedEmailInput) {
    if (!input.to) {
      return;
    }
    const content = buildOrderLabelCreatedEmail(input);
    await this.send(
      input.to,
      emailSubjects.orderLabelCreated(input.orderId),
      content,
      input.orderId,
      "label_created",
    );
  }

  async sendOrderInTransit(input: OrderInTransitEmailInput) {
    if (!input.to) {
      return;
    }
    const content = buildOrderInTransitEmail(input);
    await this.send(
      input.to,
      emailSubjects.orderInTransit(input.orderId),
      content,
      input.orderId,
      "in_transit",
    );
  }

  async sendOrderDelivered(input: OrderDeliveredEmailInput) {
    if (!input.to) {
      return;
    }
    const content = buildOrderDeliveredEmail(input);
    await this.send(
      input.to,
      emailSubjects.orderDelivered(input.orderId),
      content,
      input.orderId,
      "delivered",
    );
  }

  async sendOrderRefunded(input: OrderRefundedEmailInput) {
    if (!input.to) {
      return;
    }
    const content = buildOrderRefundedEmail(input);
    await this.send(
      input.to,
      emailSubjects.orderRefunded(input.orderId),
      content,
      input.orderId,
      "refund_notification",
    );
  }
}
