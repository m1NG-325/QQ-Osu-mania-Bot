# Bundled analysis engines

Source: https://github.com/LeoBlackMT/osumania_map_analyser (main downloaded 2026-10-02).
MIT, copyright Leo_Black. Files in js/ retain their upstream implementation.
Only parser, estimator, rework, patterns, ett and interlude modules are included;
no overlay UI, telemetry or remote services are loaded.

Sunny and Daniel JavaScript ports, Azusa, Companella model, pattern detection,
Interlude and MinaCalc WASM originate from that project. Attribution and upstream
links: https://github.com/LeoBlackMT/osumania_map_analyser#致谢

Etterna: https://github.com/etternagame/etterna (LICENSE-Etterna).
ONNX Runtime: https://github.com/microsoft/onnxruntime (LICENSE-ONNXRuntime).
onnxruntime-common 1.24.3 is the required npm dependency (its license is shipped
in node_modules/onnxruntime-common/LICENSE).

Our adapter isolates calculations in a Node worker and limits execution to 25 s.
Timeline categories use the original pattern detector on separate 15 s windows.
These are dominant-window time shares, not percentages of notes. They are not
the KNFX/XXY engine shown in the reference screenshots. Sunny strain has its own
scale. Companella reports a dan label, not an invented star conversion.
MSD uses MinaCalc 0.72.3 at a 93% score goal (non-4K follows upstream fallback).
Custom surface accuracy curves and XXY PP are not implemented.
