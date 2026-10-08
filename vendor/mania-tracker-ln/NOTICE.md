# ManiaTracker 4K LN modules

Source: https://github.com/aleju03/mania-hub
Pinned commit: 336d31641201286e09a126aaa8b0532ea2151e5a (retrieved 2026-10-08).
MIT, copyright 2026 aleju03; see LICENSE.

Only the dependency graph for effective LN identity, its workload/rating
tiebreak, feature extraction, low-band LN estimation, and structural vibro
detection is included. Original TypeScript is retained in source/.
js/ is generated using Node.js stripTypeScriptTypes with runtime relative
imports changed to .js extensions. No algorithm constants or formulas were
changed. No website UI, network clients, accounts, or images are included.

The bot adapter in src/four-ln.js supplies the existing local Sunny table
and MinaCalc engine. It uses MinaCalc 0.72.3 Overall for LN identity; the
existing RC/Companella path retains its separate 0.74.0 input. Chart rating,
score currency, and accuracy contribution are separate calculations.
