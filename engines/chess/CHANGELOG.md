# Changelog

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
