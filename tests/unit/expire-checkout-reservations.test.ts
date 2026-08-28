import { expireCheckoutReservations } from "@/lib/checkout/expire-checkout-reservations";

const linked = {
  orderId: "order-1",
  squarePaymentLinkId: "link-1",
  squarePaymentLinkDeletedAt: null,
};

describe("expireCheckoutReservations", () => {
  it("records Square deletion before releasing reserved inventory", async () => {
    const deleteSquareLink = jest.fn().mockResolvedValue(undefined);
    const markSquareLinkDeleted = jest.fn().mockResolvedValue(undefined);
    const releaseReservation = jest.fn().mockResolvedValue(true);

    const result = await expireCheckoutReservations([linked], {
      deleteSquareLink,
      markSquareLinkDeleted,
      releaseReservation,
      reportError: jest.fn(),
    });

    expect(result).toEqual({ examined: 1, released: 1, failed: 0 });
    expect(deleteSquareLink.mock.invocationCallOrder[0]).toBeLessThan(
      markSquareLinkDeleted.mock.invocationCallOrder[0],
    );
    expect(markSquareLinkDeleted.mock.invocationCallOrder[0]).toBeLessThan(
      releaseReservation.mock.invocationCallOrder[0],
    );
  });

  it("does not release inventory when Square deletion fails", async () => {
    const reportError = jest.fn();
    const releaseReservation = jest.fn();

    const result = await expireCheckoutReservations([linked], {
      deleteSquareLink: jest.fn().mockRejectedValue(new Error("Square unavailable")),
      markSquareLinkDeleted: jest.fn(),
      releaseReservation,
      reportError,
    });

    expect(result).toEqual({ examined: 1, released: 0, failed: 1 });
    expect(releaseReservation).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledWith(expect.any(Error), "order-1");
  });

  it("releases a reservation that never received a Square link", async () => {
    const releaseReservation = jest.fn().mockResolvedValue(true);
    const deleteSquareLink = jest.fn();

    const result = await expireCheckoutReservations(
      [{ ...linked, squarePaymentLinkId: null }],
      {
        deleteSquareLink,
        markSquareLinkDeleted: jest.fn(),
        releaseReservation,
        reportError: jest.fn(),
      },
    );

    expect(result.released).toBe(1);
    expect(deleteSquareLink).not.toHaveBeenCalled();
  });
});
