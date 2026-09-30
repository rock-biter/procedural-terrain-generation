# Architecture

## Purpose

This document maps runtime ownership and data flow. Read it before moving behavior between modules or changing application startup. Terrain algorithms are detailed in [Terrain](TERRAIN.md), while Three.js material and shader contracts are detailed in [Rendering](RENDERING.md).

## Runtime Map

| Area                  | Owner                                                                                                                  | Responsibility                                                                                           |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| HTML shell            | [`index.html`](../index.html)                                                                                          | Loader, play action, sound toggle, and module entry point.                                               |
| Application bootstrap | [`main.js`](../main.js)                                                                                                | Asset loading, shared parameters and uniforms, scene setup, frame loop, and resize handling.             |
| World streaming       | [`src/chunkManager.js`](../src/chunkManager.js)                                                                        | Reconciles chunks, dispatches keyed worker jobs, validates results, and owns scene membership.           |
| Streaming policy      | [`src/chunkPolicy.js`](../src/chunkPolicy.js)                                                                          | Computes chunk keys, symmetric desired sets, distance-based LOD, and the scenery LOD rule without browser state. |
| Terrain generation    | [`src/chunkGeometry.js`](../src/chunkGeometry.js)                                                                      | Defines seeded height sampling and creates transferable position, normal, UV, height, and index buffers. |
| Worker execution      | [`src/chunkGeometry.worker.js`](../src/chunkGeometry.worker.js), [`src/chunkWorkerPool.js`](../src/chunkWorkerPool.js) | Reuses a bounded module-worker pool and transfers generated terrain and scenery buffers to the main thread. |
| Biome field           | [`src/biome.js`](../src/biome.js)                                                                                      | Seeded CPU twin of the shader biome selector (`uBiomeOffset`).                                           |
| Scenery placement     | [`src/sceneryPlacement.js`](../src/sceneryPlacement.js)                                                                | Deterministic per-chunk tree, cactus, and rock instances, run in the worker.                             |
| Terrain unit          | [`src/chunk.js`](../src/chunk.js)                                                                                      | Owns one rendered mesh, replaces/disposes geometry, injects shaders, owns its scenery mesh, and places dormant clouds and boats. |
| Player movement       | [`src/plane.js`](../src/plane.js)                                                                                      | Owns flight input, speed changes, camera attachment, and trail rendering.                                |
| Debug flight pause    | [`src/flightPauseDebug.js`](../src/flightPauseDebug.js), [`src/debugPolicy.js`](../src/debugPolicy.js)                 | With `?debug=1`, toggles a flight-only pause on **P** and hands the camera to `OrbitControls`.            |
| Flight policy         | [`src/flightPolicy.js`](../src/flightPolicy.js)                                                                        | Computes speed effects, vertical input, terrain clearance, safety-climb speed, and altitude limits.      |
| Day/night cycle       | [`src/dayNight.js`](../src/dayNight.js), [`src/dayNightPolicy.js`](../src/dayNightPolicy.js)                             | Advances time of day, owns the sky dome, and drives lights, fog, and atmosphere from pure keyframe data. |
| Post-processing       | [`src/postProcessing.js`](../src/postProcessing.js), [`src/speedEffect.js`](../src/speedEffect.js)                     | Owns the effect composer, idle bypass, the acceleration blur and chromatic aberration, and the static film-grain overlay.               |
| Impostor scenery      | [`src/impostors/`](../src/impostors/)                                                                                  | Builds scenery sources from primitives, bakes the octahedral atlas, and provides the shared impostor material and per-chunk quad mesh. |
| Dormant clouds        | [`src/clouds.js`](../src/clouds.js)                                                                                    | Builds an instanced cloud mesh when its feature flag is enabled.                                         |
| Curved lighting       | [`src/curvedLights.js`](../src/curvedLights.js)                                                                        | Builds the `lights_fragment_begin` copy with the curved-world terminator shared by terrain and scenery.  |
| Shader source         | [`src/shaders/`](../src/shaders/)                                                                                      | Supplies GLSL replacements for Three.js shader chunks.                                                   |

