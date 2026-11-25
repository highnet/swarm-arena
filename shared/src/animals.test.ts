import { test } from "node:test";
import assert from "node:assert/strict";
import { ANIMALS, SEATS, animalIndex, animalOf } from "./animals";

test("at least 64 distinct animals, each a non-empty path", () => {
  assert.ok(ANIMALS.length >= 64);
  assert.equal(new Set(ANIMALS.map((a) => a.slug)).size, ANIMALS.length);
  assert.equal(new Set(ANIMALS.map((a) => a.name)).size, ANIMALS.length);
  for (const a of ANIMALS) assert.match(a.d, /^[Mm]/);
});

test("the same id always gets the same animal; a seat and its id form agree", () => {
  assert.equal(animalOf("worker-2"), animalOf("worker-2"));
  assert.equal(animalOf("chess/search"), animalOf("chess-search"));
  assert.equal(
    animalIndex("cd-d3-worker-200"),
    animalIndex("cd-d3-worker-200"),
  );
});

test("every seat the swarm runs has its own animal, so concurrent seats never share", () => {
  const seen = new Map<number, string>();
  for (const s of SEATS) {
    const k = animalIndex(s);
    assert.equal(
      seen.get(k),
      undefined,
      `${s} shares an animal with ${seen.get(k)}`,
    );
    seen.set(k, s);
  }
});

test("a pool's numbered seats are not neighbours in the set", () => {
  const ks = ["worker", "worker-2", "worker-3", "worker-4"].map(animalIndex);
  assert.equal(new Set(ks).size, 4);
});
