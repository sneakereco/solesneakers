import { handleLoadTestControl } from "@/Modules/Checkout/Source/Features/LoadTesting/control-handler";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ operation: string }> },
): Promise<Response> {
  return handleLoadTestControl(request, (await params).operation);
}