## Startup Sequence

Importing `main.js` performs the following work:

1. Resolve the loader, progress, play, and sound-toggle elements from `index.html`.
2. Create the shared `assets`, `params`, and `uniforms` objects.
3. Start loading the soundtrack and airplane model through a shared `THREE.LoadingManager`. The terrain normal map loads independently from `src/chunk.js`; the boat request is skipped while its feature flag is disabled.
4. Create the scene, camera, renderer, post-processing pipeline, lights, fog, timer, and `DayNight` (which adds the sky dome and applies the starting time of day) while those asynchronous requests are in flight.
5. When the loading manager completes, fade out the loader and call `init(assets)`.
6. `init()` creates `Plane`, bakes the impostor atlas and creates the shared impostor material when `worldFeatures.scenery` is enabled, creates `ChunkManager`, gives the plane a world-height sampler backed by the manager's seeded terrain noise, places the plane and its world-space trail mesh in the scene, creates `FlightPauseDebug` when `?debug=1` is set, and schedules `tic()`.
7. The play action starts audio, accelerates the plane, moves the camera backward, and enables the flight effect. When the camera intro finishes, it also allows the debug pause (`canPause`).

Rendering begins after assets load, before the user presses the play action. The play action starts movement and audio; it is not the application bootstrap.

## Frame Loop

`tic(timestamp)` is the only animation-frame loop:

1. Update `THREE.Timer` and clamp the movement delta to at most `0.016` seconds.
2. Call `plane.update(deltaTime)`, or call `flightPause.update()` instead while the debug flight pause is active. The latter updates the orbit controls and calls `plane.refreshTrails()`. Global time keeps advancing either way.
3. Write elapsed time and plane position to `uTime` and `uCamera`.
4. Call `dayNight.update(deltaTime)` with the unclamped delta. It advances the time of day, which keeps running during the debug pause, and updates lights, fog, `uAtmosphere`, and the sky. It measures the curved-world horizon dip from the camera's world height. Its state then goes to `plane.setDayNight()` for the trail tint.
5. Call `chunkManager.updateChunks()` to reconcile on boundary changes or process bounded keyed work.
6. Pass the larger of `uAcceleration` (or `0` while paused) and the GUI `params.speedEffect` to `postProcessing.setSpeedEffect()`, render through `postProcessing.render(deltaTime)`, and schedule the next frame.

Keep frame-sensitive behavior in this order unless a change explicitly depends on a different update sequence.

## Shared State And Ownership

- `params` in `main.js` is the mutable source for terrain generation, colors, peak light intensity, the day/night settings (`params.dayNight`: `timeOfDay`, `cycleDuration`, `paused`), post-processing, scenery placement settings (`params.scenery`, snapshotted into every placement request), and the optional debug GUI. Fog and background colors are no longer parameters; `DayNight` derives them from the time of day.
- `worldSeed` comes from `?seed=<value>` or a random per-load fallback. The same value seeds main-thread height queries and every worker.
- `worldFeatures` in `main.js` is the frozen runtime switch for scenery, clouds, and boats. Scenery is `true`; clouds and boats are `false`.
- `uniforms` in `main.js` is shared with chunks, the impostor material, and boat materials. It includes `uBiomeOffset`, derived from `worldSeed`; `ChunkManager` derives the same offset for its workers. It also includes `uCurvature`, whose value is `CURVATURE` exported by `src/chunk.js`, so materials compiled before the first chunk arrives, such as the `?debug=1` terrain-sample markers, still receive a valid uniform.
- The perspective camera becomes a child of `Plane` through `Plane.addCamera()`. During the debug flight pause, `FlightPauseDebug` temporarily moves it into the scene for `OrbitControls` and re-parents it on resume.
- `Plane` owns and updates the trail geometry, but the trail mesh is a direct scene child so older sections remain in world space as the plane moves.
- `DayNight` owns the sky dome mesh and writes into the ambient, sun, and moon lights, `scene.fog`, `scene.background`, and `uniforms.uAtmosphere` created by `main.js`. It never touches `Plane`; `main.js` forwards its state.
- The constructor parameter named `camera` in `ChunkManager` is currently the `Plane`. `getCoordsByCamera()` therefore reads the moving plane's world position.
- Loaded startup assets are collected before `init()`. `Plane` requires the airplane mesh; the boat model is loaded only when its feature is enabled. `init()` adds `assets.impostorMaterial`, which chunks share and never dispose.
- `ChunkManager` owns `Map` registries for desired, live, pending, and in-flight chunks. A monotonically increasing revision invalidates obsolete work before any worker result becomes a Three.js object.
- The worker pool uses up to two workers on desktop and one on mobile. Workers cache their seeded simplex functions and transfer typed-array buffers instead of cloning them.
- `ChunkManager` owns chunk membership in the scene. Each `Chunk` owns its terrain geometry, its scenery geometry, and its dormant local decorations.

