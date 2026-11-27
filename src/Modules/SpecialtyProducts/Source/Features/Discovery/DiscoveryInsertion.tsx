"use client";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { z } from "zod";
import type { SpecialtyPublicProduct } from "../Claim/claim-contract";
import { insertDiscoveryItem } from "./discovery-policy";
import { SpecialtyProductCard } from "./SpecialtyProductCard";
const poolSchema = z.object({
  products: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      description: z.string().nullable(),
      imageUrl: z.string().nullable(),
      claimable: z.boolean(),
    }),
  ),
});
type Item = { id: string; node: ReactNode };
export function DiscoveryInsertion({
  items,
  allowed,
  specialtyClassName,
  onDiscoveryChange,
  view = "grid",
}: {
  items: Item[];
  allowed: boolean;
  specialtyClassName?: string;
  onDiscoveryChange?: () => void;
  view?: "grid" | "list";
}) {
  const [choice, setChoice] = useState<{
    product: SpecialtyPublicProduct;
    position: number;
  } | null>(null);
  const seed = useRef<{ selection: number; position: number } | null>(null);
  const hasItems = items.length > 0;
  useEffect(() => {
    if (!allowed || !hasItems) return;
    const controller = new AbortController();
    if (!seed.current)
      seed.current = { selection: Math.random(), position: Math.random() };
    const { selection, position } = seed.current;
    void (async () => {
      try {
        const response = await fetch("/api/specialty/discovery", {
          signal: controller.signal,
        });
        if (!response.ok) return;
        const result = poolSchema.safeParse(await response.json());
        if (!controller.signal.aborted && result.success) {
          const product =
            result.data.products[Math.floor(selection * result.data.products.length)];
          setChoice(product ? { product, position } : null);
        }
      } catch {
        /* Ordinary catalog stays available if discovery is unavailable. */
      }
    })();
    return () => controller.abort();
  }, [allowed, hasItems]);
  useEffect(() => {
    onDiscoveryChange?.();
  }, [choice, onDiscoveryChange]);
  const rendered =
    allowed && choice
      ? insertDiscoveryItem(
          items,
          {
            id: "specialty:" + choice.product.id,
            node: (
              <div className={specialtyClassName}>
                <SpecialtyProductCard product={choice.product} view={view} />
              </div>
            ),
          },
          Math.floor(choice.position * (items.length + 1)),
        )
      : items;
  return (
    <>
      {rendered.map((item) => (
        <Fragment key={item.id}>{item.node}</Fragment>
      ))}
    </>
  );
}
