jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { renderToStaticMarkup } from "react-dom/server";

import { RegisterForm } from "@/components/auth/register/RegisterForm";
import { registerSchema } from "@/lib/validation/auth";

it("links signup acceptance to the public legal routes", () => {
  const html = renderToStaticMarkup(<RegisterForm />);

  expect(html).toContain('href="/terms"');
  expect(html).toContain('href="/privacy"');
  expect(html).not.toContain('href="/legal/');
});

it("registers without offering or accepting marketing preferences", () => {
  const html = renderToStaticMarkup(<RegisterForm />);
  expect(html).not.toMatch(/drop alerts|exclusive offers|type="checkbox"/i);
  const payload = { email: "customer@example.com", password: "Password123!" };
  expect(registerSchema.parse(payload)).toEqual(payload);
  expect(registerSchema.safeParse({ ...payload, updatesOptIn: true }).success).toBe(
    false,
  );
});
