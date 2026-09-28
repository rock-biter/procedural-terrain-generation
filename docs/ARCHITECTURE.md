# Architecture

## Purpose

This document maps runtime ownership and data flow. Read it before moving behavior between modules or changing application startup. Terrain algorithms are detailed in [Terrain](TERRAIN.md), while Three.js material and shader contracts are detailed in [Rendering](RENDERING.md).

## Runtime Map

| Area                  | Owner                                                                                                                  | Responsibility                                                                                           |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| HTML shell            | [`index.html`](../index.html)                                                                                          | Loader, play action, sound toggle, and module entry point.                                               |
| Application bootstrap | [`main.js`](../main.js)                                                                                                | Asset loading, shared parameters and uniforms, scene setup, frame loop, and resize handling.             |
| World streaming       | [`src/chunkManager.js`](../src/chunkManager.js)                                                                        | Reconciles chunks, dispatches keyed worker jobs, validates results, and owns scene membership.           |
| Streaming policy      | [`src/chunkPolicy.js`](../src/chunkPolicy.js)                                                                          | Computes chunk keys, symmetric desired sets, and distance-based LOD without browser state.               |
| Terrain generation    | [`src/chunkGeometry.js`](../src/chunkGeometry.js)                                                                      | Defines seeded height sampling and creates transferable position, normal, UV, height, and index buffers. |
| Worker execution      | [`src/chunkGeometry.worker.js`](../src/chunkGeometry.worker.js), [`src/chunkWorkerPool.js`](../src/chunkWorkerPool.js) | Reuses a bounded module-worker pool and transfers generated buffers to the main thread.                  |
| Terrain unit          | [`src/chunk.js`](../src/chunk.js)                                                                                      | Owns one rendered mesh, replaces/disposes geometry, injects shaders, and places decorations.             |
| Player movement       | [`src/plane.js`](../src/plane.js)                                                                                      | Owns flight input, speed changes, camera attachment, and trail rendering.                                |
| Flight policy         | [`src/flightPolicy.js`](../src/flightPolicy.js)                                                                        | Computes speed effects, vertical input, terrain clearance, safety-climb speed, and altitude limits.      |
| Post-processing       | [`src/postProcessing.js`](../src/postProcessing.js), [`src/speedEffect.js`](../src/speedEffect.js)                     | Owns the effect composer, idle bypass, and the acceleration blur and chromatic aberration.               |
| Instanced scenery     | [`src/trees.js`](../src/trees.js), [`src/clouds.js`](../src/clouds.js)                                                 | Build instanced meshes and patch their materials when their feature flags are enabled.                   |
| Shader source         | [`src/shaders/`](../src/shaders/)                                                                                      | Supplies GLSL replacements for Three.js shader chunks.                                                   |

## Startup Sequence

Importing `main.js` performs the following work:

1. Resolve the loader, progress, play, and sound-toggle elements from `index.html`.
2. Create the shared `assets`, `params`, and `uniforms` objects.
3. Start loading the soundtrack and airplane model through a shared `THREE.LoadingManager`. The terrain normal map loads independently from `src/chunk.js`; tree and boat asset requests are skipped while their feature flags are disabled.
4. Create the scene, camera, renderer, post-processing pipeline, lights, fog, and timer while those asynchronous requests are in flight.
5. When the loading manager completes, fade out the loader and call `init(assets)`.
6. `init()` creates `Plane` and `ChunkManager`, gives the plane a world-height sampler backed by the manager's seeded terrain noise, places the plane and its world-space trail mesh in the scene, and schedules `tic()`.
7. The play action starts audio, accelerates the plane, moves the camera backward, and enables the flight effect.

Rendering begins after assets load, before the user presses the play action. The play action starts movement and audio; it is not the application bootstrap.

## Frame Loop

`tic(timestamp)` is the only animation-frame loop:

1. Update `THREE.Timer` and clamp the movement delta to at most `0.016` seconds.
2. Call `plane.update(deltaTime)`.
3. Write elapsed time and plane position to `uTime` and `uCamera`.
4. Call `chunkManager.updateChunks()` to reconcile on boundary changes or process bounded keyed work.
5. Pass `uAcceleration` to `postProcessing.setSpeedEffect()`, render through `postProcessing.render(deltaTime)`, and schedule the next frame.

