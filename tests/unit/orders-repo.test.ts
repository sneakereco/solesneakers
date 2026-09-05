import { OrdersRepository } from "@/repositories/orders-repo";
import type { TypedSupabaseClient } from "@/lib/supabase/server";

describe("OrdersRepository.getBySquareOrderId", () => {
  it("loads an order by its Square order id", async () => {
    const order = { id: "order-1", square_order_id: "square-order-1" };
    const maybeSingle = jest.fn().mockResolvedValue({ data: order, error: null });
    const eq = jest.fn().mockReturnValue({ maybeSingle });
    const select = jest.fn().mockReturnValue({ eq });
    const from = jest.fn().mockReturnValue({ select });
    const repository = new OrdersRepository({ from } as unknown as TypedSupabaseClient);

    await expect(repository.getBySquareOrderId("square-order-1")).resolves.toBe(order);
    expect(from).toHaveBeenCalledWith("orders");
    expect(select).toHaveBeenCalledWith("*");
    expect(eq).toHaveBeenCalledWith("square_order_id", "square-order-1");
    expect(maybeSingle).toHaveBeenCalledTimes(1);
  });
});
