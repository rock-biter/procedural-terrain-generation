# Project Guidelines

## Project Overview

This repository contains **Infinite Procedural World**, a browser-based Three.js experience built with Vite. It streams procedural terrain around a moving airplane, selects chunk LOD by distance, and renders through a mix of CPU generation and patched Three.js shaders. Trees, cacti, and rocks are placed deterministically per biome and drawn as baked octahedral impostors (tree crowns take colors from noise-distributed palettes), replaced by their real meshes near the camera, and cast soft cascaded shadows with the airplane. Carved-wood clouds float above the flight ceiling in a world-level field, drawn with the same impostor and near-mesh treatment (an atlas of frontal views only), turn their front face toward the airplane, and cast soft shadows on the land; boats remain disabled behind a feature flag.

[`README.md`](README.md) is the short human-facing introduction. This file is the entry point for coding agents and routes detailed work to the owning guide.

## Read The Relevant Guide

| Task                                                                                | Guide                                          |
| ----------------------------------------------------------------------------------- | ---------------------------------------------- |
| Install, commands, dependencies, source conventions, or debugging                   | [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)   |
| Bootstrap, frame loop, module ownership, or cross-system changes                    | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| Noise, height generation, chunks, LOD, pooling, biomes, scenery, clouds, or boats   | [`docs/TERRAIN.md`](docs/TERRAIN.md)           |
| Three.js materials, uniforms, GLSL, impostors, curvature, fog, or post-processing   | [`docs/RENDERING.md`](docs/RENDERING.md)       |
| Loader, play flow, controls, camera, audio, DOM, or responsive behavior             | [`docs/EXPERIENCE.md`](docs/EXPERIENCE.md)     |
| Models, textures, audio files, loading transforms, or licensing                     | [`docs/ASSETS.md`](docs/ASSETS.md)             |
| Build expectations, browser checks, manual QA, or future test automation            | [`docs/QUALITY.md`](docs/QUALITY.md)           |
| Technical debt, performance analysis, implementation sequencing, or future features | [`docs/ROADMAP.md`](docs/ROADMAP.md)           |

Read the owning source file and the relevant guide before editing. When a change crosses boundaries, read each affected guide rather than relying on this summary.

## Documentation Sync

Every task that modifies workspace files must use the [`documentation-sync` skill](.github/skills/documentation-sync/SKILL.md) after implementation and before final validation. A task is not complete until the agent has reviewed the documentation impact, updated every affected guide, and reported which documentation changed or why no documentation update was necessary.

## Essential Commands

Use Node.js `^20.19.0` or `>=22.13.0` (ESLint 10's minimum) and pnpm `9.15.9`.

```bash
pnpm install
pnpm dev
pnpm test
pnpm lint
pnpm format
pnpm build
pnpm preview
pnpm assets:encode
pnpm bench
```

Use pnpm for dependency changes and keep `package.json` with `pnpm-lock.yaml`. Do not introduce another lockfile or edit generated `dist/` output.

## Source Map

The full module map, grouped by area with each owner's responsibility, is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#runtime-map). In short:

- [`main.js`](main.js) is a thin bootstrap; [`src/world.js`](src/world.js) owns the frame loop and builds the world systems; [`src/renderSetup.js`](src/renderSetup.js), [`src/assetLoader.js`](src/assetLoader.js), and [`src/intro.js`](src/intro.js) own the renderer, the startup assets, and the DOM flow; [`src/appParams.js`](src/appParams.js) and [`src/sharedUniforms.js`](src/sharedUniforms.js) create the shared state; the `?gui=1` panel is [`src/debug/debugGui.js`](src/debug/debugGui.js).
- Terrain streaming, generation, biomes, bands, and placement live in `src/chunk*.js`, [`src/terrainBands.js`](src/terrainBands.js), [`src/biome.js`](src/biome.js), [`src/sceneryPlacement.js`](src/sceneryPlacement.js), and [`src/cloudPlacement.js`](src/cloudPlacement.js); the airplane in [`src/plane.js`](src/plane.js) and the parts it composes; rendering systems in [`src/impostors/`](src/impostors/), the shadow, cloud, day/night, and post-processing modules, and [`src/shaders/`](src/shaders/), always patched through `replaceChunks()` ([`src/shaderChunks.js`](src/shaderChunks.js)).
- _Pure_ modules (policies, placement, terrain buffers, [`src/math.js`](src/math.js), [`src/random.js`](src/random.js), [`src/noise.js`](src/noise.js)) import no three.js objects or browser state; the Node tests and the chunk workers import them.
- [`public/`](public/), [`src/textures/`](src/textures/), and [`src/audio/`](src/audio/) contain runtime assets; model license files must remain with their assets. Textures and the airplane GLBs are encoded (KTX2, meshopt), and the airplanes' simplified shadow casters generated, from the masters in [`assets-src/`](assets-src/) by [`scripts/encode-assets.mjs`](scripts/encode-assets.mjs) (`pnpm assets:encode`). [`scripts/bench.mjs`](scripts/bench.mjs) (`pnpm bench`) compares builds with a deterministic headless-Chrome flight. Art-direction references live in [`docs/style-references/`](docs/style-references/) and are not shipped.

## Project Rules

- Preserve the existing ES-module and class-based ownership boundaries unless the task explicitly changes the architecture.
- Keep terrain calculations in world coordinates so neighboring chunks agree at their edges.
- Treat CPU geometry and GLSL as one contract. The custom `height` attribute, shared uniforms, Three.js include names, and update order must stay synchronized; terrain band and biome constants come from `src/terrainBands.js` alone.
- Remember that `ChunkManager` currently tracks the `Plane` even though its constructor field and coordinate helper use camera terminology.
- Reuse values in frame-sensitive code and avoid adding synchronous bulk work to the animation loop without profiling.
- Keep DOM IDs synchronized between `index.html`, `main.js`, and `src/intro.js`, and keep audio playback behind a user interaction.
- Preserve the CC BY 4.0 attribution files for the former airplane and the boat. The player models are now `public/plane-toy/plane-toy-2.glb` (default biplane) and `plane-toy.glb` (`?plane=toy`), whose provenance is not yet recorded. Do not assume the project MIT license covers third-party assets.
- Do not silently resolve unrelated known gaps while completing a focused task. Document intentional architectural changes in the same change.
- Follow the documentation-sync workflow when commands, ownership, runtime behavior, shader contracts, assets, validation requirements, or any other documented contract change.

If documentation disagrees with current source or package metadata, treat the implementation as the immediate source of truth and correct the documentation as part of the task.

## Validation Baseline

The repository uses Node's built-in test runner (`test/*.test.js`; the list of suites is in [`docs/QUALITY.md`](docs/QUALITY.md)), with a hook in `test/support/` that lets tests import Vite-style modules. ESLint (`pnpm lint`) and Prettier (`pnpm format`, `pnpm format:check`) check the code, and GitHub Actions runs lint, formatting, tests, and the build on every push and pull request; there is no type checking or browser automation. For every source, shader, configuration, dependency, or asset change:

1. Run `pnpm lint`, `pnpm format:check`, and `pnpm test`.
2. Run `pnpm build`.
3. Load the app and check browser console and network failures.
4. Perform the change-specific desktop and mobile checks in [`docs/QUALITY.md`](docs/QUALITY.md).

A successful build does not prove that WebGL shaders compile or that the canvas renders correctly. Report any check that could not be performed.
