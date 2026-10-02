# Architecture

## Purpose

This document maps runtime ownership and data flow. Read it before moving behavior between modules or changing application startup. Terrain algorithms are detailed in [Terrain](TERRAIN.md), while Three.js material and shader contracts are detailed in [Rendering](RENDERING.md).

## Runtime Map

| Area                  | Owner                                                                                                                  | Responsibility                                                                                           |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| HTML shell            | [`index.html`](../index.html)                                                                                          | Loader, play action, sound toggle, and module entry point.                                               |
| Application bootstrap | [`main.js`](../main.js)                                                                                                | Asset loading, shared parameters and uniforms, scene setup, frame loop, and resize handling.             |
| World streaming       | [`src/chunkManager.js`](../src/chunkManager.js)                                                                        | Reconciles chunks, dispatches keyed worker jobs, validates results, and owns scene membership.           |
| Streaming policy      | [`src/chunkPolicy.js`](../src/chunkPolicy.js)                                                                          | Computes chunk keys, heading-biased desired sets, forward-shifted LOD, heading sectors, and the radial scenery range without browser state. |
| Terrain generation    | [`src/chunkGeometry.js`](../src/chunkGeometry.js)                                                                      | Defines seeded height sampling and creates transferable position, normal, UV, height, and index buffers. |
| Worker execution      | [`src/chunkGeometry.worker.js`](../src/chunkGeometry.worker.js), [`src/chunkWorkerPool.js`](../src/chunkWorkerPool.js) | Reuses a bounded module-worker pool and transfers generated terrain and scenery buffers to the main thread. |
| Biome field           | [`src/biome.js`](../src/biome.js)                                                                                      | Seeded CPU twin of the shader biome selector (`uBiomeOffset`).                                           |
| World seed            | [`src/worldSeed.js`](../src/worldSeed.js)                                                                              | Pure `?seed=` parsing, GUI value normalization, and the short random fallback seed.                      |
| Scenery placement     | [`src/sceneryPlacement.js`](../src/sceneryPlacement.js)                                                                | Deterministic per-chunk tree, cactus, and rock instances, run in the worker.                             |
| Terrain unit          | [`src/chunk.js`](../src/chunk.js)                                                                                      | Owns one rendered mesh, replaces/disposes geometry, injects shaders, owns its scenery mesh, and places dormant boats. |
| Player movement       | [`src/plane.js`](../src/plane.js)                                                                                      | Owns flight input, speed changes, camera attachment, and trail rendering.                                |
| Debug flight pause    | [`src/flightPauseDebug.js`](../src/flightPauseDebug.js), [`src/debugPolicy.js`](../src/debugPolicy.js)                 | With `?debug=1`, toggles a flight-only pause on **P** and hands the camera to `OrbitControls`.            |
| Flight policy         | [`src/flightPolicy.js`](../src/flightPolicy.js)                                                                        | Computes speed effects, vertical input, terrain clearance, safety-climb speed, and altitude limits.      |
| Day/night cycle       | [`src/dayNight.js`](../src/dayNight.js), [`src/dayNightPolicy.js`](../src/dayNightPolicy.js)                             | Advances time of day, owns the sky dome, and drives lights, fog, and atmosphere from pure keyframe data. |
| Post-processing       | [`src/postProcessing.js`](../src/postProcessing.js), [`src/speedEffect.js`](../src/speedEffect.js)                     | Owns the effect composer, idle bypass, the acceleration blur and chromatic aberration, and the static film-grain overlay.               |
| Impostor scenery      | [`src/impostors/`](../src/impostors/)                                                                                  | Builds scenery and cloud sources from primitives, describes each family as a catalog (`impostorCatalogs.js`), bakes the octahedral atlases, and provides the impostor materials and quad meshes. |
| Near scenery meshes   | [`src/impostors/sceneryMeshes.js`](../src/impostors/sceneryMeshes.js), [`src/sceneryMeshPolicy.js`](../src/sceneryMeshPolicy.js) | Selects nearby scenery (or cloud) instances every frame and draws them as real meshes in two levels of detail, cross-fading with each other and the impostors through a shared dither. |
| Scenery shadows       | [`src/sceneryShadows.js`](../src/sceneryShadows.js), [`src/shadowPolicy.js`](../src/shadowPolicy.js) | Picks the shadowing light (sun or moon), renders scenery impostors and the airplane into two light-aligned depth cascades, and writes the receiver uniforms the terrain and scenery shaders sample. |
| Clouds                | [`src/clouds.js`](../src/clouds.js), [`src/cloudPlacement.js`](../src/cloudPlacement.js) | Keeps a world-level field of clouds around the airplane, each turned to face it, independent of chunks: deterministic placement, one impostor mesh (frontal-view atlas), and near cloud meshes in two levels of detail. |
| Cloud shadows         | [`src/cloudShadows.js`](../src/cloudShadows.js), [`src/shadowPolicy.js`](../src/shadowPolicy.js) | Renders the cloud impostors into a blurred, light-aligned coverage map and writes the receiver uniforms the terrain and scenery shaders sample. |
| Curved lighting       | [`src/curvedLights.js`](../src/curvedLights.js)                                                                        | Builds the `lights_fragment_begin` copy with the curved-world terminator, the variant that also applies the scenery and cloud shadows (terrain, scenery impostors, near scenery meshes), and the unshadowed variant with a scaled ambient light (clouds). |
| Shader source         | [`src/shaders/`](../src/shaders/)                                                                                      | Supplies GLSL replacements for Three.js shader chunks.                                                   |

