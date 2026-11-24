# Changelog

## [0.2.0](https://github.com/highnet/swarm-arena/compare/go9-engine-v0.1.0...go9-engine-v0.2.0) (2026-11-24)


### Features

* **go9:** MCTS (UCT) with random eye-respecting playouts on a fast flat board ([#77](https://github.com/highnet/swarm-arena/issues/77)) ([a6d7e5d](https://github.com/highnet/swarm-arena/commit/a6d7e5de51910876005ae9cf77e546374d122cc5))
* **go9:** RAVE (AMAF) blended into UCT, ported from Hex v0.3 ([#93](https://github.com/highnet/swarm-arena/issues/93)) ([68e8ed2](https://github.com/highnet/swarm-arena/commit/68e8ed28b2e26209d48d0d29eb4d78e5a8cdaf97))
* **go9:** Tactical playout policy: capture or escape atari near the last move, and refuse self-atari, ported from Hex's bridge-preserving fill-in ([#117](https://github.com/highnet/swarm-arena/issues/117)) ([115fb16](https://github.com/highnet/swarm-arena/commit/115fb1607b4d0a138df5929f3f8005dd2f8b87f7))

## 0.1.0 (2026-11-23)


### Features

* **go9:** Wire goban to the protocol and play legal moves ([b576d99](https://github.com/highnet/swarm-arena/commit/b576d99f8377d915cee38b50856068f9ae4b4b3b))
