import { initBotId } from "botid/client/core";

initBotId({
  protect: [
    {
      path: "/api/checkout/prepare",
      method: "POST",
      advancedOptions: { checkLevel: "deepAnalysis" },
    },
    {
      path: "/api/checkout/payment-permit",
      method: "POST",
      advancedOptions: { checkLevel: "deepAnalysis" },
    },
    {
      path: "/api/checkout/pay",
      method: "POST",
      advancedOptions: { checkLevel: "deepAnalysis" },
    },
  ],
});
