import Link from "next/link";
import type { SpecialtyProductPageData } from "./discovery";
import { SpecialtyProductCard } from "./SpecialtyProductCard";
import { ClaimedPrizeNotice } from "./ClaimedPrizeNotice";

export function SpecialtyProductPage({ product, claimed }: SpecialtyProductPageData) {
  return (
    <main className="mx-auto max-w-xl px-4 py-12">
      {claimed && (
        <div className="mb-8 space-y-3 text-center">
          <h1 className="text-2xl font-semibold">Already claimed</h1>
          <ClaimedPrizeNotice productId={product.id} />
          <Link href="/store" className="inline-block min-h-11 py-3 underline">
            Continue shopping
          </Link>
        </div>
      )}
      <SpecialtyProductCard product={product} />
      <p className="mt-6 whitespace-pre-wrap text-sm text-zinc-700">
        {product.description}
      </p>
    </main>
  );
}
