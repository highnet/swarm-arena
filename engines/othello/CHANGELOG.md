# Changelog

## [0.4.0](https://github.com/highnet/swarm-arena/compare/othello-engine-v0.3.0...othello-engine-v0.4.0) (2026-11-28)


### Features

* **othello:** Phase-bucketed self-play fit of the Othello evaluation weights (corner, mobility, X/C, potential mobility, stable discs) ([#302](https://github.com/highnet/swarm-arena/issues/302)) ([fd87c80](https://github.com/highnet/swarm-arena/commit/fd87c80ceda90ab835768957216bc4c06a8365e7))
* **othello:** Spend the clock: search to go minus a safety margin instead of the 1/3 'don't start' rule ([#294](https://github.com/highnet/swarm-arena/issues/294)) ([4a7b0f8](https://github.com/highnet/swarm-arena/commit/4a7b0f8766113eb4fbf94de836123951cfa3eefa))

## [0.3.0](https://github.com/highnet/swarm-arena/compare/othello-engine-v0.2.0...othello-engine-v0.3.0) (2026-11-25)


### Features

* **othello:** Self-generated opening book: the engine's own long searches over the first moves, probed instantly ([#138](https://github.com/highnet/swarm-arena/issues/138)) ([b48dfdc](https://github.com/highnet/swarm-arena/commit/b48dfdc7e49fc37aa20b3f3d0ed1a9dd879d5b12))
* **othello:** Transposition table in the midgame search, ported from chess's shipped TT and judged against v0.5 ([#156](https://github.com/highnet/swarm-arena/issues/156)) ([cbf289f](https://github.com/highnet/swarm-arena/commit/cbf289ffda3410b19682249c2a5d48193bff3ac3))

## [0.2.0](https://github.com/highnet/swarm-arena/compare/othello-engine-v0.1.0...othello-engine-v0.2.0) (2026-11-24)


### Features

* **othello:** Alpha-beta with iterative deepening and X/C-square evaluation ([#39](https://github.com/highnet/swarm-arena/issues/39)) ([126f122](https://github.com/highnet/swarm-arena/commit/126f122fbb467b91758bcb33637beb84583a02e8))
* **othello:** Resubmit [#67](https://github.com/highnet/swarm-arena/issues/67): potential mobility + edge-anchored stable discs, measured on the fixed gate ([#89](https://github.com/highnet/swarm-arena/issues/89)) ([7035555](https://github.com/highnet/swarm-arena/commit/7035555eb5857f5c62a4718cf50756ff4ff157b0))
* **othello:** Resubmit [#94](https://github.com/highnet/swarm-arena/issues/94)'s exact endgame solver on the varied-opening gate ([#114](https://github.com/highnet/swarm-arena/issues/114)) ([4342180](https://github.com/highnet/swarm-arena/commit/43421804de988724b28006a9472f2f1c93a52063))

## 0.1.0 (2026-11-23)


### Features

* **othello:** Wire the othello crate to the protocol and play legal moves ([#4](https://github.com/highnet/swarm-arena/issues/4)) ([5e649f0](https://github.com/highnet/swarm-arena/commit/5e649f05abfd6d82df41c426bda5484a07212c8f))
