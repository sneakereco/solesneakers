import { initBotId } from "botid/client/core";

initBotId({
  protect: [
    {
      path: "/api/checkout/payment-link",
      method: "POST",
      advancedOptions: { checkLevel: "basic" },
    },
  ],
});
