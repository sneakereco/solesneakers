import { execFileSync } from "node:child_process";
import { writeFileSync, renameSync } from "node:fs";
import { resolve } from "node:path";

const types = execFileSync(
  process.execPath,
  [
    process.env.npm_execpath,
    "exec",
    "--",
    "supabase",
    "gen",
    "types",
    "typescript",
    "--local",
    "--schema",
    "public",
  ],
  { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "inherit"] },
);
if (!types.trim()) throw new Error("Supabase returned empty database types");

const target = resolve("src/types/db/database.types.ts");
const temporary = `${target}.tmp`;
writeFileSync(temporary, types);
renameSync(temporary, target);