## Startup Sequence

Importing `main.js` performs the following work:

1. Resolve the loader, progress, play, and sound-toggle elements from `index.html`.
2. Create the shared `assets`, `params`, and `uniforms` objects.
3. Start loading the soundtrack, the airplane model picked by `?plane=` from `AIRPLANE_MODELS`, and (with scenery or clouds enabled) the wood-grain detail texture through a shared `THREE.LoadingManager`. The terrain normal maps load independently through `src/terrainNormals.js`; the boat request is skipped while its feature flag is disabled.
4. Create the scene, camera, renderer, post-processing pipeline, lights, fog, timer, and `DayNight` (which adds the sky dome and applies the starting time of day) while those asynchronous requests are in flight.
5. When the loading manager completes, fade out the loader and call `init(assets)`.
6. `init()` creates `Plane`, bakes the impostor atlas, creates the shared impostor material and its wireframe twin, and creates `SceneryMeshes` (added to the scene) when `worldFeatures.scenery` is enabled, creates `SceneryShadows` (with the impostor caster only when scenery is enabled) and registers the airplane mesh as a caster, creates `Clouds` (which bakes the cloud atlas) and `CloudShadows` when `worldFeatures.clouds` is enabled, creates `ChunkManager`, gives the plane a world-height sampler backed by the manager's seeded terrain noise, places the plane and its world-space trail mesh in the scene, creates `FlightPauseDebug` when `?debug=1` is set, and schedules `tic()`.
7. The play action starts audio, accelerates the plane, moves the camera backward, and enables the flight effect. When the camera intro finishes, it also allows the debug pause (`canPause`).

Rendering begins after assets load, before the user presses the play action. The play action starts movement and audio; it is not the application bootstrap.

## Frame Loop

`tic(timestamp)` is the only animation-frame loop:

