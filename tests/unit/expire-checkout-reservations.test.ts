import { expireCheckoutReservations } from "@/lib/checkout/expire-checkout-reservations";

const linked = {
  orderId: "order-1",
  squarePaymentLinkId: "link-1",
  squarePaymentLinkDeletedAt: null,
  squareOrderId: "square-order-1",
  squareOrderVersion: null,
};

describe("expireCheckoutReservations", () => {
  it("records Square deletion before releasing reserved inventory", async () => {
    const deleteSquareLink = jest.fn().mockResolvedValue(undefined);
    const markSquareLinkDeleted = jest.fn().mockResolvedValue(undefined);
    const releaseReservation = jest.fn().mockResolvedValue(true);

    const result = await expireCheckoutReservations([linked], {
      deleteSquareLink,
      markSquareLinkDeleted,
      getSquareOrder: jest.fn(),
      cancelSquareOrder: jest.fn(),
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
      getSquareOrder: jest.fn(),
      cancelSquareOrder: jest.fn(),
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
        getSquareOrder: jest.fn(),
        cancelSquareOrder: jest.fn(),
        releaseReservation,
        reportError: jest.fn(),
      },
    );

    expect(result.released).toBe(1);
    expect(deleteSquareLink).not.toHaveBeenCalled();
  });

  it("cancels a direct Square order before releasing reserved inventory", async () => {
    const getSquareOrder = jest
      .fn()
      .mockResolvedValue({ state: "OPEN", version: 7, hasPayment: false });
    const cancelSquareOrder = jest.fn().mockResolvedValue(undefined);
    const releaseReservation = jest.fn().mockResolvedValue(true);

    const result = await expireCheckoutReservations(
      [
        {
          ...linked,
          squarePaymentLinkId: null,
          squareOrderVersion: 3,
        },
      ],
      {
        deleteSquareLink: jest.fn(),
        markSquareLinkDeleted: jest.fn(),
        getSquareOrder,
        cancelSquareOrder,
        releaseReservation,
        reportError: jest.fn(),
      },
    );

    expect(result).toEqual({ examined: 1, released: 1, failed: 0 });
    expect(getSquareOrder).toHaveBeenCalledWith("square-order-1");
    expect(cancelSquareOrder).toHaveBeenCalledWith("square-order-1", 7);
    expect(cancelSquareOrder.mock.invocationCallOrder[0]).toBeLessThan(
      releaseReservation.mock.invocationCallOrder[0],
    );
  });

  it("does not release inventory when direct Square cancellation fails", async () => {
    const releaseReservation = jest.fn();

    const result = await expireCheckoutReservations(
      [
        {
          ...linked,
          squarePaymentLinkId: null,
          squareOrderVersion: 3,
        },
      ],
      {
        deleteSquareLink: jest.fn(),
        markSquareLinkDeleted: jest.fn(),
        getSquareOrder: jest
          .fn()
          .mockResolvedValue({ state: "OPEN", version: 7, hasPayment: false }),
        cancelSquareOrder: jest.fn().mockRejectedValue(new Error("Square unavailable")),
        releaseReservation,
        reportError: jest.fn(),
      },
    );

    expect(result).toEqual({ examined: 1, released: 0, failed: 1 });
    expect(releaseReservation).not.toHaveBeenCalled();
  });

  it("releases inventory when Square confirms the direct order is already canceled", async () => {
    const cancelSquareOrder = jest.fn();
    const releaseReservation = jest.fn().mockResolvedValue(true);

    const result = await expireCheckoutReservations(
      [{ ...linked, squarePaymentLinkId: null, squareOrderVersion: 3 }],
      {
        deleteSquareLink: jest.fn(),
        markSquareLinkDeleted: jest.fn(),
        getSquareOrder: jest
          .fn()
          .mockResolvedValue({ state: "CANCELED", version: 8, hasPayment: false }),
        cancelSquareOrder,
        releaseReservation,
        reportError: jest.fn(),
      },
    );

    expect(result).toEqual({ examined: 1, released: 1, failed: 0 });
    expect(cancelSquareOrder).not.toHaveBeenCalled();
  });

  it("preserves inventory when a direct Square order is no longer open", async () => {
    const releaseReservation = jest.fn();

    const result = await expireCheckoutReservations(
      [{ ...linked, squarePaymentLinkId: null, squareOrderVersion: 3 }],
      {
        deleteSquareLink: jest.fn(),
        markSquareLinkDeleted: jest.fn(),
        getSquareOrder: jest
          .fn()
          .mockResolvedValue({ state: "COMPLETED", version: 8, hasPayment: true }),
        cancelSquareOrder: jest.fn(),
        releaseReservation,
        reportError: jest.fn(),
      },
    );

    expect(result).toEqual({ examined: 1, released: 0, failed: 1 });
    expect(releaseReservation).not.toHaveBeenCalled();
  });

  it("preserves inventory when an open Square order already has a payment", async () => {
    const cancelSquareOrder = jest.fn();
    const releaseReservation = jest.fn();

    const result = await expireCheckoutReservations(
      [{ ...linked, squarePaymentLinkId: null, squareOrderVersion: 3 }],
      {
        deleteSquareLink: jest.fn(),
        markSquareLinkDeleted: jest.fn(),
        getSquareOrder: jest
          .fn()
          .mockResolvedValue({ state: "OPEN", version: 8, hasPayment: true }),
        cancelSquareOrder,
        releaseReservation,
        reportError: jest.fn(),
      },
    );

    expect(result).toEqual({ examined: 1, released: 0, failed: 1 });
    expect(cancelSquareOrder).not.toHaveBeenCalled();
    expect(releaseReservation).not.toHaveBeenCalled();
  });
});
