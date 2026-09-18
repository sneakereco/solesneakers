import { expireCheckoutReservations } from "@/lib/checkout/expire-checkout-reservations";

const linked = {
  orderId: "order-1",
  squareOrderId: "square-order-1",
  squareOrderVersion: 3,
};

describe("expireCheckoutReservations", () => {
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
          squareOrderVersion: 3,
        },
      ],
      {
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
          squareOrderVersion: 3,
        },
      ],
      {
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

    const result = await expireCheckoutReservations([linked], {
      getSquareOrder: jest
        .fn()
        .mockResolvedValue({ state: "CANCELED", version: 8, hasPayment: false }),
      cancelSquareOrder,
      releaseReservation,
      reportError: jest.fn(),
    });

    expect(result).toEqual({ examined: 1, released: 1, failed: 0 });
    expect(cancelSquareOrder).not.toHaveBeenCalled();
  });

  it("preserves inventory when a direct Square order is no longer open", async () => {
    const releaseReservation = jest.fn();

    const result = await expireCheckoutReservations([linked], {
      getSquareOrder: jest
        .fn()
        .mockResolvedValue({ state: "COMPLETED", version: 8, hasPayment: true }),
      cancelSquareOrder: jest.fn(),
      releaseReservation,
      reportError: jest.fn(),
    });

    expect(result).toEqual({ examined: 1, released: 0, failed: 1 });
    expect(releaseReservation).not.toHaveBeenCalled();
  });

  it("preserves inventory when an open Square order already has a payment", async () => {
    const cancelSquareOrder = jest.fn();
    const releaseReservation = jest.fn();

    const result = await expireCheckoutReservations([linked], {
      getSquareOrder: jest
        .fn()
        .mockResolvedValue({ state: "OPEN", version: 8, hasPayment: true }),
      cancelSquareOrder,
      releaseReservation,
      reportError: jest.fn(),
    });

    expect(result).toEqual({ examined: 1, released: 0, failed: 1 });
    expect(cancelSquareOrder).not.toHaveBeenCalled();
    expect(releaseReservation).not.toHaveBeenCalled();
  });
  it("preserves inventory when a Square order has no recorded version", async () => {
    const releaseReservation = jest.fn();
    const result = await expireCheckoutReservations(
      [{ ...linked, squareOrderVersion: null }],
      {
        getSquareOrder: jest.fn(),
        cancelSquareOrder: jest.fn(),
        releaseReservation,
        reportError: jest.fn(),
      },
    );
    expect(result.failed).toBe(1);
    expect(releaseReservation).not.toHaveBeenCalled();
  });
  it("releases a reservation that never received a Square order", async () => {
    const getSquareOrder = jest.fn();
    const releaseReservation = jest.fn().mockResolvedValue(true);
    const result = await expireCheckoutReservations(
      [{ ...linked, squareOrderId: null, squareOrderVersion: null }],
      {
        getSquareOrder,
        cancelSquareOrder: jest.fn(),
        releaseReservation,
        reportError: jest.fn(),
      },
    );
    expect(result.released).toBe(1);
    expect(getSquareOrder).not.toHaveBeenCalled();
  });
});