1. Update `THREE.Timer` and clamp the movement delta to at most `0.016` seconds.
2. Call `plane.update(deltaTime)`, or call `flightPause.update()` instead while the debug flight pause is active. The latter updates the orbit controls and calls `plane.refreshTrails()`. Global time keeps advancing either way.
3. Write elapsed time and plane position to `uTime` and `uCamera`.
4. Call `dayNight.update(deltaTime)` with the unclamped delta. It advances the time of day, which keeps running during the debug pause, and updates lights, fog, `uAtmosphere`, and the sky. It measures the curved-world horizon dip from the camera's world height. Its state then goes to `plane.setDayNight()` for the trail tint, and is kept for step 7.
5. Call `chunkManager.updateChunks()` to reconcile on boundary changes or process bounded keyed work.
6. Call `sceneryMeshes.update(chunkManager.chunks, chunkSize, camera)`. It runs after this frame's scenery commits and with the camera that renders, so it selects the near instances that will be drawn as meshes. It must stay between steps 5 and 10.
7. Call `clouds.update(plane.position, camera)`. It re-places the cloud field when the airplane enters a new cloud cell (or after a seed or settings change) and selects the near cloud meshes.
8. Call `sceneryShadows.update(chunkManager.chunks, chunkSize, plane, dayNightState)`. It picks the shadowing light (published as `sceneryShadows.light` and `uSceneryShadowLight` every frame), syncs one caster proxy per scenery chunk plus the airplane, and renders the scheduled shadow cascades into their own depth targets, restoring the renderer's render target. It runs after this frame's scenery commits and before the main pass, so receivers sample maps of the current frame.
9. Call `cloudShadows.update(sceneryShadows.light, plane)`. It renders the cloud coverage map again only when needed (airplane travel, light rotation, field regeneration, or settings), after steps 7 and 8.
10. Pass the larger of `uAcceleration` (or `0` while paused) and the GUI `params.speedEffect` to `postProcessing.setSpeedEffect()`, render through `postProcessing.render(deltaTime)`, and schedule the next frame.

Keep frame-sensitive behavior in this order unless a change explicitly depends on a different update sequence.

## Shared State And Ownership

