// app/account/page.tsx

import Link from "next/link";

import { requireUser } from "@/lib/auth/session";
import { AccountProfile } from "@/components/account/AccountProfile";

export default async function AccountPage() {
  let session;

  try {
    session = await requireUser();
  } catch {
    return (
      <div className="min-h-[36rem] bg-[var(--storefront-surface)] px-5 py-24 text-center text-black sm:px-8">
        <p className="text-[0.68rem] uppercase tracking-[0.28em] text-zinc-500">
          Customer account
        </p>
        <h1 className="mt-4 text-3xl font-normal tracking-[-0.03em] sm:text-5xl">
          Sign in to view your account
        </h1>
        <p className="mx-auto mt-5 max-w-lg text-sm leading-6 text-zinc-500 sm:text-base">
          Access your saved addresses, order history, and account security settings.
        </p>
        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/auth/login"
            className="inline-flex min-h-12 min-w-44 items-center justify-center bg-[#1f1f1d] px-7 text-xs font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-black"
          >
            Sign In
          </Link>
          <Link
            href="/auth/register"
            className="inline-flex min-h-12 min-w-44 items-center justify-center border border-zinc-400 px-7 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-800 transition-colors hover:border-black hover:text-black"
          >
            Create Account
          </Link>
        </div>
      </div>
    );
  }

  return <AccountProfile userEmail={session.user.email} />;
}
