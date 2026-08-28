import type { NextRequest } from "next/server";

import { expireCheckoutReservations } from "@/lib/checkout/expire-checkout-reservations";
import { getCronSecret, isAuthorizedCronRequest } from "@/lib/http/cron-auth";
import { getRequestIdFromHeaders } from "@/lib/http/request-id";
import { createSquarePaymentLinksGateway } from "@/lib/square/client";
import { createSupabaseAdminClient } from "@/lib/supabase/service-role";
import { logError } from "@/lib/utils/log";
import { CheckoutReservationRepository } from "@/repositories/checkout-reservation-repo";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest): Promise<Response> {
  const requestId = getRequestIdFromHeaders(request.headers);

  try {
    if (!isAuthorizedCronRequest(request, getCronSecret())) {
      return Response.json(
        { error: "Unauthorized", requestId },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }

    const repository = new CheckoutReservationRepository(createSupabaseAdminClient());
    const checkouts = await repository.listExpired(new Date().toISOString(), 50);
    let squareGateway: ReturnType<typeof createSquarePaymentLinksGateway> | null = null;
    const getSquareGateway = () => {
      squareGateway ??= createSquarePaymentLinksGateway();
      return squareGateway;
    };

    const result = await expireCheckoutReservations(checkouts, {
      deleteSquareLink: (paymentLinkId) => getSquareGateway().delete(paymentLinkId),
      markSquareLinkDeleted: (orderId, paymentLinkId) =>
        repository.markPaymentLinkDeleted(orderId, paymentLinkId),
      releaseReservation: (orderId, reason) => repository.release(orderId, reason),
      reportError: (error, orderId) =>
        logError(error, {
          layer: "api",
          requestId,
          route: "/api/cron/expire-checkouts",
          event: "checkout_expiration_failed",
          orderId,
        }),
    });

    return Response.json(
      { ...result, requestId },
      {
        status: result.failed > 0 ? 500 : 200,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    logError(error, {
      layer: "api",
      requestId,
      route: "/api/cron/expire-checkouts",
      event: "checkout_expiration_job_failed",
    });
    return Response.json(
      { error: "Checkout expiration failed", requestId },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
