import { createSupabaseAdminClient } from "@/lib/supabase/service-role";
import { listSpecialtyDiscoveryPool } from "@/Modules/SpecialtyProducts/Source/Features/Discovery/discovery";
export const dynamic = "force-dynamic";
export async function GET(): Promise<Response> {
  try {
    return Response.json(
      { products: await listSpecialtyDiscoveryPool(createSupabaseAdminClient()) },
      {
        headers: {
          "Cache-Control": "public, max-age=0, s-maxage=5, must-revalidate",
          "CDN-Cache-Control": "public, s-maxage=5, must-revalidate",
          "Vercel-CDN-Cache-Control": "public, s-maxage=5, must-revalidate",
        },
      },
    );
  } catch {
    return Response.json(
      { products: [] },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
