import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ARENA_ROOT, ENGINES_DIR, run } from "./config";

/**
 * Engines run in the browser as WASI command modules: the same binary and protocol the
 * referee plays, compiled for wasm32-wasip1. The site loads web/public/wasm/<track>.wasm.
 */
const PUBLIC = resolve(ARENA_ROOT, "web/public/wasm");

export const wasmPaths = (track: string) => [
  resolve(PUBLIC, `${track}.wasm`),
  resolve(PUBLIC, `${track}.json`),
];

export const buildWasm = async (
  track: string,
  meta: { version: string; elo: number | null },
) => {
  await run("rustup", ["target", "add", "wasm32-wasip1"]);
  const build = await run(
    "cargo",
    [
      "build",
      "--release",
      "--target",
      "wasm32-wasip1",
      "-p",
      `${track}-engine`,
    ],
    {
      cwd: ENGINES_DIR,
    },
  );
  if (build.code !== 0) return false;
  mkdirSync(PUBLIC, { recursive: true });
  copyFileSync(
    resolve(
      ENGINES_DIR,
      "target/wasm32-wasip1/release",
      `${track}-engine.wasm`,
    ),
    resolve(PUBLIC, `${track}.wasm`),
  );
  writeFileSync(
    resolve(PUBLIC, `${track}.json`),
    `${JSON.stringify({ ...meta, builtAt: new Date().toISOString() }, null, 2)}\n`,
  );
  return true;
};
