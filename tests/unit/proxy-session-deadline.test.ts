jest.mock("@supabase/ssr", () => ({ createServerClient: jest.fn() }));
import { createServerClient } from "@supabase/ssr";
import { NextRequest } from "next/server";
import { refreshSession } from "@/lib/supabase/session-refresh";

it("returns a retryable unavailable response and ignores late cookie writes after a stalled proxy refresh", async () => {
  jest.useFakeTimers();
  try {
    let lateCookies!: () => void;
    jest.mocked(createServerClient).mockImplementation((_url, _key, options) => {
      lateCookies = () =>
        void options.cookies.setAll?.([
          { name: "fixture-session", value: "late", options: {} },
        ]);
      return { auth: { getUser: () => new Promise(() => {}) } } as never;
    });
    const request = new NextRequest("http://localhost/api/auth/session");
    let result: Response | undefined;
    void refreshSession(request).then((response) => {
      result = response;
    });
    await jest.advanceTimersByTimeAsync(15_000);
    expect(result?.status).toBe(503);
    lateCookies();
    expect(request.cookies.get("fixture-session")).toBeUndefined();
    expect(result?.headers.get("set-cookie")).toBeNull();
  } finally {
    jest.useRealTimers();
  }
});
