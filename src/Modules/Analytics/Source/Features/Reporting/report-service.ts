import "server-only";
import type { DatasetScope } from "../CommerceFacts/contract";
import type { ReportRequest } from "../ReportContract/types";
import { compileCommerceHealthQueries, mapHealthResult } from "./queries/commerce-health";
import {
  compileFinancialQueries,
  mapPaymentsResult,
  mapSalesResult,
} from "./queries/financial";
import type { CompiledQuery } from "./query-contract";

export const commerceDateDefinitions = {
  order:
    "Provider capture when available at first authorization, otherwise first authorized server confirmation. The chosen order time is immutable.",
  activity:
    "Original orders at confirmation, completed refunds at refund completion, and actual fee and shipping adjustments at their effective times.",
  orderCohort:
    "Lifetime recorded outcomes of orders originally confirmed in the selected period.",
  paymentAttempt:
    "Resolved payment attempts at resolution time. Pending and unknown attempts at their original start time.",
  fulfillment:
    "Latest known fulfillment state of orders originally confirmed in the selected period. Elapsed time runs from recorded payment to fulfillment.",
  value:
    "Original reconciled merchandise after discounts, before refunds, shipping and tax. Averages and even-population medians round half up to the nearest cent.",
  productFilter:
    "Whole orders containing a matching original purchased line. All selected product and taxonomy values must match the same line.",
  attribution:
    "Device and purchase-session acquisition filters use the latest active confirmed-purchase link. Default money includes unattributed orders.",
  operationalCoverage:
    "An outcome during a source outage can be missing when neither the server nor a later provider confirmation recorded it.",
} as const;

/** Task 8 supplies the shared verified same-session funnel and report envelope.
 * The caller binds executePostHogQuery to its server-side configuration/deadline. */
export async function executeCommerceReport(
  request: ReportRequest,
  scope: DatasetScope,
  execute: (query: CompiledQuery) => Promise<unknown>,
) {
  const compiled =
    request.report === "health"
      ? compileCommerceHealthQueries(request, scope)
      : compileFinancialQueries(request, scope);
  const pairs = await Promise.all(
    Object.entries(compiled.queries).map(
      async ([key, query]) => [key, await execute(query)] as const,
    ),
  );
  const raw = { ...Object.fromEntries(pairs), request, activatedAt: scope.activatedAt };
  if (request.report === "sales") return mapSalesResult(raw);
  if (request.report === "payments") return mapPaymentsResult(raw);
  return mapHealthResult(raw);
}
