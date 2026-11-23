#!/usr/bin/env node
// One GitHub REST request, run as a child process so `request.mjs` can stay synchronous.
// Reads { method, path, body?, baseUrl?, token? } as JSON on stdin and prints
// { status, body, nextPath } as JSON. An HTTP refusal exits 0 with its status; only a
// transport failure (DNS, proxy, TLS) exits non-zero.
import process from "node:process";

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const call = JSON.parse(Buffer.concat(chunks).toString("utf8"));
const base = (call.baseUrl || "https://api.github.com").replace(/\/$/, "");
// The session proxy refuses paths with a trailing slash before the query
// (`matching-refs/heads/prefix/?…`); GitHub treats the prefix the same without it.
const path = String(call.path).replace(/\/(\?|$)/, "$1");
const url = /^https?:/.test(path) ? path : `${base}${path}`;

const headers = {
  accept: "application/vnd.github+json",
  "x-github-api-version": "2022-11-28",
  "user-agent": "rallypoint",
};
if (call.token) headers.authorization = `Bearer ${call.token}`;
if (call.body !== undefined) headers["content-type"] = "application/json";

const response = await fetch(url, {
  method: call.method,
  headers,
  body: call.body === undefined ? undefined : JSON.stringify(call.body),
});
const text = await response.text();
let body = null;
try {
  body = text ? JSON.parse(text) : null;
} catch {
  body = text;
}
const next = /<([^>]+)>;\s*rel="next"/.exec(response.headers.get("link") ?? "")?.[1];
const nextPath = next ? next.replace(/^https?:\/\/[^/]+/, "") : null;
process.stdout.write(JSON.stringify({ status: response.status, body, nextPath }));
