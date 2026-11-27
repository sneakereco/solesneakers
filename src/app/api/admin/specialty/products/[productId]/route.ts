import { saveSpecialtyProductHandler } from "@/Modules/SpecialtyProducts/Source/Features/ManageProducts/specialty-product-handler";
export const runtime = "nodejs";
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ productId: string }> },
) {
  return saveSpecialtyProductHandler(request, (await params).productId);
}
