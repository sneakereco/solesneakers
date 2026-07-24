"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight } from "lucide-react";

const routeTitles: Array<[string, string]> = [
  ["/admin/inventory/create", "Add product"],
  ["/admin/inventory", "Inventory"],
  ["/admin/featured-items", "Featured items"],
  ["/admin/transactions", "Transactions"],
  ["/admin/customers", "Customers"],
  ["/admin/shipping", "Shipping"],
  ["/admin/pickups", "Pickups"],
  ["/admin/nexus", "Tax & nexus"],
  ["/admin/tags", "Product tags"],
  ["/admin/settings/store-access", "Store access"],
  ["/admin/settings/shipping", "Shipping settings"],
  ["/admin/settings/taxes", "Tax settings"],
  ["/admin/profile", "Profile"],
  ["/admin/dashboard", "Dashboard"],
];

export function AdminTopbar({ userEmail }: { userEmail?: string | null }) {
  const pathname = usePathname();
  const title =
    routeTitles.find(([prefix]) => pathname.startsWith(prefix))?.[1] ?? "Admin";

  return (
    <header
      data-admin-topbar
      className="sticky top-0 z-30 border-b border-black/10 bg-[#f4f4f0]/95 px-4 py-3 backdrop-blur-xl sm:px-6 md:px-8 xl:px-10"
    >
      <div className="mx-auto flex h-11 w-full max-w-[96rem] items-center justify-between gap-4 pl-0 pr-14 md:pr-0">
        <div className="min-w-0">
          <p className="text-[0.62rem] font-semibold uppercase tracking-[0.24em] text-zinc-500">
            Sole Sneakers / Admin
          </p>
          <p className="mt-0.5 truncate text-sm font-medium text-zinc-950">{title}</p>
        </div>
        <div className="flex items-center gap-4">
          {userEmail && (
            <span className="hidden max-w-52 truncate text-xs text-zinc-500 lg:block">
              {userEmail}
            </span>
          )}
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-full border border-black/15 bg-white px-4 py-2 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-black transition hover:border-black hover:bg-black hover:text-white"
          >
            Storefront
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </header>
  );
}
