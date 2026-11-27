import { saveSpecialtyProductHandler } from "@/Modules/SpecialtyProducts/Source/Features/ManageProducts/specialty-product-handler";
export const runtime = "nodejs";
export function POST(request: Request) {
  return saveSpecialtyProductHandler(request, null);
}
