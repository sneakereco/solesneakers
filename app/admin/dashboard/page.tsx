"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DollarSign, Package, ShoppingCart } from "lucide-react";

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
    <div className="space-y-6">
      <div>
        <h1 className="mb-2 text-3xl font-bold text-white">Dashboard</h1>
        <p className="text-gray-400">Store operations at a glance.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 sm:gap-6">
        {stats.map(({ label, value, icon: Icon }) => (
          <div key={label} className="rounded border border-zinc-800/70 bg-zinc-900 p-6">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-sm text-gray-400">{label}</span>
              <Icon className="h-5 w-5 text-gray-400" />
            </div>
            <span className="text-3xl font-bold text-white">{value}</span>
          </div>
        ))}
      </div>

      <div className="rounded border border-zinc-800/70 bg-zinc-900 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-white">Recent Orders</h2>
          <Link
            href="/admin/transactions"
            className="text-sm text-red-500 hover:underline"
          >
            View all
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
                <tr key={order.id} className="border-b border-zinc-800/70 text-white">
                  <td className="py-3">#{order.id.slice(0, 8)}</td>
                  <td className="py-3 capitalize text-gray-400">
                    {order.status ?? "pending"}
                  </td>
                  <td className="py-3 text-right">
                    ${Number(order.total ?? 0).toFixed(2)}
                  </td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-8 text-center text-gray-500">
                    No orders yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
