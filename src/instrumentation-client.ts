import { initBotId } from "botid/client/core";

initBotId({
  protect: [
    {
      path: "/api/specialty/eligibility",
      method: "POST",
      advancedOptions: { checkLevel: "deepAnalysis" },
    },
    {
      path: "/api/specialty/claims",
      method: "POST",
      advancedOptions: { checkLevel: "deepAnalysis" },
    },
    {
      path: "/api/checkout/quote",
      method: "POST",
      advancedOptions: { checkLevel: "deepAnalysis" },
    },
    {
      path: "/api/checkout/review",
      method: "POST",
      advancedOptions: { checkLevel: "deepAnalysis" },
    },
    {
      path: "/api/checkout/submit",
      method: "POST",
      advancedOptions: { checkLevel: "deepAnalysis" },
    },
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
