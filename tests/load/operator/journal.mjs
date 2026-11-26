import { mkdir, readFile, writeFile, rename, chmod, stat } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);

export async function secureDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (process.platform === "win32") {
    // Paths travel as environment data, never executable shell text. Replace
    // inherited permissions with precisely the current user's SID.
    const script =
      "$ErrorActionPreference='Stop'; $path=$env:SOLE_LOAD_PRIVATE_DIR; $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $acl=New-Object System.Security.AccessControl.DirectorySecurity; $acl.SetOwner($sid); $acl.SetAccessRuleProtection($true,$false); $rule=New-Object System.Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow'); $acl.AddAccessRule($rule); [System.IO.Directory]::SetAccessControl($path,$acl); $actual=[System.IO.Directory]::GetAccessControl($path); foreach($entry in $actual.Access){if($entry.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -ne $sid.Value){throw 'Private artifact directory has shared permissions'}}";
    await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      env: { ...process.env, SOLE_LOAD_PRIVATE_DIR: directory },
      windowsHide: true,
    });
  } else {
    await chmod(directory, 0o700);
    if ((await stat(directory)).mode & 0o077)
      throw Error("Private artifact directory has shared permissions");
  }
}
export async function privateJson(path, value) {
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600, flag: "wx" });
  await rename(temp, path);
}
export async function openJournal(plan, artifactDir) {
  await secureDirectory(artifactDir);
  const path = join(artifactDir, "journal.json");
  let state;
  try {
    state = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    state = {
      version: 1,
      runId: plan.runId,
      targetDigest: plan.targetDigest,
      entries: [],
    };
    await privateJson(path, state);
  }
  if (state.runId !== plan.runId || state.targetDigest !== plan.targetDigest)
    throw Error("Journal target identity changed");
  let pending = Promise.resolve();
  function update(work) {
    const next = pending.then(async () => {
      const result = work();
      await privateJson(path, state);
      return structuredClone(result);
    });
    pending = next.catch(() => {});
    return next;
  }
  return {
    path,
    runId: state.runId,
    targetDigest: state.targetDigest,
    records: () => structuredClone(state.entries),
    intent(kind, key, data) {
      return update(() => {
        const existing = state.entries.find((x) => x.kind === kind && x.key === key);
        if (existing) {
          if (existing.data.id !== data.id) throw Error("Write-ahead identity mismatch");
          return existing;
        }
        const entry = { kind, key, data, status: "intent" };
        state.entries.push(entry);
        return entry;
      });
    },
    commit(kind, key, data = {}) {
      return update(() => {
        const entry = state.entries.find((x) => x.kind === kind && x.key === key);
        if (!entry) throw Error("Missing write-ahead intent");
        entry.data = { ...entry.data, ...data };
        entry.status = "committed";
        return entry;
      });
    },
    markDeleted(kind, key) {
      return update(() => {
        const entry = state.entries.find((x) => x.kind === kind && x.key === key);
        if (!entry) throw Error("Unowned deletion");
        entry.status = "deleted";
        return entry;
      });
    },
  };
}
