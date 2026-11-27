"use client";

import { useEffect, useState } from "react";

export function LoadingAnnouncement({ label }: { label: string }) {
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    // Give the empty live region a paint before adding the announcement.
    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => setAnnouncement(label));
    });

    return () => window.cancelAnimationFrame(frame);
  }, [label]);

  return (
    <span role="status" aria-atomic="true" className="sr-only">
      {announcement === label ? announcement : ""}
    </span>
  );
}
