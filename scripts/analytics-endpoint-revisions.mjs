import { createHash } from "node:crypto";

const commerce = [
  "dataset_id",
  "environment",
  "activated_at",
  "productid",
  "variantid",
  "brandid",
  "categoryid",
  "sizeid",
  "device",
  "source",
  "channel",
  "campaign",
  "fulfillment",
  "status",
  "customer",
  "start_inclusive",
  "end_exclusive",
  "date_basis",
  "payment_method",
];
const behavior = ["behavior_enabled", "behavior_end"];
const pagination = ["sort", "page_start", "page_end"];
const ranked = [...commerce, ...behavior, ...pagination];
const series = [...commerce, ...behavior, "bucket"];

// SHA-256 fingerprints and variable names from the original native-history v1 manifest.
export const legacyV1 = {
  sole_analytics_sessions: {
    hash: "617a872817dbc5d9371df8d203acb98f3a26526ae1173adb9d0291525e6891e9",
    names: [...commerce, ...behavior],
  },
  sole_analytics_active: {
    hash: "1b5a89e336c097082d315c6d881cef65c594f31fbd8ce588ee2ba0369d3a53ea",
    names: [
      "start_inclusive",
      "end_exclusive",
      ...behavior,
      "activated_at",
      "device",
      "source",
      "channel",
      "campaign",
    ],
  },
  sole_analytics_visitor_series: {
    hash: "7d3f73039729fa1afce979340d91a7eaa06a1305d8004b4d0335f99060e109ee",
    names: series,
  },
  sole_analytics_products: {
    hash: "bf78d288055f425d3359a693f51e9c895e9ea3219793b745a567216530cee402",
    names: [...commerce, "inventory_enabled", ...behavior, ...pagination],
  },
  sole_analytics_inventory_demand: {
    hash: "181adbf9eb443530766bc593484c32c1a126e8364b293b572a7a626b777cd72e",
    names: [...commerce, "inventory_enabled", ...behavior],
  },
  sole_analytics_acquisition: {
    hash: "7160ffcf8c3f78ba305119708e887e1312999f8825afdbedeb68c8c8e3c01349",
    names: ranked,
  },
  sole_analytics_discovery: {
    hash: "2bc33a2f8b19481e3be40441b56d771c5d2f65cd514913b7f558a23290c8704f",
    names: ranked,
  },
  sole_analytics_acquisition_series: {
    hash: "b3ffa59b05263f4982acc878dc58a054c1d465e11988b9f28cebcbf4503b7573",
    names: series,
  },
  sole_analytics_discovery_series: {
    hash: "e89b6d4039619ec95a53820376861f9556ef175ab2e6c346d895d4f04667413b",
    names: series,
  },
};

export function scopedLegacyHash(sql, { datasetId, environment, activatedAt }) {
  if (typeof sql !== "string" || sql.includes("\0")) return null;
  // Bind the exact validated scope literals in the native projection. Reject NUL
  // in provider SQL so only these substitutions can introduce the hash markers.
  const normalized = sql
    .replaceAll(
      `SELECT '${datasetId}' AS dataset_id,`,
      "SELECT \0dataset_id\0 AS dataset_id,",
    )
    .replaceAll(
      `properties.environment='${environment}'`,
      "properties.environment=\0environment\0",
    )
    .replaceAll(
      `timestamp >= parseDateTimeBestEffort('${activatedAt}','UTC')`,
      "timestamp >= parseDateTimeBestEffort(\0activated_at\0,'UTC')",
    );
  return createHash("sha256").update(normalized).digest("hex");
}

export function bootstrapV1(definition) {
  return {
    ...definition,
    version: 1,
    // The comment makes the seed distinct so PostHog creates v2 on the final PATCH.
    sql: "-- Sole Analytics bootstrap seed for v2\n" + definition.sql,
  };
}
