import { renderToStaticMarkup } from "react-dom/server";
import DashboardPage from "@/app/admin/dashboard/page";
it("withholds sales and recent-order emptiness until the first dashboard response", () => {
  const html = renderToStaticMarkup(<DashboardPage />);
  expect(html).not.toContain("$0.00");
  expect(html).not.toContain("No orders yet.");
  expect(html).toContain('aria-busy="true"');
});
