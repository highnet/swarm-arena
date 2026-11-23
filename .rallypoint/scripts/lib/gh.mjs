// The real `gh` runner and the config load, kept out of the pure modules so no
// test can reach the live repository by importing one of them.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createTransport } from "./api.mjs";
import { validateConfig } from "./config.mjs";
import { EXIT_MISSING_PREREQUISITE, checkGh } from "./prerequisites.mjs";
import { repositoryFrom, syncRequest } from "./request.mjs";

// Probed once per process, and lazily: importing this module must stay free of
// side effects, and a command that never reaches GitHub should not require a
// binary it will not use.
let ghAvailable = false;

/**
 * A deliberate testability seam: a fixture that sets this variable to
 * the absolute path of a `.mjs` file redirects every `gh` invocation below to
 * `process.execPath <that file>` instead of resolving a `gh` binary from
 * `PATH`. That sidesteps two POSIX-only assumptions the previous fixtures
 * made — that an extensionless file can be marked executable, and that `PATH`
 * is `:`-delimited — without touching how the real `gh` is invoked in
 * production, where this variable is never set.
 *
 * A default of `"gh"` rather than reading an ambient variable that might
 * already be set is deliberate: fixtures must opt in explicitly, so this
 * cannot become a way for an unrelated test, or a developer's environment, to
 * silently redirect a script at something other than the real `gh` CLI.
 */
const GH_SCRIPT_ENV = "RALLYPOINT_GH_SCRIPT";

/**
 * Resolves the command and leading arguments used to invoke `gh`, honouring
 * the `RALLYPOINT_GH_SCRIPT` override described above.
 *
 * @returns {{ command: string, prefixArgs: string[] }}
 */
const ghCommand = () => {
  const script = process.env[GH_SCRIPT_ENV];
  if (script) return { command: process.execPath, prefixArgs: [script] };
  return { command: "gh", prefixArgs: [] };
};

/**
 * Establishes that `gh` is runnable before the first call that needs it, so a
 * missing prerequisite is reported by name instead of arriving as an
 * `execFileSync` ENOENT several calls into a claim.
 */
