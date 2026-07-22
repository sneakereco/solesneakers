import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";

import { isAdminRole } from "@/config/constants/roles";
import { getServerSession } from "@/lib/auth/session";
import { getStoreAccessSettings } from "@/lib/store-access/get-store-access-settings";

import { UnlockTimer } from "./unlock-timer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Store Temporarily Closed | Sole Sneakers",
  description: "The Sole Sneakers storefront is temporarily closed.",
};

const lockAnnouncements = [
  "Orders placed before 3PM ship same day",
  "Follow @soles.neakers on IG",
  "New inventory daily",
  "Local pickups near Winston-Salem, High Point, Kernersville, Greensboro NC",
  "Always buying. DM me to get cashed out",
];

export default async function LockedPage(props: {
  searchParams?: Promise<{ next?: string }> | { next?: string };
}) {
  const searchParams = props.searchParams
    ? await Promise.resolve(props.searchParams)
    : undefined;
  const next = searchParams?.next || "/";
  const session = await getServerSession();

  if (session && isAdminRole(session.role)) {
    redirect(next);
  }

  const storeAccess = await getStoreAccessSettings();
  const unlockAtIso = storeAccess?.settings.siteUnlockAt ?? null;

  return (
    <main className="flex min-h-[100svh] flex-col bg-[var(--storefront-surface)] text-black">
      <div className="store-lock-marquee storefront-marquee storefront-marquee--visible bg-black text-white">
        <div className="storefront-marquee__track" aria-hidden="true">
          {[0, 1].map((copyIndex) => (
            <div key={copyIndex} className="storefront-marquee__group">
              {[...lockAnnouncements, ...lockAnnouncements].map(
                (announcement, announcementIndex) => (
                  <span
                    key={`${copyIndex}-${announcementIndex}-${announcement}`}
                    className="storefront-marquee__item"
                  >
                    {announcement}
                  </span>
                ),
              )}
            </div>
          ))}
        </div>
      </div>

      <header className="relative flex h-20 shrink-0 items-center justify-center border-b border-zinc-200 bg-[var(--storefront-surface)] sm:h-24">
        <Image
          src="/images/logo.png"
          alt="Sole Sneakers"
          width={140}
          height={100}
          sizes="140px"
          className="h-20 w-32 object-contain mix-blend-multiply sm:h-24 sm:w-36"
          priority
          unoptimized
        />

        <Link
          href={`/auth/login?next=${encodeURIComponent(next)}`}
          className="absolute right-5 top-1/2 -translate-y-1/2 text-[0.68rem] font-semibold uppercase tracking-[0.02em] text-zinc-700 transition-colors hover:text-black sm:right-8 sm:text-xs lg:right-14"
        >
          Admin Sign In
        </Link>
      </header>

      <section className="relative flex min-h-[34rem] flex-1 items-center justify-center overflow-hidden px-5 py-16 text-center text-white sm:px-8">
        <Image
          src="/images/hero.jpg"
          alt=""
          fill
          sizes="100vw"
          className="object-cover object-[50%_34%]"
          priority
        />
        <div className="absolute inset-0 bg-black/60" />

        <div className="relative mx-auto flex w-full max-w-4xl flex-col items-center">
          <h1 className="text-[2.5rem] font-black uppercase italic leading-[0.92] tracking-[-0.045em] sm:text-6xl lg:text-[5rem]">
            Storefront temporarily closed.
          </h1>
        </div>

        {unlockAtIso ? (
          <span className="sr-only" aria-hidden="true">
            <UnlockTimer unlockAtIso={unlockAtIso} />
          </span>
        ) : null}
      </section>
    </main>
  );
}
