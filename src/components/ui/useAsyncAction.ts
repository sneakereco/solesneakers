"use client";

import { useCallback, useRef, useState } from "react";

export function useAsyncAction() {
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);

  const run = useCallback(
    async <T>(operation: () => Promise<T>): Promise<T | undefined> => {
      if (inFlight.current) {
        return undefined;
      }

      inFlight.current = true;
      setPending(true);
      try {
        return await operation();
      } finally {
        inFlight.current = false;
        setPending(false);
      }
    },
    [],
  );

  return { pending, run };
}
