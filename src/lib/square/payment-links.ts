import type * as Square from "square";

type PaymentLinksClient = {
  delete(request: Square.checkout.DeletePaymentLinksRequest): PromiseLike<unknown>;
};

/** Temporary compatibility adapter for expiring hosted links issued before migration. */
export class SquarePaymentLinksGateway {
  constructor(private readonly paymentLinks: PaymentLinksClient) {}

  async delete(paymentLinkId: string): Promise<void> {
    await this.paymentLinks.delete({ id: paymentLinkId });
  }
}
