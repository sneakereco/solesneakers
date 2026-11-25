"use client";

import { useEffect, useRef, useState } from "react";

const cooldownSeconds = 60;

export function useResendCooldown(initialSeconds = 0) {
  const [seconds, setSeconds] = useState(initialSeconds);
  const deadline = useRef(0);
  const coolingDown = seconds > 0;

  useEffect(() => {
    if (!coolingDown) return;
    deadline.current ||= Date.now() + initialSeconds * 1000;
    const timer = window.setInterval(() => {
      setSeconds(Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [coolingDown, initialSeconds]);

  function restart() {
    deadline.current = Date.now() + cooldownSeconds * 1000;
    setSeconds(cooldownSeconds);
  }

  return { seconds, restart };
}
