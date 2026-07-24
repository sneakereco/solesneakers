"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  DollarSign,
  Package,
  ShoppingCart,
  Sparkles,
  Truck,
  Users,
} from "lucide-react";

import { logError } from "@/lib/utils/log";

type OrderSummary = {
  id: string;
  user_id?: string | null;
  total?: number | null;
  status?: string | null;
};

export default function DashboardPage() {
  const [productsCount, setProductsCount] = useState(0);
  const [orders, setOrders] = useState<OrderSummary[]>([]);

  useEffect(() => {
    Promise.all([
      fetch("/api/store/products?limit=1").then((response) => response.json()),
      fetch("/api/admin/orders").then((response) => response.json()),
    ])
      .then(([productsData, ordersData]) => {
        setProductsCount(Number(productsData.total ?? 0));
        setOrders(ordersData.orders ?? []);
      })
      .catch((error) => {
        logError(error, { layer: "frontend", event: "admin_load_dashboard" });
      });
  }, []);

  const completedOrders = orders.filter((order) =>
    ["paid", "shipped", "completed"].includes(order.status ?? ""),
  );
  const revenue = completedOrders.reduce(
    (sum, order) => sum + Number(order.total ?? 0),
    0,
  );

  const stats = [
    { label: "Revenue", value: `$${revenue.toFixed(2)}`, icon: DollarSign },
    { label: "Orders", value: String(completedOrders.length), icon: ShoppingCart },
    { label: "Products", value: String(productsCount), icon: Package },
  ];

  return (
    <div className="space-y-8">
      <section
        data-admin-inverse
        className="relative overflow-hidden rounded-[1.4rem] bg-black px-6 py-8 text-white sm:px-8 sm:py-10 lg:px-10"
      >
        <div className="absolute -right-20 -top-28 h-72 w-72 rounded-full border border-white/10" />
        <div className="absolute -right-6 -top-12 h-44 w-44 rounded-full border border-white/10" />
        <div className="relative flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
          <div>
            <p className="text-[0.62rem] font-semibold uppercase tracking-[0.32em] text-zinc-400">
              Sole Sneakers operations
            </p>
            <h1 className="mt-4 max-w-2xl text-white">Everything on deck.</h1>
            <p className="mt-4 max-w-lg text-sm leading-6 text-zinc-400">
              Inventory, orders, fulfillment, and storefront curation in one place.
            </p>
          </div>
          <Link
            href="/admin/inventory/create"
            className="inline-flex w-fit items-center gap-2 rounded-full bg-white px-5 py-3 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-black hover:bg-zinc-200"
          >
            Add product <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-3 sm:gap-6">
        {stats.map(({ label, value, icon: Icon }) => (
          <div
            key={label}
            className="rounded-xl border border-zinc-800/70 bg-zinc-900 p-5 sm:p-6"
          >
            <div className="mb-8 flex items-center justify-between">
              <span className="text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-gray-400">
                {label}
              </span>
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-800">
                <Icon className="h-4 w-4 text-gray-400" />
              </span>
            </div>
            <span className="text-3xl font-semibold tracking-[-0.04em] text-white">
              {value}
            </span>
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="rounded-xl border border-zinc-800/70 bg-zinc-900 p-5 sm:p-6">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="text-[0.62rem] font-semibold uppercase tracking-[0.2em] text-zinc-500">
                Live activity
              </p>
              <h2 className="mt-1.5 text-xl font-semibold text-white">Recent orders</h2>
            </div>
            <Link
              href="/admin/transactions"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-black"
            >
              View all <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-zinc-800/70 text-left text-sm text-gray-400">
                  <th className="py-3">Order</th>
                  <th className="py-3">Status</th>
                  <th className="py-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {orders.slice(0, 5).map((order) => (
                  <tr
                    key={order.id}
                    className="border-b border-zinc-800/70 text-sm text-white last:border-0"
                  >
                    <td className="py-4 font-medium">#{order.id.slice(0, 8)}</td>
                    <td className="py-4 capitalize text-gray-400">
                      {order.status ?? "pending"}
                    </td>
                    <td className="py-4 text-right font-medium">
                      ${Number(order.total ?? 0).toFixed(2)}
                    </td>
                  </tr>
                ))}
                {orders.length === 0 && (
                  <tr>
                    <td colSpan={3} className="py-12 text-center text-gray-500">
                      No orders yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="rounded-xl border border-zinc-800/70 bg-zinc-900 p-5 sm:p-6">
          <p className="text-[0.62rem] font-semibold uppercase tracking-[0.2em] text-zinc-500">
            Quick access
          </p>
          <h2 className="mt-1.5 text-xl font-semibold text-white">Keep moving</h2>
          <div className="mt-5 divide-y divide-zinc-800">
            {[
              { href: "/admin/inventory", label: "Manage inventory", icon: Package },
              { href: "/admin/shipping", label: "Ship orders", icon: Truck },
              { href: "/admin/customers", label: "View customers", icon: Users },
              { href: "/admin/featured-items", label: "Curate featured", icon: Sparkles },
            ].map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="group flex items-center gap-3 py-4 text-sm font-medium text-zinc-700 first:pt-1 last:pb-1 hover:text-black"
              >
                <Icon className="h-4 w-4 text-zinc-400 group-hover:text-black" />
                <span className="flex-1">{label}</span>
                <ArrowRight className="h-3.5 w-3.5 text-zinc-400 transition-transform group-hover:translate-x-0.5 group-hover:text-black" />
              </Link>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
