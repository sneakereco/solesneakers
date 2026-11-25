import { renderToStaticMarkup } from "react-dom/server";
import { SpecialtyClaimsClient } from "@/Modules/SpecialtyProducts/Source/Features/ManageClaims/SpecialtyClaimsClient";
test("staff claims expose manual contact/status details with escaped winning instructions", () => {
  const html = renderToStaticMarkup(
    <SpecialtyClaimsClient
      initial={{
        claims: [
          {
            claimId: "claim",
            productId: "prize",
            productName: "Cash prize",
            instagramHandle: "sole.user",
            instructions: "<script>private instructions</script>",
            acceptedAt: "2026-11-25T18:00:00Z",
            decisionOrdinal: 1,
            imageUrl: null,
            address: {
              line1: "123 MAIN ST",
              line2: null,
              city: "COLUMBIA",
              state: "SC",
              postalCode: "29201",
              country: "US",
            },
            status: "new",
            revision: 1,
            updatedBy: null,
            updatedAt: "2026-11-25T18:00:00Z",
          },
        ],
        total: 1,
      }}
      campaign={{ enabled: false, revision: 1, keyReady: true }}
      products={[{ id: "prize", name: "Cash prize" }]}
    />,
  );
  expect(html).toContain("123 MAIN ST");
  expect(html).toContain("https://www.instagram.com/sole.user/");
  expect(html).toContain("&lt;script&gt;private instructions&lt;/script&gt;");
  for (const status of ["New", "Contacted", "Fulfilled"]) expect(html).toContain(status);
  expect(html).toContain('role="switch"');
  expect(html).not.toMatch(/Card number|Create shipping label|Send email/);
});
