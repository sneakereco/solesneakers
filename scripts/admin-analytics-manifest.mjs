import { parseArgs } from "node:util";
import { requireAnalytics } from "./analytics-operator-runtime.mjs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
const feature = (path) =>
  requireAnalytics("../src/Modules/Analytics/Source/Features/" + path + ".ts");
export function buildManifest(scope) {
  const { datasetScopeSchema } = feature("CommerceFacts/contract");
  datasetScopeSchema.parse(scope);
  if (
    scope.financialSource !== "warehouse" ||
    scope.datasetId !== "sole-" + scope.environment
  )
    throw Error();
  const { warehouseSources } = feature("EventDelivery/history-source");
  const { compileBehaviorArchive } = feature("EventDelivery/behavior-archive");
  const { reconciliationEndpoint } = feature("EventDelivery/reconcile");
  const { reconciliationRawEndpoint, reconciliationWarehouseEndpoint } = feature(
    "EventDelivery/reconciliation-evidence",
  );
  const { REPORT_ENDPOINT_VERSIONS } = feature("Reporting/query-contract");
  const { financeObservation, linkObservation, nativeObservation } = feature(
    "EventDelivery/observation-refresh",
  );
  const endpoints = [
    feature("EventDelivery/journey-evidence").journeyEndpoint(scope),
    financeObservation,
    linkObservation,
    nativeObservation(scope),
    reconciliationEndpoint,
    reconciliationRawEndpoint,
    reconciliationWarehouseEndpoint,
    ...feature("Reporting/queries/financial").financialEndpoints,
    ...feature("Reporting/queries/commerce-health").commerceHealthEndpoints,
    ...feature("Reporting/queries/visitors").visitorEndpoints(scope),
    ...feature("Reporting/queries/products").productEndpoints(scope),
    ...feature("Reporting/queries/acquisition").acquisitionEndpoints(scope),
  ];
  if (
    endpoints.length !== Object.keys(REPORT_ENDPOINT_VERSIONS).length ||
    Object.entries(REPORT_ENDPOINT_VERSIONS).some(
      ([name, version]) =>
        endpoints.filter((e) => e.name === name && e.version === version).length !== 1,
    )
  )
    throw Error("Incomplete definition manifest");
  return {
    scope,
    sources: warehouseSources,
    endpoints,
    materialized: false,
    optionalMinimizedArchiveSql: compileBehaviorArchive(scope),
  };
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const { values } = parseArgs({
      options: {
        environment: { type: "string" },
        at: { type: "string" },
        "archive-cutoff": { type: "string" },
      },
    });
    console.log(
      JSON.stringify(
        buildManifest({
          environment: values.environment,
          datasetId: "sole-" + values.environment,
          schemaVersion: 2,
          financialSource: "warehouse",
          activatedAt: values.at,
          behaviorArchiveCutoff: values["archive-cutoff"] ?? null,
        }),
        null,
        2,
      ),
    );
  } catch {
    console.error("Invalid analytics manifest scope or definitions.");
    process.exitCode = 1;
  }
}
