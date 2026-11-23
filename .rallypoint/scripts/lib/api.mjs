// A `gh`-shaped transport that speaks the GitHub REST API directly.
//
// Every Rallypoint script reaches GitHub through one seam — `gh(...args) =>
// string` — and until now the only implementation of it shelled out to the `gh`
// binary. Cloud agent sessions have no `gh`, so those scripts failed outright
// with `spawnSync gh ENOENT`. This is a second implementation of the same
// seam: same synchronous signature, same stringly JSON output, same throw-on-
// failure contract, so no script logic changes.
//
// Three parts of the contract matter more than they look:
//
//  1. **It must throw on a failed request.** `claim.mjs` takes its atomic
//     reservation by POSTing a ref and treating a throw as "another session got
//     there first". A transport that returned an error object instead would hand
//     two sessions the same issue.
//  2. **Output must match `gh --json` exactly**, not the REST shapes underneath.
//     `gh` reports issue state as `CLOSED` where REST says `closed`, and
//     `cleanup.mjs` compares against the former — get this wrong and a
//     reservation is never released. Each translation below is there because a
//     caller depends on that spelling.
//  3. **An unrecognised command throws by name.** Guessing at a command this
//     module has not been taught is how a coordination script silently does
//     something other than what it says.
//
// The surface is deliberately only what `claim.mjs`, `cleanup.mjs`, and
// `review.mjs` actually call. `close-referenced-issues.mjs` is not included: it
// runs in Actions where `gh` exists, and has never been affected by any of this.

/** An API call the transport wants performed. */
/**
 * @typedef {{
 *   method: string,
 *   path: string,
 *   body?: unknown,
 * }} ApiRequest
 */

/**
 * @typedef {{
 *   status: number,
 *   body: unknown,
 *   nextPath?: string | null,
 * }} ApiResponse
 */

/**
 * A request this module was not taught. Thrown rather than approximated: the
 * scripts read stdout as JSON, so a plausible-looking guess would be acted on.
 */
export class UnsupportedCommand extends Error {
  /** @param {string[]} args */
  constructor(args) {
    super(
      `The API transport does not implement \`gh ${args.join(" ")}\`. Add it to ` +
        ".rallypoint/scripts/lib/api.mjs rather than working around it — a " +
        "coordination command that half-runs is worse than one that fails.",
    );
    this.name = "UnsupportedCommand";
  }
}

/** A request that GitHub refused. Mirrors a non-zero `gh` exit. */
export class ApiError extends Error {
  /**
   * @param {ApiRequest} request
   * @param {ApiResponse} response
   */
  constructor(request, response) {
    const detail =
      typeof response.body === "object" && response.body !== null
        ? /** @type {{ message?: string }} */ (response.body).message
        : undefined;

    super(
      `${request.method} ${request.path} failed with ${response.status}` +
        (detail ? `: ${detail}` : "") +
        // The failure a cloud agent session actually hits, and the one whose
        // remedy is not in this repository. Saying so here saves the next
        // session rediscovering it.
        (detail?.includes("not enabled for this session")
          ? "\n\nThis session's credential is not authorized for the repository " +
            "API, so no Rallypoint command can reach GitHub from here. The " +
            "remedy is an org admin connecting the GitHub App for the " +
            "organization."
          : ""),
    );
    this.name = "ApiError";
    this.status = response.status;
  }
}

/**
 * Flags of the form `--flag value`, in order. Repeated flags are kept, because
 * `issue list --label a --label b` means both.
 *
 * @param {string[]} args
 * @param {string} flag
 */
const values = (args, flag) =>
  args.flatMap((entry, index) =>
    entry === flag && args[index + 1] !== undefined ? [args[index + 1]] : [],
  );

/**
 * @param {string[]} args
 * @param {string} flag
 */
const value = (args, flag) => values(args, flag).at(0);

/**
 * `gh --json a,b,c` returns only the requested fields. Building the full record
 * and then picking keeps each translation in one place and makes an unmapped
 * field an explicit failure rather than a silent `undefined`.
 *
 * @param {Record<string, unknown>} available
 * @param {string | undefined} requested
 * @param {string[]} args
 */
const pick = (available, requested, args) => {
  if (!requested) throw new UnsupportedCommand(args);

  /** @type {Record<string, unknown>} */
  const result = {};

  for (const field of requested.split(",")) {
    if (!(field in available)) throw new UnsupportedCommand(args);
    result[field] = available[field];
  }

  return result;
};

