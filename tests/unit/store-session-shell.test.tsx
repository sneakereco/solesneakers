import { Suspense, use } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import StorefrontLoading from "@/app/(store)/loading";
import { useCart } from "@/components/cart/CartProvider";
import { RootLoadingShell } from "@/components/shell/RootLoadingShell";
import { SessionShell } from "@/components/shell/SessionShell";
import { useSession } from "@/contexts/SessionContext";
import { getServerSession, type ServerSession } from "@/lib/auth/session";

jest.mock("@/lib/auth/session", () => ({ getServerSession: jest.fn() }));

function SessionContent() {
  const { user, role } = useSession();
  const { isReady } = useCart();
  return (
    <p>
      {user?.email} {role} {isReady ? "Cart ready" : "Cart awaiting hydration"}
    </p>
  );
}

describe("initial storefront session shell", () => {
  it("keeps the storefront fallback inside the existing landmark and navigation shell", () => {
    const html = renderToStaticMarkup(<StorefrontLoading />);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toMatch(/<(?:header|nav|main|a|button)[\s>]/);
  });

  it("streams safe loading markup while the session is pending and supplies the resolved identity", async () => {
    let resolveSession!: (value: ServerSession) => void;
    jest.mocked(getServerSession).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSession = resolve;
      }),
    );

    const sessionShell = SessionShell({ children: <SessionContent /> });
    function DeferredSession() {
      return use(sessionShell);
    }

    const pending = renderToStaticMarkup(
      <Suspense fallback={<RootLoadingShell />}>
        <DeferredSession />
      </Suspense>,
    );
    expect(pending).toContain('aria-busy="true"');
    expect(pending).toContain('aria-hidden="true"');
    expect(pending).not.toContain("owner@example.test");
    expect(pending).not.toContain("Cart awaiting hydration");
    expect(pending).not.toContain("<button");
    expect(pending).not.toContain("<a ");

    resolveSession({
      user: { id: "owner", email: "owner@example.test" },
      profile: null,
      role: "customer",
    });
    const resolved = renderToStaticMarkup(await sessionShell);
    expect(resolved).toContain("owner@example.test customer Cart awaiting hydration");
    expect(getServerSession).toHaveBeenCalledTimes(1);
  });
});
