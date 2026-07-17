import type { ReactNode } from "react";

import { Footer } from "@/components/shell/Footer";
import { StorefrontHeader } from "@/components/shell/StorefrontHeader";

type AuthShellProps = {
  children: ReactNode;
};

export default function AuthShell({ children }: AuthShellProps) {
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
