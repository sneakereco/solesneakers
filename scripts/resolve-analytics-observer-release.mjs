import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Match the production deployment workflow's accepted tag syntax and ancestry gate.
const releaseTag =
  /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-(alpha|beta)\.(0|[1-9][0-9]*))?$/;
const runGit = (args) =>
  execFileSync("git", args, {
    encoding: "utf8",
    timeout: 5_000,
    maxBuffer: 8_192,
    stdio: ["ignore", "pipe", "pipe"],
  });

export function resolveObserverRelease(tag, git = runGit) {
  if (
    typeof tag !== "string" ||
    tag.length > 128 ||
    !releaseTag.test(tag) ||
    /\s/.test(tag)
  )
    throw Error("Select an already deployed production semantic-version tag.");
  try {
    const commit = git(["rev-parse", "--verify", `refs/tags/${tag}^{commit}`]).trim();
    if (!/^[0-9a-f]{40}$/.test(commit)) throw Error();
    git(["merge-base", "--is-ancestor", commit, "refs/remotes/origin/main"]);
    return commit;
  } catch {
    throw Error(
      "The selected production tag must exist and point to a commit in main history.",
    );
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    console.log(resolveObserverRelease(process.argv[2]));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
