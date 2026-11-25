import { ANIMAL_ICONS, ANIMAL_VIEWBOX } from "./animalIcons";

/**
 * Every agent's animal (#200): its node on the fleet graph and its portrait everywhere else. One
 * mapping, a pure function of the agent id, so the graph and every avatar always agree and the
 * same agent keeps its animal across pages, sessions and refreshes.
 *
 * Distinct where it matters: the seats the swarm runs (a role, then `role-2` … `role-5` as the
 * pool grows, and the engine seats) are placed first, in a fixed order, each on its own animal,
 * so any set of them working at once never shares one. Any other id hashes onto the set; near
 * collisions are spread by probing with a second hash.
 */

export type Animal = {
  /** The game-icons.net name, e.g. `sea-turtle`. */
  slug: string;
  /** The animal in words, e.g. `Sea turtle`: part of the agent's accessible name. */
  name: string;
  /** One SVG path in a `0 0 ANIMAL_VIEWBOX ANIMAL_VIEWBOX` box. */
  d: string;
};

export { ANIMAL_VIEWBOX };

export const ANIMALS: readonly Animal[] = ANIMAL_ICONS.map(
  ([slug, name, d]) => ({
    slug,
    name,
    d,
  }),
);

/** FNV-1a with a salt, so animals are independent of the hash that picks names. */
const hash = (s: string, salt: number) => {
  let h = 0x811c9dc5 ^ salt;
  for (let i = 0; i < s.length; i++)
    h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  // Final avalanche: ids differing only in a trailing digit land far apart.
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return h >>> 0;
};

const ROLES = [
  "worker",
  "reviewer",
  "merger",
  "fixer",
  "improver",
  "planner",
  "janitor",
  "steward",
  "strategist",
  "referee",
  "tester",
  "orchestrator",
];
const ENGINE_SEATS = {
  chess: ["builder", "rules", "search", "evaluation"],
  go9: ["builder", "rules", "search", "playout"],
  othello: ["builder", "rules", "search", "evaluation"],
  hex: ["builder", "rules", "search", "playout", "experiment"],
};

/** The seats the swarm runs, in the order they claim their animals. */
export const SEATS: readonly string[] = [
  ...ROLES.flatMap((r) => [r, `${r}-2`, `${r}-3`]),
  ...Object.entries(ENGINE_SEATS).flatMap(([g, subs]) =>
    subs.map((s) => `${g}-${s}`),
  ),
  ...ROLES.flatMap((r) => [`${r}-4`, `${r}-5`]),
];

const normal = (id: string) => id.replace(/\//g, "-");

/** Open addressing: the id's own slot, else the next free one along its second-hash stride. */
const probe = (id: string, taken: Set<number>) => {
  const n = ANIMALS.length;
  const start = hash(id, 0) % n;
  const step = 1 + (hash(id, 0x9e3779b9) % (n - 1));
  for (let i = 0, k = start; i < n; i++, k = (k + step) % n)
    if (!taken.has(k)) return k;
  // A stride that shares a factor with the set's size cycles early: scan the rest in order.
  for (let i = 0; i < n; i++) if (!taken.has((start + i) % n)) return (start + i) % n;
  return start;
};

const PINNED = (() => {
  const taken = new Set<number>();
  const pinned = new Map<string, number>();
  for (const seat of SEATS) {
    const k = probe(seat, taken);
    taken.add(k);
    pinned.set(seat, k);
  }
  return pinned;
})();

/** The index of an agent's animal in `ANIMALS`. */
export const animalIndex = (id: string) => {
  const key = normal(id);
  return PINNED.get(key) ?? hash(key, 0) % ANIMALS.length;
};

/** An agent's animal: the same for the same id, everywhere. */
export const animalOf = (id: string): Animal => ANIMALS[animalIndex(id)];
