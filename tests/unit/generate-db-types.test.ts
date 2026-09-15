jest.mock("node:child_process", () => ({ execFileSync: jest.fn() }));
jest.mock("node:fs", () => ({ writeFileSync: jest.fn(), renameSync: jest.fn() }));

import { execFileSync } from "node:child_process";
import { writeFileSync, renameSync } from "node:fs";
import { resolve } from "node:path";

beforeEach(() => jest.clearAllMocks());

it("preserves existing types when generation fails or returns empty output", () => {
  jest.mocked(execFileSync).mockImplementationOnce(() => {
    throw new Error("database unavailable");
  });
  expect(() =>
    jest.isolateModules(() => jest.requireActual("../../scripts/generate-db-types.mjs")),
  ).toThrow("database unavailable");
  jest.mocked(execFileSync).mockReturnValueOnce("");
  expect(() =>
    jest.isolateModules(() => jest.requireActual("../../scripts/generate-db-types.mjs")),
  ).toThrow("empty database types");
  expect(writeFileSync).not.toHaveBeenCalled();
  expect(renameSync).not.toHaveBeenCalled();
});

it("replaces existing types only after writing successful output to a temporary file", () => {
  jest.mocked(execFileSync).mockReturnValueOnce("export type Database = {};\n");
  jest.isolateModules(() => jest.requireActual("../../scripts/generate-db-types.mjs"));
  const target = resolve("src/types/db/database.types.ts");
  expect(writeFileSync).toHaveBeenCalledWith(
    `${target}.tmp`,
    "export type Database = {};\n",
  );
  expect(renameSync).toHaveBeenCalledWith(`${target}.tmp`, target);
  expect(jest.mocked(writeFileSync).mock.invocationCallOrder[0]).toBeLessThan(
    jest.mocked(renameSync).mock.invocationCallOrder[0],
  );
});
