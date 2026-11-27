# Pull request validation

`Pull Request CI` always runs formatting, lint, typechecking, unit and integration tests, the fast operations checks, migration-order rehearsal, measurement and analytics browser checks, and the build. The required `validate` job remains present for every pull request.

The two expensive checkout suites use the cumulative pull request diff:

| Change                                                  | Isolated checkout database gates | Checkout Chromium gates |
| ------------------------------------------------------- | -------------------------------- | ----------------------- |
| Documentation, reporting, or isolated analytics workers | Skip                             | Skip                    |
| Checkout backend, shared runtime, or dependencies       | Run                              | Run                     |
| Checkout component styling or browser tests only        | Skip                             | Run                     |
| Database migrations                                     | Run                              | Run                     |
| Read-only analytics observer clock migration            | Run                              | Skip                    |
| Unknown paths or unavailable comparison history         | Run                              | Run                     |

The rules live in `scripts/checkout-validation-scope.mjs`. Both sides of a rename are considered, so moving checkout code into another directory cannot hide its removal. Update the rules and their operations tests when moving a checkout dependency.

To force a complete checkout run, open **Actions → Pull Request CI → Run workflow** and select the branch. Manual runs always enable both checkout suites.