/**
 * `-f key=value` pairs, as `gh api` takes them. Values are strings; `gh` also
 * accepts typed `-F`, which no caller here uses.
 *
 * @param {string[]} args
 */
const fields = (args) => {
  /** @type {Record<string, string>} */
  const body = {};

  for (const pair of values(args, "-f")) {
    const at = pair.indexOf("=");
    if (at === -1) continue;
    body[pair.slice(0, at)] = pair.slice(at + 1);
  }

  return body;
};

/**
 * The transport. `request` performs one call and reports the status, the parsed
 * body, and the `Link: rel="next"` path when there is one; everything about how
 * that happens — sockets, proxies, credentials — stays outside this module so it
 * can be tested without any of them.
 *
 * @param {{
 *   request: (call: ApiRequest) => ApiResponse,
 *   repository: string,
 * }} input
 * @returns {(...args: string[]) => string}
 */
export const createTransport = ({ request, repository }) => {
  /**
   * @param {ApiRequest} call
   * @returns {unknown}
   */
  const send = (call) => {
    const response = request(call);

    // Mirrors `gh`: a failed request is a non-zero exit, which `execFileSync`
    // turns into a throw. Callers depend on that — see the reservation POST.
    if (response.status < 200 || response.status >= 300) {
      throw new ApiError(call, response);
    }

    return response.body;
  };

  /**
   * Follows `Link: rel="next"` and concatenates the pages, which is what
   * `gh api --paginate` does for an array response.
   *
   * @param {ApiRequest} call
   * @returns {unknown[]}
   */
  const sendPaginated = (call) => {
    /** @type {unknown[]} */
    const pages = [];
    /** @type {string | null | undefined} */
    let path = call.path;

    while (path) {
      const response = request({ ...call, path });

      if (response.status < 200 || response.status >= 300) {
        throw new ApiError({ ...call, path }, response);
      }

      pages.push(response.body);
      path = response.nextPath;
    }

    return pages;
  };

  /**
   * An issue's comments in `gh`'s shape (which the scripts read), alongside the
   * REST fields.
   *
   * @param {string} base
   * @param {unknown} issue
   */
  const issueComments = (base, issue) =>
    /** @type {Record<string, any>[]} */ (
      sendPaginated({
        method: "GET",
        path: `${base}/issues/${issue}/comments?per_page=100`,
      }).flat()
    ).map((c) => ({
      ...c,
      author: c.user ? { login: c.user.login } : null,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
      url: c.html_url,
    }));

  const authenticatedLogin = () =>
    /** @type {{ login: string }} */ (send({ method: "GET", path: "/user" })).login;

  /** @param {string} assignee `@me`, which is the only form any caller uses. */
  const resolveAssignee = (assignee, /** @type {string[]} */ args) => {
    if (assignee === "@me") return authenticatedLogin();
    // An explicit login (the shared identity a release clears) is passed through as is.
    if (/^[A-Za-z0-9-]+$/.test(assignee)) return assignee;
    throw new UnsupportedCommand(args);
  };

  return (...args) => {
    const [group, command, ...rest] = args;
    const base = `/repos/${repository}`;

    // `gh pr view <branch>` accepts a branch name; REST wants the number.
    /** @param {string} ref */
    const pullNumber = (ref) => {
      if (/^\d+$/.test(String(ref))) return String(ref);
      const owner = repository.split("/")[0];
      const found = /** @type {{ number: number }[]} */ (
        send({
          method: "GET",
          path: `${base}/pulls?state=all&per_page=5&head=${encodeURIComponent(`${owner}:${ref}`)}`,
        })
      );
      if (!found.length) throw new Error(`no pull request found for branch "${ref}"`);
      return String(found[0].number);
    };

    // gh repo view --json nameWithOwner[,defaultBranchRef]
    if (group === "repo" && command === "view") {
      const repo = /** @type {{ full_name: string, default_branch: string }} */ (
        send({ method: "GET", path: base })
      );

      return JSON.stringify(
        pick(
          {
            nameWithOwner: repo.full_name,
            defaultBranchRef: { name: repo.default_branch },
          },
          value(args, "--json"),
          args,
        ),
      );
    }

    // gh issue list --state open --label … --limit … --json …
    //
    // REST caps a page at 100, so `--limit` (callers ask for up to 300) is met
    // by following `Link: rel="next"` until enough issues are collected —
    // asking for `per_page=300` would silently return 100.
    if (group === "issue" && command === "list") {
      const limit = Number(value(args, "--limit") ?? "30");
      const query = new URLSearchParams({
        state: value(args, "--state") ?? "open",
        per_page: String(Math.min(Math.max(limit, 1), 100)),
      });
      const labels = values(args, "--label");

      if (labels.length > 0) query.set("labels", labels.join(","));

      /** @type {Record<string, unknown>[]} */
      const issues = [];
      /** @type {string | null | undefined} */
      let path = `${base}/issues?${query}`;

      while (path && issues.length < limit) {
        const call = { method: "GET", path };
        const response = request(call);

        if (response.status < 200 || response.status >= 300) {
          throw new ApiError(call, response);
        }

        issues.push(
          .../** @type {Record<string, unknown>[]} */ (response.body)
            // The REST issues list includes pull requests; `gh issue list` does
            // not. Without this, `claim.mjs` could reserve a pull request number.
            .filter((issue) => !("pull_request" in issue)),
        );
        path = response.nextPath;
      }

      const requested = value(args, "--json")?.split(",") ?? [];

      return JSON.stringify(
        issues.slice(0, limit).map((issue) => {
          const available = issueFields(issue);

          // Comments are a separate resource, so only fetch them when asked.
          if (requested.includes("comments")) {
            available.comments = issueComments(base, issue.number);
          }

          return pick(available, value(args, "--json"), args);
        }),
      );
    }

    // gh issue view <n> --json state|comments|…
    if (group === "issue" && command === "view") {
      const issue = /** @type {Record<string, unknown>} */ (
        send({ method: "GET", path: `${base}/issues/${rest[0]}` })
      );
      const requested = value(args, "--json")?.split(",") ?? [];
      const available = issueFields(issue);

      // Comments are a separate resource, so only fetch them when asked.
      if (requested.includes("comments")) {
        available.comments = issueComments(base, rest[0]);
      }

      return JSON.stringify(pick(available, value(args, "--json"), args));
    }

    // gh issue comment <n> --body <text>
    if (group === "issue" && command === "comment") {
      send({
        method: "POST",
        path: `${base}/issues/${rest[0]}/comments`,
        body: { body: value(args, "--body") },
      });
      return "";
    }

    // gh issue edit <n> [--add-assignee @me] [--remove-assignee @me]
    //                   [--add-label L] [--remove-label L]
    //
    // `gh` performs this as one mutation; REST needs up to four calls. A failure
    // partway through throws, which `claim.mjs` compensates for by restoring the
    // issue and releasing its reservation — the same handling it already has for
    // a failed `gh issue edit`.
    if (group === "issue" && command === "edit") {
      const issue = rest[0];

      for (const assignee of values(args, "--add-assignee")) {
        send({
          method: "POST",
          path: `${base}/issues/${issue}/assignees`,
          body: { assignees: [resolveAssignee(assignee, args)] },
        });
      }

      for (const assignee of values(args, "--remove-assignee")) {
        send({
          method: "DELETE",
          path: `${base}/issues/${issue}/assignees`,
          body: { assignees: [resolveAssignee(assignee, args)] },
        });
      }

      const added = values(args, "--add-label");

      if (added.length > 0) {
        send({
          method: "POST",
          path: `${base}/issues/${issue}/labels`,
          body: { labels: added },
        });
      }

      for (const label of values(args, "--remove-label")) {
        // A label that is not present is not an error for `gh`, and callers
        // remove a label without first checking it is there.
        try {
          send({
            method: "DELETE",
            path: `${base}/issues/${issue}/labels/${encodeURIComponent(label)}`,
          });
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 404) throw error;
        }
      }

      return "";
    }

    // gh pr view <n> --json …
    if (group === "pr" && command === "view") {
      const pull =
        /** @type {{ number: number, body: string | null, labels: unknown[], head: { sha: string, ref: string }, base?: { ref: string }, user: { login: string, type: string } | null }} */ (
          send({ method: "GET", path: `${base}/pulls/${pullNumber(rest[0])}` })
        );

      return JSON.stringify(
        pick(
          {
            number: pull.number,
            body: pull.body,
            labels: pull.labels,
            headRefOid: pull.head.sha,
            headRefName: pull.head.ref,
            // Read by `isPromotionBranch` for the snapshot promotion shape
            //: a `promotion/*` head is a promotion only when it
            // targets the promotion branch.
            baseRefName: pull.base?.ref ?? null,
            ...pullExtras(pull),
            // `gh pr view --json author` reports `{ login, is_bot, ... }` with
            // the `[bot]` suffix stripped; REST reports
            // `user: { login: "dependabot[bot]", type: "Bot" }`. Only `login`
            // and `is_bot` are read (`isDependabotAuthor` in provenance.mjs),
            // and it accepts either spelling of the login, so the two
            // transports agree on whether a pull request is bot-authored.
            author: pull.user
              ? { login: pull.user.login, is_bot: pull.user.type === "Bot" }
              : null,
          },
          value(args, "--json"),
          args,
        ),
      );
    }

    // gh pr edit <n> --add-label|--remove-label <label>
    //
    // Labels on a pull request are issue labels, which is also why this needs no
    // pull-request-specific route.
    if (group === "pr" && command === "edit") {
      const added = values(args, "--add-label");

      if (added.length > 0) {
        send({
          method: "POST",
          path: `${base}/issues/${rest[0]}/labels`,
          body: { labels: added },
        });
      }

      for (const label of values(args, "--remove-label")) {
        try {
          send({
            method: "DELETE",
            path: `${base}/issues/${rest[0]}/labels/${encodeURIComponent(label)}`,
          });
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 404) throw error;
        }
      }

      return "";
    }

    // gh pr review <n> --comment --body <text>
    //
    // Only COMMENT. APPROVE and REQUEST_CHANGES are refused by GitHub from a
    // pull request's own author, and every session here shares one identity
    //, so `review.mjs` never asks for them.
    if (group === "pr" && command === "review") {
      if (!args.includes("--comment")) throw new UnsupportedCommand(args);

      send({
        method: "POST",
        path: `${base}/pulls/${rest[0]}/reviews`,
        body: { event: "COMMENT", body: value(args, "--body") },
      });
      return "";
    }

    // gh issue create --title T --body B [--label L]… → prints the issue URL, like gh.
    if (group === "issue" && command === "create") {
      const created = /** @type {{ html_url: string }} */ (
        send({
          method: "POST",
          path: `${base}/issues`,
          body: {
            title: value(args, "--title"),
            body: value(args, "--body") ?? "",
            labels: values(args, "--label"),
          },
        })
      );
      return created.html_url;
    }

    // gh pr list [--state open|closed|merged|all] [--label L] [--head B] [--limit N] --json …
    if (group === "pr" && command === "list") {
      const wanted = value(args, "--state") ?? "open";
      const query = new URLSearchParams({
        state: wanted === "merged" ? "closed" : wanted,
        per_page: value(args, "--limit") ?? "30",
      });
      const head = value(args, "--head");
      if (head) query.set("head", `${repository.split("/")[0]}:${head}`);
      const labels = values(args, "--label");
      const pulls = /** @type {Record<string, any>[]} */ (
        send({ method: "GET", path: `${base}/pulls?${query}` })
      )
        .filter((p) => wanted !== "merged" || p.merged_at)
        .filter((p) =>
          labels.every((l) => (p.labels ?? []).some((x) => x.name === l)),
        );
      return JSON.stringify(
        pulls.map((p) =>
          pick(
            {
              number: p.number,
              title: p.title,
              body: p.body,
              labels: p.labels,
              headRefName: p.head.ref,
              headRefOid: p.head.sha,
              baseRefName: p.base?.ref ?? null,
              author: p.user ? { login: p.user.login, is_bot: p.user.type === "Bot" } : null,
              ...pullExtras(p),
            },
            value(args, "--json"),
            args,
          ),
        ),
      );
    }

    // gh pr create --title T --body B --base X --head Y [--label L]… [--draft] → prints the URL.
    if (group === "pr" && command === "create") {
      const created = /** @type {{ number: number, html_url: string }} */ (
        send({
          method: "POST",
          path: `${base}/pulls`,
          body: {
            title: value(args, "--title"),
            body: value(args, "--body") ?? "",
            base: value(args, "--base"),
            head: value(args, "--head"),
            draft: args.includes("--draft"),
          },
        })
      );
      const labels = values(args, "--label");
      if (labels.length > 0) {
        send({
          method: "POST",
          path: `${base}/issues/${created.number}/labels`,
          body: { labels },
        });
      }
      return created.html_url;
    }

    // gh pr merge <n> --squash|--merge|--rebase [--subject S] [--body B]
    //                 [--match-head-commit SHA] [--delete-branch]
    if (group === "pr" && command === "merge") {
      const number = pullNumber(rest[0]);
      const method = args.includes("--squash")
        ? "squash"
        : args.includes("--rebase")
          ? "rebase"
          : "merge";
      const body = {
        merge_method: method,
        ...(value(args, "--subject") ? { commit_title: value(args, "--subject") } : {}),
        ...(value(args, "--body") !== undefined ? { commit_message: value(args, "--body") } : {}),
        ...(value(args, "--match-head-commit") ? { sha: value(args, "--match-head-commit") } : {}),
      };
      const pull = /** @type {{ head: { ref: string } }} */ (
        send({ method: "GET", path: `${base}/pulls/${number}` })
      );
      send({ method: "PUT", path: `${base}/pulls/${number}/merge`, body });
      if (args.includes("--delete-branch")) {
        try {
          send({ method: "DELETE", path: `${base}/git/refs/heads/${pull.head.ref}` });
        } catch {
          // Already gone, or protected: the merge itself is what matters.
        }
      }
      return "";
    }

    // gh api [--method M] [--paginate] [--slurp] <path> [-f k=v]…
    if (group === "api") {
      const method = value(args, "--method") ?? "GET";
      // The path is the first bare argument: everything else is a flag or a
      // flag's value.
      const flagged = new Set(
        args.flatMap((entry, index) =>
          ["--method", "-f", "--jq"].includes(entry) ? [index + 1] : [],
        ),
      );
      const path = args
        .slice(1)
        .find(
          (entry, index) => !entry.startsWith("-") && !flagged.has(index + 1),
        );

      if (!path) throw new UnsupportedCommand(args);

      const body = fields(args);
      const call = {
        method,
        path: path.startsWith("/") ? path : `/${path}`,
        ...(Object.keys(body).length > 0 ? { body } : {}),
      };

      if (args.includes("--paginate")) {
        const pages = sendPaginated(call);
        // `--slurp` keeps the pages as an array of arrays; without it `gh`
        // concatenates them.
        return JSON.stringify(args.includes("--slurp") ? pages : pages.flat());
      }

      const response = send(call);

      // A 204 has no body. `gh` prints nothing, and the DELETE callers ignore
      // stdout entirely.
      return response === undefined || response === null
        ? ""
        : JSON.stringify(response);
    }

    throw new UnsupportedCommand(args);
  };
};

