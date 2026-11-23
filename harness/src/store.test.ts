import assert from "node:assert/strict";
import { test } from "node:test";
import { withRetry } from "./store";

const fetchFailed = {
  data: null,
  error: { message: "TypeError: fetch failed", code: "" },
  status: 0,
};
const ok = { data: { id: 1 }, error: null, status: 201 };

test("a transient network failure is retried until the write succeeds", async () => {
  const replies = [fetchFailed, fetchFailed, ok];
  let calls = 0;
  const r = await withRetry(async () => replies[calls++], 3, 1);
  assert.equal(calls, 3);
  assert.equal(r, ok);
});

test("retries are bounded", async () => {
  let calls = 0;
  const r = await withRetry(
    async () => {
      calls++;
      return fetchFailed;
    },
    3,
    1,
  );
  assert.equal(calls, 3);
  assert.equal(r, fetchFailed);
});

test("a constraint error is not retried", async () => {
  const dup = {
    data: null,
    error: { message: "duplicate key", code: "23505" },
    status: 409,
  };
  let calls = 0;
  await withRetry(
    async () => {
      calls++;
      return dup;
    },
    3,
    1,
  );
  assert.equal(calls, 1);
});
