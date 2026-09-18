import { pageMetadata } from "@/lib/metadata";

export const metadata = {
  ...pageMetadata(
    "Order Status",
    "View the latest status of your Solesneakers order using your order access link.",
  ),
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