Keep frame-sensitive behavior in this order unless a change explicitly depends on a different update sequence.

## Shared State And Ownership

- `params` in `main.js` is the mutable source for terrain generation, colors, fog, light intensity, post-processing, and the optional debug GUI.
- `worldSeed` comes from `?seed=<value>` or a random per-load fallback. The same value seeds main-thread height queries and every worker.
- `worldFeatures` in `main.js` is the frozen runtime switch for trees, clouds, and boats. All three are currently `false` so chunk work is terrain-only.
- `uniforms` in `main.js` is shared with chunks, instanced scenery, and boat materials. `Chunk` adds `uCurvature` to that object.
- The perspective camera becomes a child of `Plane` through `Plane.addCamera()`.
- `Plane` owns and updates the trail geometry, but the trail mesh is a direct scene child so older sections remain in world space as the plane moves.
- The constructor parameter named `camera` in `ChunkManager` is currently the `Plane`. `getCoordsByCamera()` therefore reads the moving plane's world position.
- Loaded startup assets are collected before `init()`. `Plane` requires the airplane mesh; the tree normal map and boat model are loaded only when their corresponding feature is enabled.
- `ChunkManager` owns `Map` registries for desired, live, pending, and in-flight chunks. A monotonically increasing revision invalidates obsolete work before any worker result becomes a Three.js object.
- The worker pool uses up to two workers on desktop and one on mobile. Workers cache their seeded simplex functions and transfer typed-array buffers instead of cloning them.
- `ChunkManager` owns chunk membership in the scene. Each `Chunk` owns its terrain geometry and local decorations.

`window.__INFINITE_WORLD__.getChunkStats()` exposes read-only desired/live/queue/in-flight, lifecycle, worker-result, worker-count, revision, and seed diagnostics. `getFlightStats()` exposes position, speed effect, pointer input, vertical velocity, camera state, and the current terrain corridor. `getPostProcessingStats()` exposes whether the effect pass is active, the speed-effect intensity, and the MSAA sample count. None of these APIs exposes mutable runtime state.

Do not create a second render loop, terrain-parameter store, or chunk registry without an architectural reason documented here.

## Data Flow

```text
DOM and asset requests
        |
        v
main.js: LoadingManager -> init(assets)
        |                    |
        |                    +-> Plane -> flightPolicy, camera, controls, trails
        |                    |
        |                    +-> ChunkManager -> worker pool
        |                           |                |
        |                           |                +-> transferable geometry buffers
        |                           v
        |                       Chunk instances -> optional scenery
        v
tic() -> shared uniforms -> material shader hooks -> PostProcessing -> WebGLRenderer
```

Terrain CPU calculations and terrain GLSL both consume related world data. When changing height, curvature, or water behavior, verify the CPU geometry path and every affected shader path together.

## Extension Boundaries

- Add world-streaming policy to `ChunkManager`, not `main.js`.
- Add per-chunk generation or decoration rules to `Chunk` or a dedicated helper extracted from it.
- Add runtime player input, camera-follow, or trail behavior to `Plane`; keep independently testable scalar flight rules in `flightPolicy.js`.
- Add shared scene lifecycle behavior to `main.js` only when no narrower owner exists.
- Keep material-specific GLSL in `src/shaders/` and document new replacement points in [Rendering](RENDERING.md).
- Add fullscreen passes and effects to `PostProcessing`, not to the frame loop in `main.js`.
- Keep DOM behavior synchronized between `index.html` and `main.js`; see [Experience](EXPERIENCE.md).

## Known Architectural Gaps

- There is no teardown path for animation frames, event listeners, audio, or the renderer.
- Debug GUI code is mixed into `main.js` and only enabled with `?gui=1`.
- `main.js` imports disabled control implementations and debug dependencies.
- Shared module-level materials rely on mutable `onBeforeCompile` callbacks.
- The URL seed is deterministic but is not persisted when omitted; there is no broader session state.

Treat these as descriptions of the current system, not permission to broaden unrelated tasks.

## Open Questions

- Should runtime constants and responsive policy move to a dedicated configuration module?
- Should asset loading become a separate service with explicit failure states?
- Should the tracked-object terminology in `ChunkManager` replace the current camera naming?
- What teardown lifecycle is required if the experience is embedded in a larger application?
