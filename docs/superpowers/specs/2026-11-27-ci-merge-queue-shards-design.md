# Merge queue and isolated CI shards

The user approved the recommended merge queue and database/browser sharding on November 27, 2026. Faster feedback must preserve every existing suite, negative control, scope rule, fixture guard, and required check.

## Approaches

- Selected: GitHub merge queue plus four isolated runners per checkout family. Validate temporary integration commits without repeatedly updating every open PR branch.
- Rejected: loosen the up-to-date requirement without a queue. This would permit untested combinations with main.
- Deferred: sharing mutable databases or changing browser lifecycles. Sharding can improve elapsed time while leaving fixture semantics intact.

## Design

Keep ordinary checks in their current job. Database and browser jobs each use four matrix shards, with fail-fast disabled and no continue-on-error. Their existing required `validate` job accepts success only from scope, checks, and both complete matrices. Test the matrix configuration and execute the real final result gate against failures, cancellations, skips, and missing results.

Each runner supports an optional `--shard=N/4` argument. No shard argument retains the complete local command. Reject malformed, unsupported, duplicate, empty, and unknown arguments before executing any checks. Export the database runner's gate boundary, as the browser runner already does, to verify literal commands and failure propagation without provisioning test databases in orchestration unit tests.

Allocate all existing database gates to one shard each, except the inexpensive owned-runtime check, which runs on every shard. Preserve all 13 fresh and 13 populated suites, stock fault injection, and barrier/relay controls. Retain independently owned projects and existing cleanup for each suite. Run the unconditional migration rehearsal on database shard 1. Balance its workload to account for this extra work.

Allocate all 16 unique browser suites and the basket negative control to one shard each, with Chromium runtime validation on every shard. Balance groups using the prior hosted timings. Measurement and analytics remain unconditional on browser shard 2. Do not change analytics implementation or any test body.

Add `merge_group: checks_requested` for main. Keep queue events separate from PR concurrency cancellation. Queue and manually dispatched runs always request full checkout coverage; retain the current conservative PR path classifier. Keep permissions read-only, dummy credentials, pinned actions, Node 24.14.1, and Ubuntu 24.04.

## Activation

First land the verified workflow under existing protections. Then require the merge queue for this repository's main branch, preserving `validate`, review/thread rules, deletion and force-push restrictions, and existing bypass lists. Use merge commits, require every queue entry to pass, bounded build concurrency, and a timeout above the observed CI duration. Do not alter protection for unrelated repositories. Because up-to-date protection is inherited from an organization ruleset, replace its applicability to this repository with equivalent repository-specific protection including the queue; do not weaken the shared organization rule globally.

Read back effective rules after activation. Verify a real merge-group run when a suitable authorized PR is available. Record separately what is proven by local orchestration tests, PR CI, and queue CI. Never bypass a failed check or required human review to activate this work.

## Acceptance

All prior unique gate names, commands, environments and negative-control semantics survive the union of shards. Every shard runs in hosted CI and its result blocks validate. Hosted logs demonstrate coverage and elapsed time; a single measured duration is not a guarantee. Queue activation must not precede workflow support on main.
