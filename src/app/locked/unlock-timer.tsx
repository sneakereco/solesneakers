"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function UnlockTimer({ unlockAtIso }: { unlockAtIso: string }) {
  const router = useRouter();
  const [timeLeft, setTimeLeft] = useState<string>("");
  const navigatedOpening = useRef<string | null>(null);

  useEffect(() => {
    const unlockTime = new Date(unlockAtIso).getTime();
    let interval: ReturnType<typeof setInterval> | undefined;

    const updateTimer = () => {
      const now = new Date().getTime();
      const diff = unlockTime - now;

      if (diff <= 0) {
        clearInterval(interval);
        setTimeLeft("0h 0m 0s");
        if (navigatedOpening.current !== unlockAtIso) {
          navigatedOpening.current = unlockAtIso;
          router.replace("/");
        }
        return false;
      }

      // Calculate days, hours, minutes, seconds
      const h = Math.floor((diff / (1000 * 60 * 60)) % 24);
      const m = Math.floor((diff / 1000 / 60) % 60);
      const s = Math.floor((diff / 1000) % 60);

      setTimeLeft(`${h}h ${m}m ${s}s`);
      return true;
    };

    if (updateTimer()) {
      interval = setInterval(updateTimer, 1000);
    }

    return () => clearInterval(interval);
  }, [unlockAtIso, router]);

  return <span>{timeLeft || "soon"}</span>;
}