/**
 * The `gh issue`-flavoured view of a REST issue.
 *
 * `state` is the one to be careful with: `gh` reports `OPEN`/`CLOSED` and
 * `cleanup.mjs` compares against `CLOSED`, so lower-casing it here would stop
 * every reservation from being released.
 *
 * @param {Record<string, unknown>} issue
 * @returns {Record<string, unknown>}
 */

/**
 * Fields `gh pr view/list --json` reports that REST spells differently.
 *
 * @param {Record<string, any>} pull
 */
const pullExtras = (pull) => ({
  title: pull.title,
  url: pull.html_url,
  isDraft: Boolean(pull.draft),
  state: pull.merged_at ? "MERGED" : String(pull.state ?? "").toUpperCase(),
  mergedAt: pull.merged_at ?? null,
  createdAt: pull.created_at,
  updatedAt: pull.updated_at,
  mergeCommit: pull.merge_commit_sha && pull.merged_at ? { oid: pull.merge_commit_sha } : null,
  // gh resolves these from GitHub's own linking; the body's keywords are what links them.
  closingIssuesReferences: [
    ...String(pull.body ?? "").matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi),
  ].map((m) => ({ number: Number(m[1]) })),
});

const issueFields = (issue) => ({
  number: issue.number,
  title: issue.title,
  body: issue.body,
  labels: issue.labels,
  assignees: issue.assignees,
  state: String(issue.state ?? "").toUpperCase(),
  createdAt: issue.created_at,
  updatedAt: issue.updated_at,
  url: issue.html_url,
});

export default createTransport;