- `params` in `main.js` is the mutable source for terrain generation, colors, terrain normal-map tile size and strength (`params.terrainNormals`), peak light intensity, the day/night settings (`params.dayNight`: `timeOfDay`, `cycleDuration`, `paused`, the editable `keyframes` palette, and `skyGradientHeight`), the radial fog range (`params.fog`), post-processing, scenery placement settings (`params.scenery`, snapshotted into every placement request), the near scenery mesh band (`params.sceneryMeshes`), the scenery wireframe overlay (`params.sceneryWireframe`, shared by the clouds), the scenery shadow settings (`params.shadows`), the cloud field (`params.clouds`: placement, near-mesh bands, wood detail, ambient boost, variation, and shadows), the propeller speed (`params.propeller`), and the optional debug GUI. Fog and background colors are not parameters; `DayNight` derives them from the time of day.
- `worldSeed` comes from `?seed=<value>` (`parseWorldSeed()` in [`src/worldSeed.js`](../src/worldSeed.js)) or a random eight-character fallback. The same value seeds main-thread height queries and every worker. The `?gui=1` **World** folder replaces it through `applyWorldSeed()` in `main.js`: `ChunkManager.setSeed()` updates the noises, the biome offset, and `uBiomeOffset`, and regenerates every desired chunk; `Clouds.setSeed()` re-places the cloud field; `main.js` then lifts the plane above the new ground if needed and calls `Plane.resetTerrainState()`.
- `worldFeatures` in `main.js` is the frozen runtime switch for scenery, clouds, and boats. Scenery and clouds are `true`; boats are `false`. Chunks no longer read the `clouds` flag.
- `uniforms` in `main.js` is shared with chunks, the impostor material, the near scenery mesh material, the cloud field (through a copy that replaces `uSceneryMeshRange`), and boat materials. `SceneryMeshes` writes its `uSceneryMeshRange`; the impostor shader reads it to hand nearby instances over. `SceneryShadows` writes the `uSceneryShadow*` receiver uniforms (maps, matrices, cascades, strength, light direction, fade, softness, bias), created by `createSceneryShadowUniforms()`. `CloudShadows` writes the `uCloudShadow*` receiver uniforms created by `createCloudShadowUniforms()`. It includes `uBiomeOffset`, derived from `worldSeed`; `ChunkManager` derives the same offset for its workers. It also includes `uCurvature`, whose value is `CURVATURE` exported by `src/chunk.js`, so materials compiled before the first chunk arrives, such as the `?debug=1` terrain-sample markers, still receive a valid uniform.
- The perspective camera becomes a child of `Plane` through `Plane.addCamera()`. During the debug flight pause, `FlightPauseDebug` temporarily moves it into the scene for `OrbitControls` and re-parents it on resume.
- `Plane` owns and updates the trail geometry, but the trail mesh is a direct scene child so older sections remain in world space as the plane moves.
- `DayNight` owns the sky dome mesh and writes into the ambient, sun, and moon lights, `scene.fog`, `scene.background`, and `uniforms.uAtmosphere` created by `main.js`. It never touches `Plane`; `main.js` forwards its state.
- The constructor parameter named `camera` in `ChunkManager` is currently the `Plane`. `getCoordsByCamera()` therefore reads the moving plane's world position.
- Loaded startup assets are collected before `init()`. `Plane` requires the airplane mesh; the boat model is loaded only when its feature is enabled. `init()` adds `assets.impostorMaterial` and its debug wireframe twin `assets.impostorWireframeMaterial`, which chunks share and never dispose. `SceneryMeshes` owns its source geometries for both levels, instance buffers, materials (including the wireframe twins), and the `uSceneryMeshLodRange` uniform; it reads chunk instance arrays but never retains or disposes them. `main.js` owns the `sceneryDetail` uniforms (`uDetail`, `uDetailScale`, `uDetailColor`) that it shares with the near meshes. `SceneryShadows` owns its cascade render targets, depth textures, cameras, caster materials, caster scene, and pooled proxies; proxies borrow chunk scenery geometries and the airplane geometry, and never dispose them. `Clouds` owns the cloud atlas, impostor material and geometry, wireframe twin, near cloud meshes, and its uniform copy. `CloudShadows` owns its two coverage targets, light camera, and caster and blur materials; its caster proxy borrows the cloud impostor geometry.
- `ChunkManager` owns `Map` registries for desired, live, pending, and in-flight chunks. A monotonically increasing revision invalidates obsolete work before any worker result becomes a Three.js object.
- The worker pool uses up to two workers on desktop and one on mobile. Workers cache their seeded simplex functions and transfer typed-array buffers instead of cloning them.
- `ChunkManager` owns chunk membership in the scene. Each `Chunk` owns its terrain geometry, its scenery geometry, and its dormant boats.

`window.__INFINITE_WORLD__.getChunkStats()` exposes read-only desired/live/queue/in-flight, lifecycle, worker-result, worker-count, revision, seed, and scenery chunk and instance diagnostics. `getFlightStats()` exposes position, speed effect, pointer input, vertical velocity, camera state, and the current terrain corridor. `getPostProcessingStats()` exposes whether the effect pass is active, the speed-effect intensity, and the MSAA sample count. `getDebugStats()` returns `{ paused, canPause }` with `?debug=1`, and `null` otherwise. `getSceneryMeshStats()` returns the near scenery mesh band, instance and triangle counts, draw calls, and selection time, or `null` without scenery. `getShadowStats()` returns whether shadows are enabled, the shadowing light and its elevation, the shader strength, caster chunk count, draw calls, update time, and per-cascade radius, map size, interval, center, last rendered frame, and draw calls. `getCloudStats()` returns the cloud count, the current cloud cell, the field revision, the regeneration time, the cloud atlas size, and the near cloud mesh stats; `getCloudShadowStats()` returns whether cloud shadows are enabled, their strength, radius, map size, center, render count, and last render time. Both return `null` without clouds. `getDayNightStats()` returns time of day, palette time, horizon dip, pause state, cycle duration, the `night` factor, and the apparent elevation and intensity of the sun and moon. None of these APIs exposes mutable runtime state.

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
        |                    +-> SceneryMeshes (one instanced mesh per type and level of detail)
        |                    |
        |                    +-> SceneryShadows (cascade depth targets, caster proxies)
        |                    |
        |                    +-> Clouds (cloud atlas, field impostor mesh, near cloud meshes)
        |                    |      +-> cloudPlacement (deterministic grid around the airplane)
        |                    |
        |                    +-> CloudShadows (blurred coverage map)
        |                    |
        |                    +-> ChunkManager -> worker pool
        |                           |                |
        |                           |                +-> transferable geometry and scenery buffers
        |                           v
        |                       Chunk instances -> scenery impostor mesh
        v
