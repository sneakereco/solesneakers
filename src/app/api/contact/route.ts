// app/api/contact/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/service-role";
import { sendEmail } from "@/lib/email/mailer";
import { buildContactSubmissionEmail } from "@/lib/email/contact";
import { ContactMessagesRepository } from "@/repositories/contact-messages-repo";
import { getRequestIdFromHeaders } from "@/lib/http/request-id";
import { logError } from "@/lib/utils/log";
import { env } from "@/config/env";
import { security } from "@/config/security";
import { SUPPORT_EMAIL } from "@/config/constants/mail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const contactSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    email: z.string().trim().email().max(255),
    subject: z.string().trim().min(1).max(150),
    message: z.string().trim().min(1).max(4000),
  })
  .strict();

const redis = new Redis({
  url: env.UPSTASH_REDIS_REST_URL!,
  token: env.UPSTASH_REDIS_REST_TOKEN!,
});

const contactRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(
    security.contact.rateLimit.maxRequests,
    security.contact.rateLimit.window,
  ),
});

const getClientIp = (request: NextRequest): string => {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const firstIp = forwardedFor.split(",")[0]?.trim();
    if (firstIp) {
      return firstIp;
    }
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    return realIp;
  }

  return "unknown";
};

export async function POST(request: NextRequest) {
  const requestId = getRequestIdFromHeaders(request.headers);

  try {
    // Rate limit
    const clientIp = getClientIp(request);
    let rateResult: Awaited<ReturnType<typeof contactRateLimit.limit>> | null = null;

    try {
      rateResult = await contactRateLimit.limit(`contact:${clientIp}`);
    } catch (rateLimitError) {
      logError(rateLimitError, {
        layer: "api",
        requestId,
        route: "/api/contact",
        message: "contact_rate_limit_failed",
      });
    }

    if (rateResult && !rateResult.success) {
      return NextResponse.json(
        { ok: false, error: "Rate limit exceeded. Please try again later.", requestId },
        {
          status: security.contact.rateLimit.blockStatus,
          headers: {
            "Cache-Control": "no-store",
            "X-RateLimit-Limit": String(rateResult.limit),
            "X-RateLimit-Remaining": String(rateResult.remaining),
            "X-RateLimit-Reset": String(rateResult.reset),
          },
        },
      );
    }

    if (
      request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
      "application/json"
    ) {
      return NextResponse.json(
        { ok: false, error: "Content-Type must be application/json", requestId },
        { status: 415, headers: { "Cache-Control": "no-store" } },
      );
    }
    const body = await request.json().catch(() => null);
    const parsed = contactSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid payload", issues: parsed.error.format(), requestId },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    // Resolve request user from session cookies (if authenticated)
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // Persist with service role so contact submissions do not depend on anon insert RLS.
    const supabaseAdmin = createSupabaseAdminClient();
    const contactRepo = new ContactMessagesRepository(supabaseAdmin);

    await contactRepo.insertMessage({
      name: parsed.data.name,
      email: parsed.data.email,
      subject: parsed.data.subject,
      message: parsed.data.message,
      source: "contact_form",
      user_id: user?.id ?? null,
    });

    const { html, text, subjectPrefix } = buildContactSubmissionEmail({
      name: parsed.data.name,
      email: parsed.data.email,
      subject: parsed.data.subject,
      message: parsed.data.message,
    });

    try {
      await sendEmail({
        to: SUPPORT_EMAIL,
        subject: `${subjectPrefix}: ${parsed.data.subject}`,
        html,
        text,
      });
    } catch (emailError) {
      logError(emailError, {
        layer: "api",
        requestId,
        route: "/api/contact",
        message: "contact_email_failed",
      });
    }

    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logError(error, {
      layer: "api",
      requestId,
      route: "/api/contact",
    });

    return NextResponse.json(
      { ok: false, error: "Failed to send message", requestId },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
