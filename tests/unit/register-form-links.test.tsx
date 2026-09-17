jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { renderToStaticMarkup } from "react-dom/server";

import { RegisterForm } from "@/components/auth/register/RegisterForm";

it("links signup acceptance to the public legal routes", () => {
  const html = renderToStaticMarkup(<RegisterForm />);

  expect(html).toContain('href="/terms"');
  expect(html).toContain('href="/privacy"');
  expect(html).not.toContain('href="/legal/');
});
