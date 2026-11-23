import assert from "node:assert/strict";
import { test } from "node:test";
import { withVerdict } from "./verdict";

const book = `# Chess

- not a verdict · x · Same title · y

## Results log

- 2026-11-23 17:17 UTC · v0.4 passed the referee · Same title · rated 1420 (+114)
- 2026-11-23 19:07 UTC · buried · Other task · lost head to head
`;

test("a resubmitted task replaces its earlier verdict line", () => {
  const out = withVerdict(
    book,
    "Same title",
    "- 2026-11-23 17:48 UTC · v0.4 passed the referee · Same title · rated 1376 (+70)",
  );
  assert.equal(out.match(/v0\.4 passed/g)?.length, 1);
  assert.match(out, /rated 1376 \(\+70\)\n$/);
  assert.match(out, /Other task/);
  // Lines above the results log are never touched.
  assert.match(out, /not a verdict · x · Same title/);
});

test("a new task appends its line", () => {
  const line =
    "- 2026-11-23 20:04 UTC · v0.5 passed the referee · New · rated 1458";
  assert.equal(withVerdict(book, "New", line), `${book}${line}\n`);
});
