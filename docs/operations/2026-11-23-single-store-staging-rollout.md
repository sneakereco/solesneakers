# Single-store compatibility staging rollout

Status: preflight and backup restoration verified; publication/deployment pending.
Scope: the compatibility release in the approved single-store retirement plan.
Tenant-free producers, application write bridges, production cutover and
contraction remain separate gated work.

## Target and baseline

The explicitly selected Doppler configuration is `solesneakers/stg_ci`.
Hashed database and public Supabase project identities differ from `prd_ci`;
the staging measurement environment is `staging`. Production was not connected
to or changed for this check.

Read-only staging preflight passed with all 105 historical migrations through
`20260922120000`, all 20 expected tenant-bearing tables, one owner and no
canonical-key collisions. No missing, unknown or duplicate migration versions
were reported.

The report found 45 orders, including two requiring reconciliation, one expired
active reservation, and 27 sent notification jobs with no pending/failed jobs.
Those records remain unchanged. They are evidence for later reconciliation and
contraction, not permission to cancel, release stock or retry a charge.

## Backup restoration

A full custom-format staging dump used an exported repeatable-read snapshot.
The same source snapshot supplied public-table fingerprints, so concurrent
staging activity cannot create a false mismatch between those fingerprints and
the dump. The source transaction was read-only.

The dump restored successfully into a new disposable local database. All 33
public-table row counts and complete JSON row fingerprints matched. The backup,
restored database and private evidence are retained locally for the rollout;
no customer rows or credentials are committed here.

## Remaining rollout checks

- Publish the reviewed compatibility changes and run repository checks.
- Apply only the additive expansion through the staging workflow after its
  historical-prefix and pending-expansion preflight gates pass.
- Verify the deployed commit, readiness, data preservation and effective RPC
  grants; test old/new named-argument dispatch through the real staging API.
- Keep current producers on legacy formats. Observe deployment versions and
  resolve the later provider/counter/application gates before cutover.

See the [release ledger](single-store-retirement-runbook.md) for the complete
acceptance boundaries and rollback requirements.
