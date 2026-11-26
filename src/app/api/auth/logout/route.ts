import { isChunkLike } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/config/env";
import { clearAdminSessionCookie } from "@/lib/http/admin-session-cookie";
import { withRequestDeadline } from "@/lib/http/request-deadline";
import { getRequestIdFromHeaders } from "@/lib/http/request-id";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { logError } from "@/lib/utils/log";
import { AuthService } from "@/services/auth-service";

export async function POST(request: NextRequest) {
  // Leave time to deliver local cookie expiry inside the browser's request deadline.
  try {
    await withRequestDeadline(
      async (signal) => {
        const supabase = await createSupabaseServerClient(signal);
        await new AuthService(supabase).signOut();
      },
      undefined,
      5000,
    );
  } catch (error) {
    logError(error, {
      layer: "auth",
      requestId: getRequestIdFromHeaders(request.headers),
      route: "/api/auth/logout",
    });
  }

  const response = clearAdminSessionCookie(
    NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } }),
  );
  // This is the default storage key used by our Supabase SSR client.
  const hostname = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname;
  const storageKey = `sb-${hostname.split(".")[0]}-auth-token`;
  const authKeys = [storageKey, storageKey + "-code-verifier", storageKey + "-user"];
  for (const { name } of request.cookies.getAll()) {
    if (authKeys.some((key) => isChunkLike(name, key))) response.cookies.delete(name);
  }
  return response;
}
