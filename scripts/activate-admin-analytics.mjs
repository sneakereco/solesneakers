import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { requireAnalytics } from "./analytics-operator-runtime.mjs";
const { pairOwnerProject } = requireAnalytics(
  "../src/Modules/Analytics/Source/Features/Configuration/operator-pairing.ts",
);
try {
  const {
    values: { environment, at, history = "native" },
  } = parseArgs({
    options: {
      environment: { type: "string" },
      at: { type: "string" },
      history: { type: "string" },
    },
  });
  if (
    !["staging", "production"].includes(environment) ||
    !["native", "archive"].includes(history) ||
    !/^\d{4}-\d\d-\d\dT.*Z$/.test(at ?? "") ||
    !Number.isFinite(Date.parse(at)) ||
    Date.parse(at) > Date.now()
  )
    throw Error();
  await pairOwnerProject(process.env, environment);
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await db.rpc("activate_analytics_dataset", {
    p_environment: environment,
    p_at: at,
    p_history_mode: history,
  });
  if (
    error ||
    data?.datasetId !== "sole-" + environment ||
    typeof data.created !== "boolean" ||
    !Number.isSafeInteger(data.baselineVariants)
  )
    throw Error();
  console.log(
    JSON.stringify({
      environment,
      at,
      created: data.created,
      baselineVariants: data.baselineVariants,
    }),
  );
} catch {
  console.error(
    "Dataset activation unavailable. Check the selected owner project, launch instant and database pairing.",
  );
  process.exitCode = 1;
}
