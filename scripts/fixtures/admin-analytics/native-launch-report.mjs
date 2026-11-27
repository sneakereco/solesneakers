import assert from "node:assert/strict";
import { requireAnalytics } from "../../analytics-operator-runtime.mjs";

export async function checkNativeLaunchReport(db) {
  const { makeAudienceFixture } = requireAnalytics(
    "../src/Modules/Analytics/Tests/Features/Reporting/audience-fixture.ts",
  );
  const { getReport } = requireAnalytics(
    "../src/Modules/Analytics/Source/Features/Reporting/report-service.ts",
  );
  const { parseReportRequest } = requireAnalytics(
    "../src/Modules/Analytics/Source/Features/ReportContract/filters.ts",
  );
  const one = async (sql, values = []) => (await db.query(sql, values)).rows[0].v;
  const ds = "sole-staging";
  const probe = () => one("select public.analytics_native_probe($1) v", [ds]);
  const verified = (id) =>
    one("select public.analytics_native_advance($1,$2) v", [ds, id]);
  const history = () => one("select public.analytics_read_history_evidence($1) v", [ds]);
  await db.query("begin");
  try {
    await db.query("savepoint before_activation");
    await assert.rejects(
      one(
        "select public.activate_analytics_dataset('staging',statement_timestamp(),'native') v",
      ),
      { code: "22023" },
    );
    await db.query("rollback to before_activation");
    await one(
      "select public.analytics_record_native_retention($1,24,current_date-800,statement_timestamp()) v",
      [ds],
    );
    const first = await probe();
    assert.equal(await verified(first.last_id), true);
    const activation = await one("select statement_timestamp() v");
    // Use the database launch clock after the first server receipt, at JS millisecond resolution.
    const launch = new Date(
      Math.max(Date.parse(activation), Date.parse(first.last_at) + 1),
    ).toISOString();
    await db.query("select pg_sleep(0.005)");
    assert.equal(
      (
        await one("select public.activate_analytics_dataset('staging',$1,'native') v", [
          launch,
        ])
      ).created,
      true,
    );
    await db.query("select pg_sleep(0.02)");
    const second = await probe();
    assert.equal(await verified(second.last_id), true);
    const evidence = await history();
    assert.equal(Date.parse(evidence.native[0].start), Date.parse(launch));
    assert.equal(Date.parse(evidence.native[0].end), Date.parse(second.last_at));
    const audience = makeAudienceFixture(null, launch);
    const now = new Date(second.last_at);
    audience.event(1, "public_page_viewed", 0, undefined, launch);
    const req = parseReportRequest(
      new URLSearchParams({ report: "overview", compare: "false" }),
      now,
    );
    const result = await getReport(
      { ...req, report: "overview" },
      { ...audience.deps, now, history: evidence },
    );
    assert.equal(result.data?.summary.sessions, 1);
    assert.ok(result.behaviorThrough);
    await db.query(
      "insert into analytics_reporting.verified_behavior_intervals(dataset_id,source,start_at,end_at,verified_at) values($1,'native',statement_timestamp()-interval '3 years',statement_timestamp()-interval '25 months',statement_timestamp()),($1,'native',statement_timestamp()-interval '25 months',statement_timestamp()-interval '23 months',statement_timestamp())",
      [ds],
    );
    const withOld = await history();
    assert.equal(withOld.native.length, 2);
    const horizon = await one("select statement_timestamp()-interval '24 months' v");
    assert.ok(Math.abs(Date.parse(withOld.native[0].start) - horizon.getTime()) < 1000);
    await one(
      "select public.analytics_record_native_retention($1,12,current_date-365,statement_timestamp()) v",
      [ds],
    );
    assert.deepEqual((await history()).native, []);
    await one(
      "select public.analytics_record_native_retention($1,24,current_date-800,statement_timestamp()) v",
      [ds],
    );
    assert.equal(
      (await history()).native.length,
      1,
      "Increasing retention cannot resurrect expired observations",
    );
    await one(
      "select public.analytics_record_native_retention($1,null,null,statement_timestamp()) v",
      [ds],
    );
    assert.equal(
      (await history()).native.length,
      1,
      "Explicit unlimited policy still preserves earlier loss and requires observed intervals",
    );
    await db.query(
      "update analytics_reporting.native_probes set retention_verified_at=statement_timestamp()-interval '2 days' where dataset_id=$1",
      [ds],
    );
    assert.deepEqual((await history()).native, []);
    console.log(
      "PASS real prelaunch + adjacent server receipts feed a usable activation-spanning overview; expired native horizon and stale attestation excluded",
    );
  } finally {
    await db.query("rollback");
  }
}
