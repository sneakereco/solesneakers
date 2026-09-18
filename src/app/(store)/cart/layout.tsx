import { pageMetadata } from "@/lib/metadata";

export const metadata = {
  ...pageMetadata(
    "Your Cart",
    "Review the items in your Solesneakers cart and continue to checkout.",
  ),
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
