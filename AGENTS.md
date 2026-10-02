# Project Guidelines

## Project Overview

This repository contains **Infinite Procedural World**, a browser-based Three.js experience built with Vite. It streams procedural terrain around a moving airplane, selects chunk LOD by distance, and renders through a mix of CPU generation and patched Three.js shaders. Trees, cacti, and rocks are placed deterministically per biome and drawn as baked octahedral impostors, replaced by their real meshes near the camera, and cast soft cascaded shadows with the airplane. Carved-wood clouds float above the flight ceiling in a world-level field, drawn with the same impostor and near-mesh treatment (an atlas of frontal views only), turn their front face toward the airplane, and cast soft shadows on the land; boats remain disabled behind a feature flag.

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

Use Node.js `^20.19.0` or `>=22.12.0` and pnpm `9.15.9`.

```bash
pnpm install
pnpm dev
pnpm test
pnpm build
pnpm preview
```

Use pnpm for dependency changes and keep `package.json` with `pnpm-lock.yaml`. Do not introduce another lockfile or edit generated `dist/` output.

## Source Map

- [`main.js`](main.js) owns loading, shared parameters and uniforms, scene setup, shader precompilation, the render loop, and resize behavior; [`src/soundtrack.js`](src/soundtrack.js) owns the streamed background music and its volume.
- [`src/chunkManager.js`](src/chunkManager.js) owns chunk discovery, worker dispatch, stale-result rejection, LOD selection, and scene membership.
- [`src/chunkPolicy.js`](src/chunkPolicy.js) owns pure chunk keys, the heading-biased desired set and per-frame commit budget (`CHUNK_STREAMING`), the worker count, heading sectors, forward-shifted LOD, and the radial scenery range.
- [`src/chunkGeometry.js`](src/chunkGeometry.js) owns deterministic height sampling (including the per-biome desert topography blend) and the three-free terrain buffers shared by tests and workers; [`src/chunkTopology.js`](src/chunkTopology.js) owns the per-LOD shared index and uv attributes and the chunk `BufferGeometry` wrapping and disposal.
- [`src/chunkGeometry.worker.js`](src/chunkGeometry.worker.js) and [`src/chunkWorkerPool.js`](src/chunkWorkerPool.js) own off-main-thread terrain generation and bounded worker reuse.
- [`src/chunk.js`](src/chunk.js) owns the rendered terrain mesh, geometry replacement, shader injection, and its per-chunk scenery mesh.
- [`src/terrainNormals.js`](src/terrainNormals.js) owns the terrain normal-map textures, their assignment to the sea and the five elevation bands (`TERRAIN_NORMAL_LAYERS`), and the matching uniforms.
- [`src/worldSeed.js`](src/worldSeed.js) owns the pure `?seed=` parsing, GUI seed normalization, and the random fallback seed; `ChunkManager.setSeed()` applies a runtime seed change from the `?gui=1` **World** folder.
- [`src/biome.js`](src/biome.js) owns the seeded CPU twin of the shader biome field; [`src/sceneryPlacement.js`](src/sceneryPlacement.js) owns deterministic scenery placement, run in the chunk worker.
- [`src/impostors/`](src/impostors/) owns scenery and cloud source meshes (`impostorArchetypes.js`, `cloudArchetypes.js`), the impostor catalogs that adapt the shared pipeline to each family (`impostorCatalogs.js`), the octahedral atlas bake, the impostor materials, quad meshes, the two-level near meshes (`sceneryMeshes.js`, with pure fade and selection rules in [`src/sceneryMeshPolicy.js`](src/sceneryMeshPolicy.js)), and the per-LOD debug wireframe overlay (`sceneryWireframe.js`); [`src/curvedLights.js`](src/curvedLights.js) owns the curved-world light terminator chunk, its shadowed variant, and the unshadowed cloud variant with a scaled ambient light.
- [`src/sceneryShadows.js`](src/sceneryShadows.js) owns the soft scenery and airplane shadows: two light-aligned depth cascades, impostor and airplane casters, and the receiver uniforms; [`src/shadowPolicy.js`](src/shadowPolicy.js) owns the pure light selection, cascade bounds, snapping, scheduling, and defaults.
- [`src/plane.js`](src/plane.js) owns movement, input, camera follow, acceleration effects, trails, and the shader-driven propeller rotation; [`src/propellerMask.js`](src/propellerMask.js) owns the pure selection of the propeller's UV charts in the fused airplane mesh; [`src/airplaneModels.js`](src/airplaneModels.js) owns the per-model data (path, load transform, trail anchor, propeller axis, threshold, plugs) and the `?plane=` choice.
- [`src/flightPauseDebug.js`](src/flightPauseDebug.js) owns the `?debug=1` flight pause (P key) and its orbit camera; [`src/debugPolicy.js`](src/debugPolicy.js) owns the pure debug-flag and shortcut rules.
- [`src/flightPolicy.js`](src/flightPolicy.js) owns pure speed, vertical-input, terrain-clearance, and altitude-limit rules.
- [`src/dayNight.js`](src/dayNight.js) owns the sky dome and applies time of day to lights, fog, and `uAtmosphere`; [`src/dayNightPolicy.js`](src/dayNightPolicy.js) owns the pure keyframes and their editable copies, celestial directions, curved-horizon dip and palette time (and its inverse), and `?time=` parsing; [`src/radialFog.js`](src/radialFog.js) makes Three.js fog radial.
- [`src/postProcessing.js`](src/postProcessing.js) owns the `postprocessing` composer that renders every frame (the only antialiasing), the idle edge-effect level, and the film grain; [`src/speedEffect.js`](src/speedEffect.js) owns the acceleration blur pyramid and chromatic aberration.
- [`src/clouds.js`](src/clouds.js) owns the world-level cloud field (impostor mesh, cloud atlas, near cloud meshes); [`src/cloudPlacement.js`](src/cloudPlacement.js) owns its pure deterministic placement; [`src/cloudShadows.js`](src/cloudShadows.js) owns the blurred cloud shadow coverage map and its receiver uniforms, with pure rules in `shadowPolicy.js`.
- [`src/shaders/`](src/shaders/) contains GLSL inserted into Three.js built-in materials through `onBeforeCompile`.
- [`index.html`](index.html) and [`style.css`](style.css) own the small Tailwind-based interface shell.
- [`public/`](public/) and [`src/audio/`](src/audio/) contain runtime assets, including the toy airplane (`public/plane-toy/`); model license files must remain with their assets. Art-direction references live in [`docs/style-references/`](docs/style-references/) and are not shipped.

