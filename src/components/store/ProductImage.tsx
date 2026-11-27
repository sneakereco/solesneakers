"use client";

import Image, { type ImageProps } from "next/image";
import { useState } from "react";

type ProductImageProps = Omit<ImageProps, "src" | "onLoad" | "onError"> & { src: string };

// Remount only the photo when the shopper selects a different view.
export function ProductImage(props: ProductImageProps) {
  return <Photo key={props.src} {...props} />;
}

function Photo({ alt, ...props }: ProductImageProps) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  return (
    <span className="absolute inset-0 block" aria-busy={state === "loading" || undefined}>
      {state === "loading" && (
        <span
          aria-hidden="true"
          data-ui-skeleton
          className="absolute inset-0 h-full w-full"
        />
      )}
      {state === "error" ? (
        <span className="absolute inset-0 grid place-items-center text-center text-xs text-zinc-600">
          Image unavailable
        </span>
      ) : (
        <Image
          {...props}
          alt={alt}
          onLoad={() => setState("ready")}
          onError={() => setState("error")}
        />
      )}
    </span>
  );
}
