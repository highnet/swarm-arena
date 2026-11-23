// node --test .rallypoint/scripts/lib/gh.test.mjs
//
// The REST transport's view of coordination refs, with a stubbed reader: a live
// reservation reads as present, a `rallypoint: released` marker as absent, and every
// reservation removal is a `gh api --method DELETE` that `lib/gh.mjs` emulates
// (a marker commit) rather than a raw DELETE the session proxy refuses.

import assert from "node:assert/strict";
import { test } from "node:test";

import { removeReservation } from "../close-referenced-issues.mjs";
import { cleanup } from "./cleanup.mjs";
import { gitDataRequest, hideReleased, isReleasedMessage } from "./gh.mjs";

const REPO = "owner/repo";
const PREFIX = "rallypoint-claims/issue-";
const ref = (issue, sha) => ({ ref: `refs/heads/${PREFIX}${issue}`, object: { sha, type: "commit" } });

/** A reader that answers `git/commits/<sha>` from a table. */
const commits = (table) => (...args) => {
  const sha = /git\/commits\/(\w+)$/.exec(args[1])?.[1];
  if (!(sha in table)) throw new Error(`HTTP 404: unexpected read ${args[1]}`);
  return JSON.stringify({ sha, message: table[sha] });
};

test("isReleasedMessage: only the released marker counts as released", () => {
  assert.equal(isReleasedMessage("rallypoint: released refs/heads/x at 2026-11-23T21:17:03Z"), true);
  assert.equal(isReleasedMessage("rallypoint: reserve refs/heads/x at 2026-11-23T20:23:20Z 1420"), false);
  assert.equal(isReleasedMessage(undefined), false);
});

test("hideReleased: a listing keeps live reservations and drops released markers", () => {
  const read = commits({
    a1live: "rallypoint: reserve refs/heads/rallypoint-claims/issue-107 at 2026-11-23T20:23:20.206Z 1420",
    a1gone: "rallypoint: released refs/heads/rallypoint-claims/issue-1070 at 2026-11-23T21:17:03.185Z",
  });
  const out = JSON.stringify([ref(107, "a1live"), ref(1070, "a1gone")]);
  for (const path of [
    `repos/${REPO}/git/matching-refs/heads/${PREFIX}107`,
    `repos/${REPO}/git/matching-refs/heads/${PREFIX}107?per_page=100`,
  ]) {
    const kept = JSON.parse(hideReleased(["api", path], out, read)).map((r) => r.ref);
    assert.deepEqual(kept, [`refs/heads/${PREFIX}107`]);
  }
});

test("hideReleased: a single-ref read of a released marker is a 404, of a live one unchanged", () => {
  const read = commits({ b2live: "rallypoint: reserve x", b2gone: "rallypoint: released x" });
  const live = JSON.stringify(ref(5, "b2live"));
  assert.equal(hideReleased(["api", `repos/${REPO}/git/ref/heads/${PREFIX}5`], live, read), live);
  assert.throws(
    () => hideReleased(["api", `repos/${REPO}/git/ref/heads/${PREFIX}6`], JSON.stringify(ref(6, "b2gone")), read),
    /HTTP 404/,
  );
});

test("hideReleased: reads outside coordination refs are passed through untouched", () => {
  const read = () => assert.fail("no commit should be read");
  const out = JSON.stringify([{ ref: "refs/heads/agent/1-x", object: { sha: "c3" } }]);
  assert.equal(hideReleased(["api", `repos/${REPO}/git/matching-refs/heads/agent/1-`], out, read), out);
});

test("gitDataRequest: a ref DELETE is emulated, reads are not", () => {
  const del = gitDataRequest(["api", "--method", "DELETE", `repos/${REPO}/git/refs/heads/${PREFIX}107`]);
  assert.deepEqual({ method: del?.method, kind: del?.kind, rest: del?.rest }, {
    method: "DELETE",
    kind: "refs",
    rest: `heads/${PREFIX}107`,
  });
  assert.equal(gitDataRequest(["api", `repos/${REPO}/git/matching-refs/heads/${PREFIX}107`]), null);
  assert.equal(gitDataRequest(["api", "--method", "GET", `repos/${REPO}/git/ref/heads/${PREFIX}107`]), null);
});

test("removeReservation: a live reservation is removed through a DELETE gh.mjs emulates", () => {
  const calls = [];
  const execute = (...command) => {
    calls.push(command);
    if (command.includes("DELETE")) return "";
    return JSON.stringify([ref(107, "d4"), ref(1070, "d5")]);
  };
  assert.equal(removeReservation({ nameWithOwner: REPO, issue: "107", claimRefPrefix: PREFIX, execute }), true);
  const del = calls.find((c) => c.includes("DELETE"));
  assert.equal(del[0], "gh");
  assert.equal(gitDataRequest(del.slice(1))?.rest, `heads/${PREFIX}107`);
});

test("removeReservation: a listing without the exact ref deletes nothing", () => {
  const execute = (...command) => {
    assert.ok(!command.includes("DELETE"), "no delete");
    return JSON.stringify([ref(1070, "e6")]);
  };
  assert.equal(removeReservation({ nameWithOwner: REPO, issue: "107", claimRefPrefix: PREFIX, execute }), false);
});

test("cleanup: a closed issue's live reservation is removed through a DELETE gh.mjs emulates", () => {
  const calls = [];
  const gh = (...args) => {
    calls.push(args);
    if (args[0] === "repo") return JSON.stringify({ nameWithOwner: REPO });
    if (args[0] === "issue" && args[1] === "view") return JSON.stringify({ state: "CLOSED", labels: [] });
    if (args.includes("DELETE")) return "";
    if (args[0] === "api") return JSON.stringify([ref(107, "f7")]);
    throw new Error(`unexpected ${args.join(" ")}`);
  };
  const code = cleanup({
    argv: ["--issue", "107"],
    config: { claimRefPrefix: PREFIX },
    gh,
    stdout: () => {},
    stderr: () => {},
  });
  assert.equal(code, 0);
  const del = calls.find((c) => c.includes("DELETE"));
  assert.equal(gitDataRequest(del)?.rest, `heads/${PREFIX}107`);
});
