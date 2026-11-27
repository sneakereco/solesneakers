// src/lib/supabase/session-refresh.ts
// used to refresh supabase session cookies
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { temporaryUnavailableResponse } from "@/lib/http/temporary-unavailable";
import { withRequestDeadline } from "@/lib/http/request-deadline";
import { env } from "@/config/env";
import type { Database } from "@/types/db/database.types";

export async function refreshSession(request: NextRequest) {
  try {
    return await withRequestDeadline((signal) => refreshWithinDeadline(request, signal));
  } catch (error) {
    if (!(error instanceof DOMException) || error.name !== "TimeoutError") throw error;
    return temporaryUnavailableResponse(request);
  }
}

async function refreshWithinDeadline(request: NextRequest, signal: AbortSignal) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL!,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          if (signal.aborted) return;
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: This call refreshes the session
  await supabase.auth.getUser();

  return supabaseResponse;
}
