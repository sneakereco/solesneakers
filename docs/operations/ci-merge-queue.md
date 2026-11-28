# Pull request CI and merge queue

Checkout database and browser validation each use four isolated Ubuntu runners. Within a runner, suites still execute sequentially using their original fixtures. Every database suite receives its own owned project and cleanup. Every original fresh/populated suite and every unique browser suite remains present.

`validate` requires successful scope, ordinary checks, database matrix, and browser matrix results. Both matrices disable fail-fast, have no continue-on-error, and include shards 1 through 4. A failure in a matrix blocks its aggregate result. A failed, cancelled, skipped, or missing prerequisite blocks `validate`.

The inexpensive Docker/Chromium runtime control runs on every corresponding shard. Stock and basket fault controls run on shard 1. Migration rehearsals run on database shard 1 regardless of checkout scope. Measurement and analytics suites run on browser shard 2 regardless of checkout scope. Each remains a required part of its matrix.

Local commands still run the complete family:

```sh
npm run test:checkout:db
npm run test:checkout:browser
```

To reproduce one CI shard:

```sh
npm run test:checkout:db -- --shard=2/4
npm run test:checkout:browser -- --shard=2/4
```

Only `--shard=1/4` through `--shard=4/4` are accepted. Deliberately broken controls (`--break-stock` / `--break-cart`) can run unsharded or on shard 1; other shards reject them before executing checks.

## Queue operation

PR checks keep the existing conservative changed-path classifier. `merge_group` and manual events always run full checkout validation. PR and merge-group concurrency are separate; a queue build cannot cancel a PR build. A new run for the same event/ref can cancel its superseded run.

Once activated, add an approved passing PR to the merge queue. GitHub tests a temporary integration commit containing current main and preceding queued changes. PR branches do not need a merge from main just because another PR merged. Actual conflicts still require resolution. Queue failures, removals, or reordering can require rebuilding affected integration commits.

Activation order:

1. Merge the passing workflow PR under the current protections.
2. Configure repository-specific main protection that preserves required `validate`, pull requests, conversation resolution, no deletion, and no force pushes; require the merge queue with merge commits and every queue entry passing.
3. Keep equivalent protection continuously enforced while removing this repository from the inherited strict up-to-date rule. Preserve the organization rule for other repositories and the separate PR approval ruleset.
4. Read back the effective main rules, then verify a real merge-group run. Do not bypass a failed check or required review.

Suggested initial queue settings: build concurrency 2, minimum/maximum merge group size 1, status timeout 30 minutes, all entries must pass. These bound simultaneous work and avoid rebasing every open PR; they do not eliminate integration builds or guarantee a duration. Additional runners may increase total runner usage.

References: [GitHub merge queues](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue), [ruleset settings](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets).

## Verification record

- Before sharding: hosted run 46070740281, 10m26s elapsed; database approximately 10 minutes and browser approximately 8.5 minutes.
- Activation and hosted shard verification are pending until this change passes review and CI.
