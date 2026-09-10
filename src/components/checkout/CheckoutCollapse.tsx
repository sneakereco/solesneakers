import type { ReactNode } from "react";

export function CheckoutCollapse({
  open,
  children,
  id,
}: {
  open: boolean;
  children: ReactNode;
  id?: string;
}) {
  return (
    <div
      id={id}
      className="checkout-collapse"
      data-open={open}
      inert={!open}
      aria-hidden={!open}
    >
      <div className="min-h-0">{children}</div>
    </div>
  );
}
