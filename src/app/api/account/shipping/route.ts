// app/api/account/shipping/route.ts

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AddressesRepository } from "@/repositories/addresses-repo";
import { ShippingService } from "@/services/shipping-service";
import { AccountSessionError, requireAccountSession } from "@/lib/account/session";
import { getRequestIdFromHeaders } from "@/lib/http/request-id";
import { logError } from "@/lib/utils/log";
import type { Tables, TablesInsert } from "@/types/db/database.types";

type ShippingProfileUpsert = TablesInsert<"shipping_profiles">;

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() || null : value;
}

const nullableText = z.preprocess(normalizeText, z.string().min(1).nullable());
const shippingDetailsSchema = z
  .object({
    full_name: nullableText,
    phone: nullableText,
    address_line1: nullableText,
    address_line2: nullableText,
    city: nullableText,
    state: nullableText,
    postal_code: nullableText,
    country: nullableText,
  })
  .strict();

const shippingProfileSchema = z.union([
  shippingDetailsSchema.partial(),
  shippingDetailsSchema.extend({ savedAddressId: z.string().uuid() }),
]);

type ShippingDetails = z.infer<typeof shippingDetailsSchema>;

function toShippingDetails(address: Tables<"user_addresses">): ShippingDetails {
  return {
    full_name: address.name,
    phone: address.phone,
    address_line1: address.line1,
    address_line2: address.line2,
    city: address.city,
    state: address.state,
    postal_code: address.postal_code,
    country: address.country,
  };
}

function matchesSnapshot(current: ShippingDetails, snapshot: ShippingDetails) {
  const fields = Object.keys(current) as (keyof ShippingDetails)[];
  return fields.every((field) => normalizeText(current[field]) === snapshot[field]);
}

export async function GET(request: NextRequest) {
  const requestId = getRequestIdFromHeaders(request.headers);

  try {
    const session = await requireAccountSession(request, "read");
    const supabase = await createSupabaseServerClient();
    const service = new ShippingService(supabase);

    const profile = await service.getProfile(session.user.id);

    return NextResponse.json(profile || {}, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AccountSessionError) {
      return NextResponse.json(
        { error: error.message, requestId },
        { status: error.status, headers: { "Cache-Control": "no-store" } },
      );
    }
    logError(error, {
      layer: "api",
      requestId,
      route: "/api/account/shipping",
    });
    return NextResponse.json(
      { error: "Failed to fetch shipping profile", requestId },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function POST(request: NextRequest) {
  const requestId = getRequestIdFromHeaders(request.headers);

  try {
    const session = await requireAccountSession(request, "write");
    const supabase = await createSupabaseServerClient();
    const service = new ShippingService(supabase);

    const body = await request.json().catch(() => null);
    const parsed = shippingProfileSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload", issues: parsed.error.format(), requestId },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    let details: Partial<ShippingDetails> = parsed.data;
    if ("savedAddressId" in parsed.data) {
      const { savedAddressId } = parsed.data;
      const repo = new AddressesRepository(supabase);
      const row = await repo.getUserAddress(session.user.id, savedAddressId);
      const current =
        row?.user_id === session.user.id && row.id === savedAddressId
          ? toShippingDetails(row)
          : null;

      if (!current || !matchesSnapshot(current, parsed.data)) {
        return NextResponse.json(
          { code: "saved_address_changed", error: "Saved address changed", requestId },
          { status: 412, headers: { "Cache-Control": "no-store" } },
        );
      }
      details = current;
    }

    const input: ShippingProfileUpsert = {
      user_id: session.user.id,
      tenant_id: session.profile?.tenant_id ?? null,
      ...details,
      updated_at: new Date().toISOString(),
    };

    const profile = await service.upsertProfile(input);

    return NextResponse.json(profile, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AccountSessionError) {
      return NextResponse.json(
        { error: error.message, requestId },
        { status: error.status, headers: { "Cache-Control": "no-store" } },
      );
    }
    logError(error, {
      layer: "api",
      requestId,
      route: "/api/account/shipping",
    });
    return NextResponse.json(
      { error: "Failed to save shipping profile", requestId },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