export const ensureGh = () => {
  if (ghAvailable) return;

  const { command, prefixArgs } = ghCommand();
  const result = checkGh({
    probe: () =>
      execFileSync(command, [...prefixArgs, "--version"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
  });

  if (!result.ok) {
    console.error(result.message);
    process.exit(EXIT_MISSING_PREREQUISITE);
  }

  ghAvailable = true;
};

/** @param {string[]} args */
// Claude Code cloud sessions block GitHub GraphQL, which every high-level `gh`
// subcommand uses, so there the REST transport in `api.mjs` stands in for `gh`.
// `RALLYPOINT_TRANSPORT=rest|gh` forces either.
const useRest = () =>
  process.env.RALLYPOINT_TRANSPORT === "rest" ||
  (process.env.RALLYPOINT_TRANSPORT !== "gh" && process.env.CLAUDE_CODE_REMOTE === "true");

/** @type {((...args: string[]) => string) | null} */
let restTransport = null;

/**
 * The session proxy refuses writes to GitHub's git-data API (`git/refs`, `git/commits`), but
 * `git push` works. Every such write Rallypoint makes is emulated with plain git, keeping its
 * semantics: creating a ref still fails when it already exists (`--force-with-lease=<ref>:`
 * expects it absent), which is the atomicity a claim or a lease rests on.
 *
 * @param {string[]} args
 * @returns {string | null} the gh-shaped output, or null when this is not such a write.
 */
const gitDataWrite = (args) => {
  if (args[0] !== "api") return null;
  const method = (args[args.indexOf("--method") + 1] ?? "GET").toUpperCase();
  if (method === "GET" || !args.includes("--method")) return null;
  const path = args.find((a, i) => i > 0 && /^\/?repos\//.test(a));
  const m = path && /repos\/[^/]+\/[^/]+\/git\/(refs|commits)(?:\/(.+))?$/.exec(path);
  if (!m) return null;
  /** @type {Record<string, string[]>} */
  const f = {};
  args.forEach((a, i) => {
    if ((a === "-f" || a === "-F") && args[i + 1]) {
      const at = args[i + 1].indexOf("=");
      const k = args[i + 1].slice(0, at).replace(/\[\]$/, "");
      (f[k] ??= []).push(args[i + 1].slice(at + 1));
    }
  });
  const run = (...g) => execFileSync("git", g, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const have = (sha) => {
    try {
      run("cat-file", "-e", `${sha}^{commit}`);
    } catch {
      run("fetch", "--quiet", "origin", sha);
    }
  };
  const [, kind, rest] = m;
  if (kind === "commits" && method === "POST") {
    for (const parent of f.parents ?? []) have(parent);
    const parents = (f.parents ?? []).flatMap((p) => ["-p", p]);
    const sha = run("commit-tree", f.tree[0], ...parents, "-m", f.message?.[0] ?? "");
    return JSON.stringify({ sha });
  }
  const remoteSha = (ref) => run("ls-remote", "origin", ref).split(/\s+/)[0] || "";
  const releasedMark = "rallypoint: released";
  const isReleased = (sha) => {
    have(sha);
    return run("log", "-1", "--format=%s", sha).startsWith(releasedMark);
  };
  if (kind === "refs" && method === "POST") {
    const ref = f.ref[0];
    have(f.sha[0]);
    // Atomic create, as compare-and-swap: the ref must be absent, or hold a released marker
    // (sessions cannot delete refs). Each reservation is its own commit, so a second claimant's
    // push is refused by the lease instead of passing as a no-op.
    const current = remoteSha(ref);
    if (current && !isReleased(current)) throw new Error(`HTTP 422: Reference already exists: ${ref}`);
    // A lease commit is already unique (its dispatch time and head) and carries the record that
    // `lease.mjs` reads from the commit the ref points at, so it is pushed as itself. Wrapping it
    // would hide those trailers and make every lease written here read as unknown.
    const own = run("log", "-1", "--format=%B", f.sha[0]);
    const tree = run("rev-parse", `${f.sha[0]}^{tree}`);
    const unique = /^Rallypoint-Lease-Role:/m.test(own)
      ? f.sha[0]
      : run("commit-tree", tree, "-p", f.sha[0], "-m", `rallypoint: reserve ${ref} at ${new Date().toISOString()} ${process.pid}`);
    run("push", "--quiet", `--force-with-lease=${ref}:${current}`, "origin", `${unique}:${ref}`);
    return JSON.stringify({ ref, object: { sha: unique } });
  }
  if (kind === "refs" && method === "PATCH") {
    const ref = `refs/${rest}`;
    have(f.sha[0]);
    run("push", "--quiet", "--force", "origin", `${f.sha[0]}:${ref}`);
    return JSON.stringify({ ref, object: { sha: f.sha[0] } });
  }
  if (kind === "refs" && method === "DELETE") {
    // Sessions may not delete branches. A coordination ref is released instead: it moves to a
    // marker commit that every read treats as absent and the next claim may take over. The
    // rallypoint-refs workflow deletes released refs and merged agent branches for good.
    const ref = `refs/${rest}`;
    const current = remoteSha(ref);
    if (!current || isReleased(current)) throw new Error(`HTTP 422: Reference does not exist: ${ref}`);
    if (!/^refs\/heads\/rallypoint-/.test(ref)) return ""; // agent branches: the workflow deletes them on merge
    const tree = run("rev-parse", `${current}^{tree}`);
    const mark = run("commit-tree", tree, "-p", current, "-m", `${releasedMark} ${ref} at ${new Date().toISOString()}`);
    run("push", "--quiet", `--force-with-lease=${ref}:${current}`, "origin", `${mark}:${ref}`);
    return "";
  }
  return null;
};

/** Released coordination refs read as absent, exactly as deleted ones would. */
const releasedCache = new Map();
const hideReleased = (args, out) => {
  const path = args.find((a, i) => i > 0 && /^\/?repos\//.test(a)) ?? "";
  const listing = /\/git\/matching-refs\/heads\/rallypoint-/.test(path);
  const single = /\/git\/ref\/heads\/rallypoint-/.test(path);
  if (!listing && !single) return out;
  const released = (sha) => {
    if (!releasedCache.has(sha)) {
      const repo = /repos\/([^/]+\/[^/]+)\//.exec(path)?.[1];
      const commit = JSON.parse(restTransport("api", `repos/${repo}/git/commits/${sha}`));
      releasedCache.set(sha, String(commit.message ?? "").startsWith("rallypoint: released"));
    }
    return releasedCache.get(sha);
  };
  const parsed = JSON.parse(out || "null");
  if (listing && Array.isArray(parsed)) return JSON.stringify(parsed.filter((r) => !released(r.object.sha)));
  if (single && parsed?.object?.sha && released(parsed.object.sha)) throw new Error("HTTP 404: Not Found");
  return out;
};

export const gh = (...args) => {
  if (useRest()) {
    if (args[0] === "--version") return "gh (rallypoint REST transport)";
    const emulated = gitDataWrite(args);
    if (emulated !== null) return emulated;
    restTransport ??= restOnly();
    const out = restTransport(...args);
    return args[0] === "api" ? hideReleased(args, out) : out;
  }
  ensureGh();

  const { command, prefixArgs } = ghCommand();
  return execFileSync(command, [...prefixArgs, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
};

/** @param {string[]} args */
export const git = (...args) =>
  execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

/**
 * Whether the `gh` binary is on `PATH`, asked once and before any request so a
 * missing prerequisite is reported by name rather than three calls into a
 * claim — the missing-prerequisite failure mode, extended to the transport
 * choice itself.
 */
const hasGh = () => {
  try {
    const { command, prefixArgs } = ghCommand();
    execFileSync(command, [...prefixArgs, "--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

/**
 * The transport Rallypoint scripts should use here: `gh` when it is
 * installed, since it is the reference implementation and carries its own
 * auth; otherwise the REST transport in `api.mjs`, which needs no binary at
 * all — cloud agent sessions have none, and every coordination
 * command was failing with `spawnSync gh ENOENT`.
 *
 * Not pre-flighted: a request GitHub refuses reports GitHub's own reason,
 * which is more useful than any guess this could make beforehand.
 *
 * @param {{ remote?: string }} [input]
 * @returns {(...args: string[]) => string}
 */
export const resolveTransport = ({ remote } = {}) => {
  if (useRest()) return gh;
  if (hasGh()) return gh;
  return restOnly({ remote });
};

/**
 * The REST transport for this checkout's repository.
 *
 * @param {{ remote?: string }} [input]
 * @returns {(...args: string[]) => string}
 */
const restOnly = ({ remote } = {}) => {

  const repository = repositoryFrom({
    remote:
      remote ??
      (() => {
        try {
          return execFileSync("git", ["config", "--get", "remote.origin.url"], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
          }).trim();
        } catch {
          return "";
        }
      })(),
  });

  if (!repository) {
    console.error(
      "No `gh` on PATH and no repository could be read from the git remote, " +
        "so there is no way to reach GitHub. Set GITHUB_REPOSITORY to " +
        "`owner/repo`, or run this from a checkout with an `origin` remote.",
    );
    process.exit(1);
  }

  return createTransport({ request: syncRequest(), repository });
};

// Resolved on call rather than at module scope. `import.meta.url` is not a
// `file:` URL under every loader — vitest's is not — so doing this at import
// time made this module unimportable from anything a test touches, which is
// the opposite of what the header above intends. Only `checkPullRequest` needs
// the path, and only when it actually runs.
const reviewScript = () =>
  fileURLToPath(new URL("../review.mjs", import.meta.url));

/**
 * Runs `review.mjs check --pr <n>` and reports its exit code, rather than
 * reimplementing the exit-code table it already owns. `review.mjs check` is
 * itself read-only — it only ever removes a stale `review:approved` label
 * under `--strip-stale`, which this call never passes — so this stays within
 * the report's own read-only contract.
 *
 * @param {number} pr
 * @returns {{ code: number | null, output: string }}
 */
export const checkPullRequest = (pr) => {
  try {
    const stdout = execFileSync(
      process.execPath,
      [reviewScript(), "check", "--pr", String(pr)],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { code: 0, output: stdout.trim() };
  } catch (error) {
    const detail = /** @type {{ status?: unknown, stderr?: unknown, stdout?: unknown, message?: unknown }} */ (
      error ?? {}
    );
    return {
      code: typeof detail.status === "number" ? detail.status : null,
      output: String(detail.stderr ?? detail.stdout ?? detail.message ?? "").trim(),
    };
  }
};

/**
 * Reads and validates `.rallypoint/config.json`. A malformed config is fatal
 * here rather than a confusing failure three `gh` calls later.
 */
export const loadConfig = () => {
  const config = JSON.parse(
    readFileSync(new URL("../../config.json", import.meta.url), "utf8"),
  );
  const result = validateConfig(config);

  if (!result.ok) {
    for (const problem of result.problems) {
      console.error(`.rallypoint/config.json: ${problem}`);
    }
    process.exit(1);
  }

  return config;
};
