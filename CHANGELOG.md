# Changelog

## [0.2.0](https://github.com/highnet/swarm-arena/compare/platform-v0.1.0...platform-v0.2.0) (2026-11-23)


### Features

* 3D parallax board scene, live hero, message board, password-gated writes ([b206f67](https://github.com/highnet/swarm-arena/commit/b206f67f1140881457a4c88f0dc76f6ca6a516f1))
* engine logos and cards, skill pages, Lucide icons, engine limits ([259a99e](https://github.com/highnet/swarm-arena/commit/259a99e779758ddd7ad26443583f9682eed85083))
* play the engines, read their code, Rallypoint and release-please ([50f5462](https://github.com/highnet/swarm-arena/commit/50f54621a39318e461af1ddecd33ade36f12ec76))
* run the swarm unattended through a conductor, with a loop prompt builder ([#5](https://github.com/highnet/swarm-arena/issues/5)) ([be48f74](https://github.com/highnet/swarm-arena/commit/be48f744111eed013c543bb152d9945d980768cc))
* task pages with live progress, task types, Elo on every version ([c9d4d8d](https://github.com/highnet/swarm-arena/commit/c9d4d8de191653c0877b187c6d07cae56d27184b))
* the swarm runs through Rallypoint ([794a42b](https://github.com/highnet/swarm-arena/commit/794a42bf5792bac502048cd974c032c28de063d5))
* **web:** every page updates live from Supabase Realtime ([#9](https://github.com/highnet/swarm-arena/issues/9)) ([9878afb](https://github.com/highnet/swarm-arena/commit/9878afbf7e2f6909e397782ac5e2c42e2a8d9937))
* **web:** fleet shows only agents working right now ([683b814](https://github.com/highnet/swarm-arena/commit/683b81434f73f883aeb182bed6145eb9b630c00d))
* **web:** make fleet cards clickable, opening a page per agent ([#15](https://github.com/highnet/swarm-arena/issues/15)) ([d8565b3](https://github.com/highnet/swarm-arena/commit/d8565b39c7087d80122e809e3010b8a432369daf))
* **web:** Rallypoint, fleet, protocol and concepts pages; simpler copy; faster scene ([b0bd470](https://github.com/highnet/swarm-arena/commit/b0bd470ff4376012d652371ef613b75666ebc9ed))


### Bug Fixes

* **ci:** a release-please failure no longer skips the maintenance ref sweep ([#25](https://github.com/highnet/swarm-arena/issues/25)) ([32b2992](https://github.com/highnet/swarm-arena/commit/32b2992f159aae926d03d5dd6285d841cb9dc9a6))
* **ci:** maintenance sweep no longer fails when the last claim's issue is open ([#19](https://github.com/highnet/swarm-arena/issues/19)) ([26ec3b7](https://github.com/highnet/swarm-arena/commit/26ec3b78afceb52231c7b3bec08534c49b6760fd))
* **conductor:** dispatch prompts open with words, not a slash command ([#11](https://github.com/highnet/swarm-arena/issues/11)) ([c8583c0](https://github.com/highnet/swarm-arena/commit/c8583c076b5b8fa25671ae3d0fd3e836010296e8))
* list issues through the REST transport with comments and pagination ([#8](https://github.com/highnet/swarm-arena/issues/8)) ([3acba1f](https://github.com/highnet/swarm-arena/commit/3acba1f23c8237c630978e47b12f807bb06a6451))
* **rallypoint:** leases written over the REST transport read as live, not unknown ([#16](https://github.com/highnet/swarm-arena/issues/16)) ([83f3e0e](https://github.com/highnet/swarm-arena/commit/83f3e0e4d0d8517d84f920df8f9b9373b53dabf7))
* **rallypoint:** run the loop in cloud sessions over the REST transport ([3397e9e](https://github.com/highnet/swarm-arena/commit/3397e9ec3367e8e3bfc5f7e1c9d6d3629c8908c7))


### Performance Improvements

* install reference engines in seconds, not minutes ([706576a](https://github.com/highnet/swarm-arena/commit/706576ab17656fed707012824815f524d755ed7a))
* one-step agent setup with warm builds and cached main binaries ([36c9754](https://github.com/highnet/swarm-arena/commit/36c97547dbd57b4adb40ba332f9d3f61e7e93c98))
