"use client";

import { usePathname } from "next/navigation";

const routeTitles: Array<[string, string]> = [
  ["/admin/inventory/create", "Add product"],
  ["/admin/inventory", "Inventory"],
  ["/admin/featured-items", "Featured items"],
  ["/admin/transactions", "Transactions"],
  ["/admin/shipping", "Shipping"],
  ["/admin/pickups", "Pickups"],
  ["/admin/tags", "Product tags"],
  ["/admin/settings/store-access", "Store access"],
  ["/admin/settings/shipping", "Shipping settings"],
  ["/admin/profile", "Profile"],
  ["/admin/dashboard", "Dashboard"],
];

export function AdminTopbar() {
  const pathname = usePathname();
  const title =
    routeTitles.find(([prefix]) => pathname.startsWith(prefix))?.[1] ?? "Admin";

  return (
    <header
      data-admin-topbar
      className="sticky top-0 z-30 border-b border-black/10 bg-[#f4f4f0]/95 px-4 py-3 backdrop-blur-xl sm:px-6 md:px-8 xl:px-10"
    >
      <div className="mx-auto flex h-11 w-full max-w-[96rem] items-center pl-0 pr-14 md:pr-0">
        <div className="min-w-0">
          <p className="text-[0.62rem] font-semibold uppercase tracking-[0.24em] text-zinc-500">
            Solesneakers / Admin
          </p>
          <p className="mt-0.5 truncate text-sm font-medium text-zinc-950">{title}</p>
        </div>
      </div>
    </header>
  );
}