## Project Rules

- Preserve the existing ES-module and class-based ownership boundaries unless the task explicitly changes the architecture.
- Keep terrain calculations in world coordinates so neighboring chunks agree at their edges.
- Treat CPU geometry and GLSL as one contract. The custom `height` attribute, shared uniforms, Three.js include names, and update order must stay synchronized.
- Remember that `ChunkManager` currently tracks the `Plane` even though its constructor field and coordinate helper use camera terminology.
- Reuse values in frame-sensitive code and avoid adding synchronous bulk work to the animation loop without profiling.
- Keep DOM IDs synchronized between `index.html` and `main.js`, and keep audio playback behind a user interaction.
- Preserve the CC BY 4.0 attribution files for the former airplane and the boat. The player models are now `public/plane-toy/plane-toy-2.glb` (default biplane) and `plane-toy.glb` (`?plane=toy`), whose provenance is not yet recorded. Do not assume the project MIT license covers third-party assets.
- Do not silently resolve unrelated known gaps while completing a focused task. Document intentional architectural changes in the same change.
- Follow the documentation-sync workflow when commands, ownership, runtime behavior, shader contracts, assets, validation requirements, or any other documented contract change.

If documentation disagrees with current source or package metadata, treat the implementation as the immediate source of truth and correct the documentation as part of the task.

## Validation Baseline

The repository uses Node's built-in test runner for pure chunk-policy, flight-policy, debug-policy, day/night-policy, shadow-policy, propeller-mask, airplane-model, world-seed, biome, octahedral-mapping, scenery-placement, cloud-placement, cloud-source, near-scenery-mesh, and terrain-buffer coverage. It has no linting, type checking, formatter, browser automation, or CI. For every source, shader, configuration, dependency, or asset change:

1. Run `pnpm test`.
2. Run `pnpm build`.
3. Load the app and check browser console and network failures.
4. Perform the change-specific desktop and mobile checks in [`docs/QUALITY.md`](docs/QUALITY.md).

A successful build does not prove that WebGL shaders compile or that the canvas renders correctly. Report any check that could not be performed.
