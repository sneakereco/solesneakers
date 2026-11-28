"use client";

import { ActionButton } from "@/components/ui/ActionButton";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight } from "lucide-react";

const outfits = [
  { image: "cream-outfit", alt: "Cream hoodie, washed denim, caps and sneakers" },
  { image: "colorful-tees", alt: "Graphic tees, gray sweats and red sneakers" },
  { image: "camo-hoodie", alt: "Camo hoodie, light denim and yellow-accented sneakers" },
  { image: "black-denim", alt: "Graphic raglan, black denim and sneakers" },
  { image: "graphic-camo", alt: "Graphic camo top, dark denim and colorful sneakers" },
  { image: "plaid-outfit", alt: "Printed plaid shirt, cream denim, caps and sneakers" },
];

export function OutfitSlideshow() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isInView, setIsInView] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(true);
  const [isPageVisible, setIsPageVisible] = useState(true);
  const sectionRef = useRef<HTMLElement>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setReducedMotion(preference.matches);
    const updateVisibility = () => setIsPageVisible(!document.hidden);
    const observer = new IntersectionObserver(
      ([entry]) => setIsInView(entry.isIntersecting),
      { threshold: 0.35 },
    );
    if (sectionRef.current) observer.observe(sectionRef.current);
    updatePreference();
    updateVisibility();
    preference.addEventListener("change", updatePreference);
    document.addEventListener("visibilitychange", updateVisibility);
    return () => {
      observer.disconnect();
      preference.removeEventListener("change", updatePreference);
      document.removeEventListener("visibilitychange", updateVisibility);
    };
  }, []);

  useEffect(() => {
    if (!isInView || !isPageVisible || isHovered || hasInteracted || reducedMotion)
      return;
    const timer = window.setTimeout(() => {
      setActiveIndex((index) => (index + 1) % outfits.length);
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [activeIndex, isInView, isPageVisible, isHovered, hasInteracted, reducedMotion]);

  const moveSlide = (direction: number) => {
    setHasInteracted(true);
    setActiveIndex((index) => (index + direction + outfits.length) % outfits.length);
  };

  const arrowClassName =
    "absolute top-1/2 z-10 flex h-16 w-12 -translate-y-1/2 items-center justify-center rounded text-white/45 transition-colors hover:text-white focus-visible:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-white";

  return (
    <section
      ref={sectionRef}
      aria-label="Outfit inspiration"
      aria-roledescription="carousel"
      className="relative h-[200px] w-full overflow-hidden bg-stone-400 md:h-[clamp(230px,22.222vw,360px)]"
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") setIsHovered(true);
      }}
      onPointerLeave={() => setIsHovered(false)}
      onFocusCapture={() => setHasInteracted(true)}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          moveSlide(event.key === "ArrowLeft" ? -1 : 1);
        }
      }}
    >
      <div
        aria-live={hasInteracted ? "polite" : "off"}
        className="absolute inset-0 touch-pan-y"
        onTouchStart={(event) => {
          const touch = event.changedTouches[0];
          touchStart.current = { x: touch.clientX, y: touch.clientY };
        }}
        onTouchEnd={(event) => {
          const start = touchStart.current;
          touchStart.current = null;
          if (!start) return;
          const touch = event.changedTouches[0];
          const horizontal = touch.clientX - start.x;
          if (
            Math.abs(horizontal) > 45 &&
            Math.abs(horizontal) > Math.abs(touch.clientY - start.y)
          ) {
            moveSlide(horizontal < 0 ? 1 : -1);
          }
        }}
        onTouchCancel={() => {
          touchStart.current = null;
        }}
      >
        {outfits.map((outfit, index) => {
          const isAdjacent =
            index === (activeIndex + 1) % outfits.length ||
            index === (activeIndex - 1 + outfits.length) % outfits.length;
          if (index !== activeIndex && !(isInView && isAdjacent)) return null;
          const src = `/images/homepage_outfits/${outfit.image}.webp`;
          return (
            <div
              key={outfit.image}
              aria-hidden={activeIndex !== index}
              className={`absolute inset-0 flex items-center justify-center motion-safe:transition-opacity motion-safe:duration-[550ms] motion-safe:ease-in-out ${activeIndex === index ? "opacity-100" : "opacity-0"}`}
            >
              {isInView && (
                <Image
                  src={src}
                  alt=""
                  aria-hidden="true"
                  fill
                  sizes="100vw"
                  draggable={false}
                  className="object-fill"
                />
              )}
              <Image
                src={src}
                alt={outfit.alt}
                width={2172}
                height={724}
                sizes="100vw"
                draggable={false}
                className="relative h-full w-auto max-w-none shrink-0 object-contain"
                style={{
                  maskImage:
                    "linear-gradient(90deg, transparent, black 10%, black 90%, transparent)",
                }}
              />
            </div>
          );
        })}
      </div>
      <ActionButton
        type="button"
        aria-label="Previous outfit"
        className={`${arrowClassName} left-0 md:left-3`}
        onClick={() => moveSlide(-1)}
      >
        <ChevronLeft className="h-7 w-7 stroke-[1.5]" aria-hidden="true" />
      </ActionButton>
      <ActionButton
        type="button"
        aria-label="Next outfit"
        className={`${arrowClassName} right-0 md:right-3`}
        onClick={() => moveSlide(1)}
      >
        <ChevronRight className="h-7 w-7 stroke-[1.5]" aria-hidden="true" />
      </ActionButton>
    </section>
  );
}
