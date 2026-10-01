# Development Guide

## Purpose

This document is the operational reference for installing, running, and changing the project. For system ownership and runtime flow, see [Architecture](ARCHITECTURE.md).

## Prerequisites

- Node.js `^20.19.0` or `>=22.12.0`.
- pnpm `9.15.9`, as declared by the `packageManager` field in `package.json`.
- A browser with WebGL support.

Use pnpm for dependency changes. Do not introduce a second lockfile.

## Commands

```bash
pnpm install
pnpm dev
pnpm test
pnpm build
pnpm preview
pnpm texture:wood
```

- `pnpm dev` starts Vite with network access through `--host`.
- `pnpm test` runs the dependency-free Node test suite.
- `pnpm build` creates the production bundle in `dist/`.
- `pnpm preview` serves the production bundle locally.
- `pnpm texture:wood` regenerates `src/textures/wood-grain.png`. It is deterministic and has no dependencies. Commit the regenerated image. The runtime no longer imports it; impostors and near scenery meshes use `white_oak_veneer_diff_1k.jpg` (see [Assets](ASSETS.md#textures)).
- Use the URL printed by Vite; the default port may change when it is already occupied.

Do not edit or commit generated files under `dist/`.

## Current Toolchain

- Vite builds the ES-module application.
- `vite-plugin-glsl` makes GLSL files importable by JavaScript.
- `postprocessing` (pmndrs) provides the effect composer; its `three` peer range must include the installed Three.js version.
- Tailwind CSS is processed through `@tailwindcss/postcss`.
- The application is plain JavaScript. There is no TypeScript compilation step.
- Node's built-in test runner covers pure chunk-policy, flight-policy, day/night-policy, trail-history, biome, octahedral-mapping, scenery-placement, near-scenery-mesh selection, and deterministic terrain-buffer behavior under `test/`.
- Vite bundles `src/chunkGeometry.worker.js` as a module worker; no separate worker build command is required.
- The repository currently has no formatter, linter, browser test suite, or CI workflow.

See [Quality](QUALITY.md) for the browser and rendering validation that remains outside the pure Node tests.

## Code Conventions

Follow the patterns in the code being changed rather than introducing a parallel style.

- Use ES modules and preserve the existing default-export class boundaries.
- Use tabs in JavaScript files and omit semicolons.
- Keep Three.js object ownership explicit. The bootstrap belongs in `main.js`; terrain lifecycle belongs in `ChunkManager` and `Chunk`; runtime flight behavior belongs in `Plane`, while scalar flight rules belong in `flightPolicy.js`.
- Keep worker messages structured-cloneable. Transfer generated typed-array buffers, and create or mutate renderer-owned objects only on the main thread.
- Reuse vectors and matrices in frame-sensitive code where the surrounding module already does so. Avoid allocations inside the render loop without measuring their cost.
- Uniform names use a `u` prefix, such as `uTime` and `uCamera`.
- Keep shader source in `src/shaders/`; do not embed large GLSL strings in JavaScript.
- Modules imported by Node tests must use explicit `.js` extensions on their relative imports, as in `src/sceneryPlacement.js`, because Node ESM does not resolve extensionless paths the way Vite does.
- Preserve responsive behavior at the existing `768px` JavaScript breakpoint unless a task intentionally redesigns it.
- Add comments only for constraints or non-obvious behavior.

## Change Workflow

1. Read the topic guide linked from the root `AGENTS.md` and the owning source module.
2. Make the smallest change that preserves existing ownership boundaries.
3. Run `pnpm test` and `pnpm build` after every source, shader, dependency, or configuration change.
4. Perform the change-specific checks in [Quality](QUALITY.md).
5. Update the relevant guide when behavior, commands, architecture, or asset requirements change.

When updating dependencies, keep `package.json` and `pnpm-lock.yaml` in sync and review upstream migration notes for Three.js, `postprocessing`, Vite, Tailwind CSS, and `vite-plugin-glsl`.

## Debugging Notes

- The scene starts rendering only after the loading manager completes and `init()` schedules the first animation frame.
- Browser console errors and failed network requests are the first checks when the page remains on the loader.
- Shader compilation failures appear in the browser console, not necessarily during `pnpm build`.
- The optional `lil-gui` setup in `main.js` is enabled only with `?gui=1`. Every folder starts closed. The **Terrain** folder holds the biome colors and the height-generation parameters, plus **Color noise** (**Frequency**, **Intensity**, **Threshold**, **Softness**, and drift **Speed** of soft lighter patches on land, applied live), **Desert topography** (desert detail-octave frequency and amplitude multipliers, the blend width, and the progressive **Height reduction** with its **Reduction depth** in biome-noise units; releasing a control regenerates the chunks) and **Normal maps**, with one folder per layer (sea, sand, grass, land, rocks, snow, each labelled with its texture) that sets **Tile size (units)**, **Strength**, and **Rotation (°)** live; **Fade start (units)** and **Fade end (units)** set the distance range where all normal maps fade out. The **Lights** folder holds the peak sun, moon, and ambient intensities. The other folders are day/night, sky, tone mapping, film grain, speed effect, scenery, and trails. The **Day/night** folder scrubs **Time of day** (live-updating), changes **Cycle duration (s)**, and **Paused** freezes the cycle (live-updating); the **Sky** folder sets the sky **Gradient height (rad)** and the radial **Fog near** and **Fog far**, live. **Sky > Palette** has one folder per day/night keyframe (named with its time, for example **Sunset (0.72)**) with the zenith, horizon/fog, atmosphere, sun, moon, ambient, and trail-tint colors and the sun, moon, and ambient intensities and star visibility, all applied live. Each keyframe's **Preview** pauses the cycle where that keyframe applies unblended; **Copy palette JSON** logs the palette and copies it to the clipboard for pasting into `dayNightPolicy.js`, and **Reset palette** restores the defaults; the **Speed effect > speedEffect** slider applies a camera FOV kick and holds the blur and chromatic aberration at the matching boost intensity (also during the debug pause), the **Speed effect > preview** slider holds the post-processing at a raw minimum intensity while tuning, **Speed effect > Idle level** sets the speed effect whose edge blur and aberration stay visible without a boost (`0.3` by default, `0` restores the idle bypass; the FOV kick is unaffected), and **Vertical scale** weakens both toward the top and bottom edges without changing them horizontally. The **Scenery** folder sets the grid cell, the instance cap per chunk, and, under **Trees**, **Cacti**, and **Rocks**, a density per category and a size per type. Changes apply when a control is released and re-place scenery without rebuilding terrain. The same folders hold a brightness **variation** per type and a shared **Variation frequency**. **Scenery > Wood detail** sets the wood texture **Repeats per unit** and **Color strength** (`0` vertex color only, `1` vertex color × texture); releasing a control re-bakes the impostor atlas and updates the near meshes. These are shader uniforms and update live. **Scenery > Near meshes** toggles the real meshes (**Enabled**) and sets two bands, measured from the eye. **Full detail until (units)** and **Reduced detail from (units)** set the LOD 0 to LOD 1 hand-over. **Mesh until (units)** and **Impostor from (units)** set the LOD 1 to impostor hand-over. Changes apply live; while disabled, impostors render at every distance. The **Tone mapping** folder selects the renderer **Mode** (None, Linear, Reinhard, Cineon, ACES Filmic, AgX, Neutral) and sets **Exposure**; both apply live, including while the speed effect is active. The **Film grain** folder sets the static grain **Intensity** (`0` disables it). The **Airplane** folder sets **Propeller speed (turns/s)** live. The **Trails** folder changes ribbon width, line and black-border thickness, separate frequency and amplitude for the inner and outer edges, and frequency and amplitude of the stripe oscillation. With the GUI enabled, the play action does not start the soundtrack.
- `?time=<0..1>` sets the starting time of day (`0` midnight, `0.25` sunrise, `0.5` noon, `0.75` sunset); invalid or out-of-range values fall back to `0.3`. Combine it with `?seed=` for reproducible visual checks.
- `?plane=<key>` picks the airplane model from `AIRPLANE_MODELS` in `src/airplaneModels.js`: `biplane` (default) or `toy`; unknown keys use the default.
- `?debug=1` enables the terrain-sample markers and the flight pause. After the play intro, **P** freezes the airplane while global time keeps running and switches the camera to `OrbitControls`. See [Experience](EXPERIENCE.md#debug-flight-pause). `window.__INFINITE_WORLD__.getDebugStats()` reports the pause state.

## Open Questions

- Decide whether to adopt a formatter and linter before documenting stricter style rules.
- Decide which browser and device matrix should become the supported baseline.
- Decide whether dependency updates require visual snapshots or performance measurements.
