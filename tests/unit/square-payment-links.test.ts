import { SquarePaymentLinksGateway } from "@/lib/square/payment-links";

describe("SquarePaymentLinksGateway", () => {
  it("deletes a legacy hosted link before inventory is released", async () => {
    const remove = jest.fn().mockResolvedValue({});
    const gateway = new SquarePaymentLinksGateway({ delete: remove });

    await gateway.delete("link-expired");

    expect(remove).toHaveBeenCalledWith({ id: "link-expired" });
  });
});