tic() -> shared uniforms -> DayNight (sky, lights, fog) -> ChunkManager -> SceneryMeshes.update() -> Clouds.update() -> SceneryShadows.update() -> CloudShadows.update() -> material shader hooks -> PostProcessing -> WebGLRenderer
```

Terrain CPU calculations and terrain GLSL both consume related world data. When changing height, curvature, or water behavior, verify the CPU geometry path and every affected shader path together.

## Extension Boundaries

- Add world-streaming policy to `ChunkManager`, not `main.js`.
- Add scenery placement rules to `sceneryPlacement.js` so they stay deterministic and run in the worker. Add new scenery types to `impostorArchetypes.js` and `impostorTypes.js`. Keep near-mesh fade and selection rules in `sceneryMeshPolicy.js` and their GPU twin in `scenery-instance-pars-vertex.glsl`. Put other per-chunk generation in `Chunk` or a helper extracted from it.
- Add runtime player input, camera-follow, or trail behavior to `Plane`; keep independently testable scalar flight rules in `flightPolicy.js`.
- Add shared scene lifecycle behavior to `main.js` only when no narrower owner exists.
- Keep material-specific GLSL in `src/shaders/` and document new replacement points in [Rendering](RENDERING.md).
- Add fullscreen passes and effects to `PostProcessing`, not to the frame loop in `main.js`.
- Add time-of-day palettes and celestial rules to `dayNightPolicy.js`; add sky, light, or fog application to `DayNight`.
- Keep shadow light selection, cascade bounds, snapping, and scheduling in `shadowPolicy.js`; add shadow casters or cascade rendering to `SceneryShadows`, and receivers through `scenery-shadow-pars-fragment.glsl` and `createShadowedLightsFragment()`. Cloud shadow rules also live in `shadowPolicy.js`, their rendering in `CloudShadows`, and their receiver lookup in `cloud-shadow-pars-fragment.glsl`.
- Add cloud placement rules to `cloudPlacement.js`, cloud shapes to `cloudArchetypes.js`, and new impostor families as catalogs in `impostorCatalogs.js`, so the baker, impostor material, and near meshes stay shared. Give every family distinct defines, so materials that share an `onBeforeCompile` source never share a compiled program.
- Keep DOM behavior synchronized between `index.html` and `main.js`; see [Experience](EXPERIENCE.md).

## Known Architectural Gaps

- There is no teardown path for animation frames, event listeners, audio, or the renderer.
- Debug GUI code is mixed into `main.js` and only enabled with `?gui=1`.
- `main.js` imports debug dependencies such as `lil-gui` unconditionally.
- Shared module-level materials rely on mutable `onBeforeCompile` callbacks.
- The URL seed is deterministic but is not persisted when omitted or changed from the GUI; there is no broader session state.

Treat these as descriptions of the current system, not permission to broaden unrelated tasks.

## Open Questions

- Should runtime constants and responsive policy move to a dedicated configuration module?
- Should asset loading become a separate service with explicit failure states?
- Should the tracked-object terminology in `ChunkManager` replace the current camera naming?
- What teardown lifecycle is required if the experience is embedded in a larger application?