`window.__INFINITE_WORLD__.getChunkStats()` exposes read-only desired/live/queue/in-flight, lifecycle, worker-result, worker-count, revision, seed, and scenery chunk and instance diagnostics. `getFlightStats()` exposes position, speed effect, pointer input, vertical velocity, camera state, and the current terrain corridor. `getPostProcessingStats()` exposes whether the effect pass is active, the speed-effect intensity, and the MSAA sample count. `getDebugStats()` returns `{ paused, canPause }` with `?debug=1`, and `null` otherwise. `getDayNightStats()` returns time of day, palette time, horizon dip, pause state, cycle duration, the `night` factor, and the apparent elevation and intensity of the sun and moon. None of these APIs exposes mutable runtime state.

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
        |                    +-> impostor bake -> shared impostor material
        |                    |
        |                    +-> ChunkManager -> worker pool
        |                           |                |
        |                           |                +-> transferable geometry and scenery buffers
        |                           v
        |                       Chunk instances -> scenery impostor mesh
        v
tic() -> shared uniforms -> DayNight (sky, lights, fog) -> material shader hooks -> PostProcessing -> WebGLRenderer
```

Terrain CPU calculations and terrain GLSL both consume related world data. When changing height, curvature, or water behavior, verify the CPU geometry path and every affected shader path together.

## Extension Boundaries

- Add world-streaming policy to `ChunkManager`, not `main.js`.
- Add scenery placement rules to `sceneryPlacement.js` so they stay deterministic and run in the worker. Add new scenery types to `impostorArchetypes.js` and `impostorTypes.js`. Put other per-chunk generation in `Chunk` or a helper extracted from it.
- Add runtime player input, camera-follow, or trail behavior to `Plane`; keep independently testable scalar flight rules in `flightPolicy.js`.
- Add shared scene lifecycle behavior to `main.js` only when no narrower owner exists.
- Keep material-specific GLSL in `src/shaders/` and document new replacement points in [Rendering](RENDERING.md).
- Add fullscreen passes and effects to `PostProcessing`, not to the frame loop in `main.js`.
- Add time-of-day palettes and celestial rules to `dayNightPolicy.js`; add sky, light, or fog application to `DayNight`.
- Keep DOM behavior synchronized between `index.html` and `main.js`; see [Experience](EXPERIENCE.md).

## Known Architectural Gaps

- There is no teardown path for animation frames, event listeners, audio, or the renderer.
- Debug GUI code is mixed into `main.js` and only enabled with `?gui=1`.
- `main.js` imports debug dependencies such as `lil-gui` unconditionally.
- Shared module-level materials rely on mutable `onBeforeCompile` callbacks.
- The URL seed is deterministic but is not persisted when omitted; there is no broader session state.

Treat these as descriptions of the current system, not permission to broaden unrelated tasks.

## Open Questions

- Should runtime constants and responsive policy move to a dedicated configuration module?
- Should asset loading become a separate service with explicit failure states?
- Should the tracked-object terminology in `ChunkManager` replace the current camera naming?
- What teardown lifecycle is required if the experience is embedded in a larger application?
