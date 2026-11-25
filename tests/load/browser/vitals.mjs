import { readFile } from "node:fs/promises";
const library = new URL(
  "./web-vitals.iife.js",
  import.meta.resolve("load-test-web-vitals"),
);
export async function collectVitals(page, emit, viewport = "desktop") {
  await page.exposeBinding("__soleLoadVital", (_source, observation) => {
    if (
      ["LCP", "CLS", "INP"].includes(observation.name) &&
      Number.isFinite(observation.value)
    )
      emit({ ...observation, viewport });
  });
  const content = await readFile(library, "utf8");
  await page.addInitScript({
    content:
      content +
      `;(()=>{const navigationId=crypto.randomUUID();const route=location.pathname.replace(/[a-f0-9]{8}-[a-f0-9-]{27}/gi,':id');const send=metric=>window.__soleLoadVital({name:metric.name,value:metric.value,navigationId,route,at:Date.now()});webVitals.onLCP(send,{reportAllChanges:true});webVitals.onCLS(send,{reportAllChanges:true});webVitals.onINP(send,{reportAllChanges:true});})();`,
  });
}
const p75 = (values) => values.sort((a, b) => a - b)[Math.ceil(values.length * 0.75) - 1];
export function evaluateVitals(
  samples,
  routes,
  { minimumSamples = 20, viewports = ["mobile", "desktop"] } = {},
) {
  const reasons = [],
    measurements = [];
  let failure = false;
  for (const viewport of viewports)
    for (const route of routes)
      for (const [name, budget] of [
        ["LCP", 2500],
        ["CLS", 0.1],
        ["INP", 200],
      ]) {
        const observations = new Map();
        for (const sample of samples)
          if (
            sample.name === name &&
            sample.route === route &&
            sample.viewport === viewport &&
            Number.isFinite(sample.value)
          )
            observations.set(sample.navigationId, sample.value);
        const values = [...observations.values()],
          value = values.length ? p75(values) : null;
        measurements.push({
          name,
          viewport,
          route,
          samples: values.length,
          p75: value,
          budget,
        });
        if (values.length < minimumSamples)
          reasons.push(
            `${name} ${route} ${viewport}: insufficient samples (${values.length}/${minimumSamples})`,
          );
        if (value !== null && value > budget) {
          failure = true;
          reasons.push(`${name} ${route} ${viewport}: p75 exceeded`);
        }
      }
  return {
    status: failure ? "fail" : reasons.length ? "unmet" : "pass",
    reasons,
    measurements,
  };
}
