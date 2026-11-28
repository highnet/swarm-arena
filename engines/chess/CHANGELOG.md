# Changelog

## [0.4.0](https://github.com/highnet/swarm-arena/compare/chess-engine-v0.3.0...chess-engine-v0.4.0) (2026-11-28)


### Features

* **chess:** Resubmit [#179](https://github.com/highnet/swarm-arena/issues/179) on the sequential gate: mobility and passed pawns in evaluate (commit c87d35a) ([#292](https://github.com/highnet/swarm-arena/issues/292)) ([a533c44](https://github.com/highnet/swarm-arena/commit/a533c4466c5e38122e90d254ebabc6ba0ad0dd14))
* **chess:** Resubmit [#186](https://github.com/highnet/swarm-arena/issues/186) unchanged on the sequential gate: spend the clock (commit 3476103) ([#271](https://github.com/highnet/swarm-arena/issues/271)) ([1893f66](https://github.com/highnet/swarm-arena/commit/1893f662765cab6514c61f82e045188b2761b877))
* **chess:** Texel-style fit of the chess evaluation weights on positions from the engine's own self-play ([#300](https://github.com/highnet/swarm-arena/issues/300)) ([2cd0017](https://github.com/highnet/swarm-arena/commit/2cd0017dbaa5a0b997fbdaa990fda20734b00ba6))

## [0.3.0](https://github.com/highnet/swarm-arena/compare/chess-engine-v0.2.0...chess-engine-v0.3.0) (2026-11-25)


### Features

* **chess:** Null-move pruning on top of PVS/LMR, guarded against zugzwang ([#158](https://github.com/highnet/swarm-arena/issues/158)) ([ab5dca2](https://github.com/highnet/swarm-arena/commit/ab5dca2d956ab1202a0ba4dcaab304cd04ea647a))
* **chess:** Self-generated opening book: the engine's own long searches over the first plies, probed instantly ([#146](https://github.com/highnet/swarm-arena/issues/146)) ([45fd915](https://github.com/highnet/swarm-arena/commit/45fd9150f5ab4009cc238429358b3ba61dab0319))
* **chess:** Static exchange evaluation (SEE): skip losing captures in quiescence and order captures by SEE ([#172](https://github.com/highnet/swarm-arena/issues/172)) ([07a8be5](https://github.com/highnet/swarm-arena/commit/07a8be591bffa9d9dead04e7bbb02e3b52bf86e8))

## [0.2.0](https://github.com/highnet/swarm-arena/compare/chess-engine-v0.1.0...chess-engine-v0.2.0) (2026-11-24)


### Features

* **chess:** Negamax alpha-beta with iterative deepening inside the go budget ([#40](https://github.com/highnet/swarm-arena/issues/40)) ([994b471](https://github.com/highnet/swarm-arena/commit/994b4713c6ffae69c9a17a78b2d0043b495e21f1))
* **chess:** PVS and late move reductions on top of killer + history quiet ordering (retry of [#87](https://github.com/highnet/swarm-arena/issues/87) with a consumer) ([#113](https://github.com/highnet/swarm-arena/issues/113)) ([07ec991](https://github.com/highnet/swarm-arena/commit/07ec991b7be47f7226af4783ecf492666262a357))
* **chess:** Quiescence search on captures and promotions (third submit, with the fixed merge-based harness) ([#58](https://github.com/highnet/swarm-arena/issues/58)) ([2b866e9](https://github.com/highnet/swarm-arena/commit/2b866e946936dcbf7a2f5060916ab09ce0a9aa16))
* **chess:** Self-generated endgame bitbases (KPK, KQK, KRK) solved by the engine's own retrograde analysis ([#124](https://github.com/highnet/swarm-arena/issues/124)) ([09630cf](https://github.com/highnet/swarm-arena/commit/09630cf5115197866ed8c6a6e7425b999edb2ac6))
* **chess:** Transposition table keyed by Zobrist hash: TT move ordering every node, bound cut-offs, mate-distance-safe scores ([#72](https://github.com/highnet/swarm-arena/issues/72)) ([5730745](https://github.com/highnet/swarm-arena/commit/5730745b7700eacf0a2abf176199928745b20f93))

## 0.1.0 (2026-11-23)


### Features

* **chess:** Wire shakmaty to the protocol and play legal moves ([136ccb7](https://github.com/highnet/swarm-arena/commit/136ccb757c0bfc7b70b093da18a5cc84be2d0f21))
