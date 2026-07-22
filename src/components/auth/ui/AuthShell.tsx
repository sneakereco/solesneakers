import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";

import { Footer } from "@/components/shell/Footer";
import { StorefrontHeader } from "@/components/shell/StorefrontHeader";

type AuthShellProps = {
  children: ReactNode;
  isSiteLocked?: boolean;
};

export default function AuthShell({ children, isSiteLocked = false }: AuthShellProps) {
  if (isSiteLocked) {
    return (
      <div data-auth-shell className="min-h-[100svh] bg-[#f8f8f6] text-black">
        <header className="relative flex h-20 items-center justify-center border-b border-zinc-200 sm:h-24">
          <Link href="/locked" aria-label="Return to the locked storefront">
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
          </Link>
        </header>

        <main
          data-auth-content
          className="mx-auto flex min-h-[calc(100svh-5rem)] items-center justify-center px-6 py-12 sm:min-h-[calc(100svh-6rem)] sm:px-8 lg:px-12"
        >
          <div className="w-full sm:w-[min(28.7vw,34.375rem)] sm:min-w-[24rem]">
            {children}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div data-auth-shell className="min-h-screen bg-[#f8f8f6] text-black">
      <StorefrontHeader />
      <main
        data-auth-content
        className="mx-auto flex min-h-screen justify-center px-6 pb-20 pt-40 sm:px-8 sm:pt-[min(20.05vw,24.1rem)] lg:px-12"
      >
        <div className="w-full sm:min-w-[24rem] sm:w-[min(28.7vw,34.375rem)]">
          {children}
        </div>
      </main>
      <Footer />
    </div>
  );
}
