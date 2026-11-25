import Image from "next/image";
import Link from "next/link";
import type { SpecialtyPublicProduct } from "../Claim/claim-contract";
export function SpecialtyProductCard({
  product,
  view = "grid",
}: {
  product: SpecialtyPublicProduct;
  view?: "grid" | "list";
}) {
  return (
    <article
      data-testid="specialty-product-card"
      data-product-id={product.id}
      className={
        view === "list"
          ? "grid grid-cols-[8rem_1fr] items-center gap-6 px-2 py-8 sm:grid-cols-[18rem_1fr] sm:px-6"
          : "min-w-0 text-center"
      }
    >
      <Link
        href={"/store/" + product.id}
        className="relative block aspect-[1/1.02] bg-[var(--storefront-surface)]"
      >
        {product.imageUrl && (
          <Image
            src={product.imageUrl}
            alt={product.name}
            fill
            sizes="(min-width: 1024px) 25vw, 50vw"
            className="object-contain p-4"
          />
        )}
      </Link>
      <div className="px-2 pb-3 pt-4">
        <h2 className="min-h-10 text-xs font-medium uppercase leading-5 text-zinc-900">
          <Link href={"/store/" + product.id}>{product.name}</Link>
        </h2>
        <p className="mt-1 text-xs text-zinc-600">Free giveaway</p>
        <Link
          href={"/store/" + product.id}
          className="mt-3 inline-flex min-h-11 items-center justify-center bg-zinc-950 px-5 py-2 text-sm text-white"
        >
          {product.claimable ? "Claim" : "Unavailable"}
        </Link>
      </div>
    </article>
  );
}
