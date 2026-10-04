# Architecture

## Purpose

This document maps runtime ownership and data flow, and is the project's module map. Read it before moving behavior between modules or changing application startup. Terrain algorithms are detailed in [Terrain](TERRAIN.md), while Three.js material and shader contracts are detailed in [Rendering](RENDERING.md).

## Runtime Map

Modules marked _pure_ import no three.js objects and no browser state; Node tests import them directly, and the chunk workers import the ones placement and terrain generation need.

### Bootstrap and frame loop

| Owner                                                    | Responsibility                                                                                                                                                                                  |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`index.html`](../index.html), [`style.css`](../style.css) | DOM shell: loader, load-error state, Play button, sound toggle, the default airplane preload, and the module entry point.                                                                     |
| [`main.js`](../main.js)                                  | Thin bootstrap: reads the URL flags, lazy-loads the debug modules, creates the params, uniforms, `RenderSetup`, `Intro`, `World`, and the stats API, then requests the startup assets.          |
| [`src/appParams.js`](../src/appParams.js)                | `createAppParams()`: the mutable parameter tree every system reads and the `?gui=1` panel edits.                                                                                                |
| [`src/sharedUniforms.js`](../src/sharedUniforms.js)      | `createSharedUniforms()`: the uniform object shared by the terrain, scenery, cloud, and debug materials.                                                                                        |
| [`src/worldConstants.js`](../src/worldConstants.js)      | `CURVATURE`, `CHUNK_SIZE`, and the `WORLD_FEATURES` switches (scenery and clouds on, boats off).                                                                                                |
| [`src/renderSetup.js`](../src/renderSetup.js)            | `RenderSetup`: renderer, scene, fog, background, lights, camera, `PostProcessing`, `FrameStats`, the adaptive pixel ratio, resize handling, and the tone-mapping switch.                         |
| [`src/assetLoader.js`](../src/assetLoader.js)            | `loadStartupAssets()`: one `LoadingManager` for the airplane and its shadow caster, the wood texture, the terrain normal maps, and the dormant boat; reports the airplane failure (`LOAD-002`). |
| [`src/intro.js`](../src/intro.js)                        | `Intro`: loading bar, load-error state with Retry, Play button and camera intro, sound toggle ([Experience](EXPERIENCE.md)).                                                                    |
| [`src/world.js`](../src/world.js)                        | `World`: builds the world systems from the loaded assets, owns the frame loop (`tic()`) and its order, the world seed, the terrain actions of the GUI, shader precompilation, and the stats API. |
| [`src/debug/debugGui.js`](../src/debug/debugGui.js)      | The `?gui=1` lil-gui panel, loaded by dynamic `import()` only behind its flag.                                                                                                                  |
| [`src/frameStats.js`](../src/frameStats.js)              | Frame intervals, per-stage main-thread time, whole-frame draw counters, and GPU time for `getRenderStats()`.                                                                                    |
| [`src/adaptivePixelRatio.js`](../src/adaptivePixelRatio.js) | _Pure._ The pixel-ratio cap, the `?dpr=` override, and the windowed ratio that steps down below 60 fps and back up with a growing wait.                                                     |
| [`src/soundtrack.js`](../src/soundtrack.js)              | Streams the looping music through a media element and applies its volume through a Web Audio gain node.                                                                                         |
| [`src/ktx2Textures.js`](../src/ktx2Textures.js)          | The shared `KTX2Loader` and `loadKTX2Texture()`.                                                                                                                                                |

### Terrain and world generation

| Owner                                                                                                                  | Responsibility                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`src/chunkManager.js`](../src/chunkManager.js)                                                                        | Reconciles chunks, dispatches keyed worker jobs, validates results, commits them within a frame budget, and owns scene membership.                          |
| [`src/chunkPolicy.js`](../src/chunkPolicy.js)                                                                          | _Pure._ Chunk keys, the heading-biased desired set, the commit budget, worker count, forward-shifted LOD, the scenery range, and the curved culling sphere. |
| [`src/chunkGeometry.js`](../src/chunkGeometry.js)                                                                      | _Pure._ Seeded height sampling (with the desert topography blend), `TERRAIN_DEFAULTS`, and the transferable terrain buffers.                                |
| [`src/chunkTopology.js`](../src/chunkTopology.js)                                                                      | Shares one index and uv attribute per LOD, wraps worker buffers in `BufferGeometry`, and disposes chunk geometry without the shared attributes.             |
| [`src/chunkWorkerJob.js`](../src/chunkWorkerJob.js), [`src/chunkGeometry.worker.js`](../src/chunkGeometry.worker.js), [`src/chunkWorkerPool.js`](../src/chunkWorkerPool.js) | One worker job (terrain buffers plus scenery), the thin worker wrapper, and the bounded pool that restarts crashed workers.        |
| [`src/chunk.js`](../src/chunk.js)                                                                                      | One terrain mesh: geometry replacement, shader injection, curved culling bounds, its scenery impostor mesh, and dormant boats.                               |
| [`src/terrainBands.js`](../src/terrainBands.js)                                                                        | _Pure._ The biome noise layers and elevation bands shared by the CPU and the terrain shader (`TERRAIN_SHADER_DEFINES`).                                     |
| [`src/biome.js`](../src/biome.js)                                                                                      | _Pure._ Seeded CPU twin of the shader biome field (`uBiomeOffset`).                                                                                         |
| [`src/terrainNormals.js`](../src/terrainNormals.js)                                                                    | The terrain normal-map textures, their assignment to the terrain layers, and their uniforms.                                                                |
| [`src/sceneryPlacement.js`](../src/sceneryPlacement.js)                                                                | _Pure._ Deterministic per-chunk tree, cactus, and rock instances, run in the worker.                                                                        |
| [`src/cloudPlacement.js`](../src/cloudPlacement.js)                                                                    | _Pure._ Deterministic cloud placement around the airplane.                                                                                                  |
| [`src/worldSeed.js`](../src/worldSeed.js)                                                                              | _Pure._ `?seed=` parsing, GUI value normalization, and the random fallback seed.                                                                            |
| [`src/math.js`](../src/math.js), [`src/random.js`](../src/random.js), [`src/noise.js`](../src/noise.js)                | _Pure._ Shared scalar helpers (three's formulas), seeded hashing and weighted picks, and the simplex noise port of the GLSL.                                 |

### Airplane and flight

| Owner                                                                                                  | Responsibility                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| [`src/plane.js`](../src/plane.js)                                                                      | `Plane`: speed, turn, terrain-aware altitude, banking, and the parts below, which it composes.                                                  |
| [`src/flightInput.js`](../src/flightInput.js)                                                          | Pointer, touch, and wheel input; the wheel holds a boost or brake request.                                                                      |
| [`src/followCamera.js`](../src/followCamera.js)                                                        | The chase camera's reaction to the speed effect and the turn, once the intro hands over.                                                        |
| [`src/propeller.js`](../src/propeller.js), [`src/propellerMask.js`](../src/propellerMask.js)           | Shader-driven propeller rotation; _pure_ selection of the propeller's UV charts in the fused mesh.                                              |
| [`src/wingTrails.js`](../src/wingTrails.js), [`src/trailHistory.js`](../src/trailHistory.js)           | The world-space trail ribbon; its _pure_ ring buffer of recorded poses, sampled by flown distance.                                               |
| [`src/flightPolicy.js`](../src/flightPolicy.js)                                                        | _Pure._ Speed effect, vertical input, terrain corridor and clearance, safety climb, and altitude limits.                                        |
| [`src/airplaneModels.js`](../src/airplaneModels.js)                                                    | Per-model data (path, load transform, trail anchor, propeller) and the `?plane=` choice.                                                        |
| [`src/flightPauseDebug.js`](../src/flightPauseDebug.js), [`src/debugPolicy.js`](../src/debugPolicy.js) | With `?debug=1`, a flight-only pause on **P** that hands the camera to `OrbitControls`; _pure_ flag and shortcut rules.                         |
| [`src/terrainSampleDebug.js`](../src/terrainSampleDebug.js)                                            | With `?debug=1`, markers on the four terrain points the flight corridor samples.                                                                |

### Rendering systems

| Owner                                                                                                              | Responsibility                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`src/dayNight.js`](../src/dayNight.js), [`src/dayNightPolicy.js`](../src/dayNightPolicy.js)                       | The sky dome, lights, fog, and `uAtmosphere` from the time of day; _pure_ keyframes, celestial directions, horizon dip, and `?time=`.                         |
| [`src/radialFog.js`](../src/radialFog.js)                                                                          | Patches the fog chunk once so fog measures distance from the eye.                                                                                             |
| [`src/postProcessing.js`](../src/postProcessing.js), [`src/speedEffect.js`](../src/speedEffect.js)                 | The composer that renders every frame (the only antialiasing), film grain, and the acceleration blur and chromatic aberration.                                |
| [`src/sceneryImpostors.js`](../src/sceneryImpostors.js)                                                            | The scenery atlas bake with the per-type wood detail, the impostor material and its wireframe twin, the near meshes, and the live variation, tree palette, and detail uniforms. |
| [`src/sceneryPalettePolicy.js`](../src/sceneryPalettePolicy.js)                                                    | _Pure._ Tree crown palettes: the painted types, the neutral bake gray, default settings, and their flattened uniform layout.                                   |
| [`src/impostors/`](../src/impostors/)                                                                              | Scenery and cloud source meshes, the catalogs (`impostorCatalogs.js`), the octahedral bake, impostor materials and quads, near meshes, and the wireframe overlay. |
| [`src/sceneryMeshPolicy.js`](../src/sceneryMeshPolicy.js)                                                          | _Pure._ Near-mesh bands, fades, and per-type selection buckets.                                                                                               |
| [`src/clouds.js`](../src/clouds.js)                                                                                | The world-level cloud field: atlas, impostor mesh, and near cloud meshes.                                                                                     |
| [`src/sceneryShadows.js`](../src/sceneryShadows.js), [`src/cloudShadows.js`](../src/cloudShadows.js)               | Two depth cascades for scenery and airplane shadows; the blurred cloud coverage map. Both write receiver uniforms.                                            |
| [`src/shadowPolicy.js`](../src/shadowPolicy.js)                                                                    | _Pure._ Shadow light selection, cascade bounds, snapping, scheduling, and defaults.                                                                           |
| [`src/lightSpace.js`](../src/lightSpace.js)                                                                        | Light basis, texel-snapped fitting, shadow matrices, and the impostor caster material shared by both shadow systems.                                          |
| [`src/curvedLights.js`](../src/curvedLights.js)                                                                    | `createSceneryLighting()`: the `lights_fragment_begin` copy with the curved terminator, optional shadow lookups, and an optional ambient scale.               |
| [`src/shaderChunks.js`](../src/shaderChunks.js), [`src/shaders/`](../src/shaders/)                                 | `replaceChunks()`, which throws on a missing three.js chunk; the GLSL inserted into built-in materials.                                                       |

## Startup Sequence

Importing `main.js` performs the following work:

1. Read the URL flags. Load the debug-only modules behind them (`FlightPauseDebug` with `?debug=1`, the GUI module with `?gui=1`) with top-level `await`, before any asset request, so the loading manager cannot finish between two requests.
2. Create `params` (`createAppParams()`), the seed (`?seed=` or a random fallback), and `uniforms` (`createSharedUniforms()`).
3. Create `RenderSetup`: the `WebGLRenderer` (before any request, because the KTX2 loader picks its GPU format from it), the scene with fog and background, the ambient, sun, and moon lights, the camera, `PostProcessing`, `FrameStats`, and the adaptive pixel ratio (pinned by `?dpr=`). It sizes everything and listens for `resize`.
4. Create the `Soundtrack` (its media element buffers in the background, not with `?gui=1`; nothing waits for it) and `Intro`.
5. Create `World`, which creates `DayNight` (the sky dome and the starting time of day) and the timer. Publish `window.__INFINITE_WORLD__ = world.createStatsApi()` and, with `?gui=1`, create the GUI. Its controls guard every system that does not exist yet; those systems read the edited `params` when they are created.
6. Call `loadStartupAssets()`: the airplane picked by `?plane=` and its simplified shadow caster (`GLTFLoader` with the meshopt decoder and the KTX2 loader; without `?plane=`, an inline script in `index.html` already preloads the default model, and the loader reuses that response), the white oak wood texture (with scenery or clouds), and the terrain normal maps. `loadKTX2Texture()` keeps each texture in the manager until it is transcoded. The boat request is skipped while its feature is off.
7. When every request has settled, the loader places the shadow caster like the model and calls back. Without the airplane, `Intro.showError()` replaces the loader with the error and a Retry button that reloads the page, and nothing else starts. Otherwise `Intro.start()` fades the loader out, then calls `world.init(assets)` and `world.precompileShaders()`, and fades in the Play button over the canvas.
8. `World.init()` creates `Plane`, then `SceneryImpostors` (atlas bake, impostor material, wireframe twin, near meshes) when scenery is on, `SceneryShadows` (with the impostor caster only with scenery) and registers the airplane caster, `Clouds` and `CloudShadows` when clouds are on, and `ChunkManager` (given the boat model and both impostor materials). It gives the plane a height sampler backed by the manager's seeded noise, places the plane and its world-space trail mesh, creates the `?debug=1` helpers, and schedules `tic()`.
9. `precompileShaders()` compiles every program in the scene, including the hidden near scenery and cloud meshes and the cloud shadow caster and blur, against the composer's offscreen buffer, so none compiles on first use in flight. With `KHR_parallel_shader_compile` the driver links them in the background; nothing waits.
10. Play starts the soundtrack (its audio context is created inside the gesture), accelerates the plane, and pulls the camera back. When the camera intro ends, `World.startFlight()` starts the chase camera's reaction and allows the debug pause (`canPause`).

Rendering begins after assets load, before Play is pressed.

## Frame Loop

`World.tic(timestamp)` is the only animation-frame loop. It starts with `frameStats.beginFrame(timestamp)` and ends with `frameStats.endFrame()`; `frameStats.mark()` after each stage records its main-thread time (`flight`, `dayNight`, `chunks`, `scenery`, `clouds`, `shadows`, `render`). Last, the frame interval goes to `RenderSetup.adaptPixelRatio()`, which resizes the renderer and the composer buffers only when the ratio steps.

1. Update the timer. The first frame's delta, which spans the whole loading time, is taken as `0`, so `uTime` and the time of day start on the first frame (which keeps `?time=` exact and benchmark runs reproducible). The movement delta is clamped to `0`–`0.016` seconds; the timer reports `0` while the page is hidden and can report a negative first delta after the tab is shown again, and `Plane` guards its vertical speed against a zero delta.
2. Call `plane.update(delta)`, or `flightPause.update()` instead while the debug pause is active (it updates the orbit controls and refreshes the trails). Global time keeps advancing either way. Update the corridor markers.
3. Write the elapsed time and plane position to `uTime` and `uCamera`.
4. Call `dayNight.update(delta)` with the unclamped delta: time of day, lights, fog, `uAtmosphere`, and the sky, with the horizon dip measured from the camera height. Its state goes to `plane.setDayNight()` (trail tint) and is kept for step 7.
5. Call `chunkManager.updateChunks()`: reconcile on boundary changes, dispatch queued jobs, commit finished results within `CHUNK_STREAMING.commitBytes` and `commitMs`, then move every chunk's mesh-level culling spheres to the curvature drop (`Chunk.updateCurvedBounds()`; the geometry spheres stay flat for the shadow casters). Workers also receive their next job as soon as they finish, between frames.
6. Call `sceneryImpostors.update(chunks, CHUNK_SIZE, camera)`: after this frame's scenery commits and with the rendering camera, it selects the instances drawn as near meshes.
7. Call `clouds.update(plane.position, camera)`: re-place the field when the airplane enters a new cloud cell (or after a seed or settings change) and select the near cloud meshes.
8. Call `sceneryShadows.update(chunks, CHUNK_SIZE, plane, dayNightState)`: pick the shadowing light (`sceneryShadows.light` and `uSceneryShadowLight`, every frame), sync the caster proxies, and render the scheduled cascades, restoring the render target.
9. Call `cloudShadows.update(sceneryShadows.light, plane)`: render the coverage map again only when needed (travel, light rotation, field regeneration, or settings).
10. Pass the larger of `uAcceleration` (or `0` while paused) and the GUI `params.speedEffect` to `postProcessing.setSpeedEffect()`, render through `postProcessing.render(delta)`, and schedule the next frame.

Keep frame-sensitive behavior in this order unless a change explicitly depends on a different sequence.

## Shared State And Ownership

- `params` (`createAppParams()`) is the mutable source for terrain generation, colors, terrain color noise and normal maps, peak light intensities, the day/night settings and editable palette, the radial fog range, tone mapping, the adaptive resolution, post-processing, scenery placement (snapshotted into every worker request), the impostor detail and variation, the near-mesh bands, the wireframe overlay, shadows, the cloud field, the propeller, and the trails. Fog and background colors are not parameters; `DayNight` derives them from the time of day.
- The world seed lives on `World` (`world.seed`). The same value seeds main-thread height queries and every worker. The `?gui=1` **World** folder replaces it through `World.applyWorldSeed()`: `ChunkManager.setSeed()` updates the noises, the biome offset, and `uBiomeOffset`, and regenerates every desired chunk; `Clouds.setSeed()` re-places the field; the plane is then lifted above the new ground if needed and `Plane.resetTerrainState()` forgets the smoothed corridor. Before `init()` only the seed and `uBiomeOffset` change.
- `WORLD_FEATURES` is the frozen switch for scenery, clouds, and boats.
- `uniforms` (`createSharedUniforms()`) is shared with chunks, the impostor and near-mesh materials, the cloud field (through a copy that replaces `uSceneryMeshRange`), the debug markers, and boat materials. `SceneryMeshes` writes `uSceneryMeshRange`; `SceneryShadows` writes the `uSceneryShadow*` uniforms (`createSceneryShadowUniforms()`); `CloudShadows` writes the `uCloudShadow*` uniforms (`createCloudShadowUniforms()`). `uCurvature` is `CURVATURE` from the start, so materials compiled before the first chunk still receive a valid value.
- The camera is a child of `Plane` (`Plane.addCamera()`). The debug pause moves it into the scene for `OrbitControls` and re-parents it on resume. `Plane` owns the trail geometry, but the trail mesh is a direct scene child so older sections stay in world space.
- `DayNight` owns the sky dome and writes into the lights, `scene.fog`, `scene.background`, and `uAtmosphere` that `RenderSetup` and `createSharedUniforms()` create. It never touches `Plane`; `World` forwards its state.
- The constructor parameter named `camera` in `ChunkManager` is the `Plane`, so `getCoordsByCamera()` reads the airplane's world position.
- Startup assets: `Plane` requires the airplane mesh. The loader places the simplified shadow caster (`assets.planeShadowGeometry`, `null` if it failed) like the model; `SceneryShadows` borrows it without disposing it. Without the wood texture, a white texel stands in, so the bake and the near meshes still match. The boat model loads only with its feature.
- `SceneryImpostors` owns the scenery impostor material and its wireframe twin, which chunks share and never dispose, the near meshes, and the variation and detail uniforms. The source geometries of both near-mesh levels are cached for the page by `getCatalogSources()` and never disposed. `SceneryMeshes` owns its instance buffers and materials; it reads chunk instance arrays but never retains them. `SceneryShadows` owns its cascade targets, cameras, caster materials and scene, and pooled proxies, which borrow chunk scenery geometries. `Clouds` owns the cloud atlas, impostor mesh, near cloud meshes, and its uniform copy. `CloudShadows` owns its coverage targets, camera, and caster and blur materials.
- `ChunkManager` owns the desired, live, pending, and in-flight registries and chunk membership in the scene. A monotonically increasing revision invalidates obsolete work before any worker result becomes a Three.js object. Each `Chunk` owns its terrain geometry, scenery geometry, and dormant boats; every chunk at one LOD shares one index and one uv attribute, never disposed.
- The worker pool has `getChunkWorkerCount()` workers: one on mobile, half the logical cores (one to four) on desktop. Workers cache their seeded noises, transfer typed-array buffers, and restart with a growing delay after a crash, giving up after three crashes in a row. `World` passes `isMobile` to `ChunkManager`.

## Stats API

`window.__INFINITE_WORLD__` (`World.createStatsApi()`) exposes read-only getters; none returns mutable runtime state:

- `getChunkStats()`: desired, live, queue, and in-flight counts, lifecycle and worker-result counters, worker count and failures, revision, seed, and scenery chunk and instance counts.
- `getFlightStats()`: position, speed, speed effect, pointer input, vertical velocity, camera position and FOV, and a snapshot of the terrain corridor.
- `getPostProcessingStats()`: whether the speed effect is visible, its intensity, and the MSAA sample count.
- `getDebugStats()`: `{ paused, canPause }` with `?debug=1`, otherwise `null`.
- `getSceneryMeshStats()`: near-mesh bands, instance and triangle counts, draw calls, selection time, and per-level buckets, or `null` without scenery.
- `getShadowStats()`: enabled, light and elevation, strength, caster chunks, airplane caster triangles, draw calls, update time, and per-cascade radius, map size, interval, center, last frame, and draw calls.
- `getCloudStats()` and `getCloudShadowStats()`: cloud count, cell, revision, regeneration time, atlas size, near-mesh stats; shadow enabled, strength, radius, map size, center, render count, and last render time. Both `null` without clouds.
- `getDayNightStats()`: time of day, palette time, horizon dip, pause, cycle duration, `night`, and the sun and moon elevation and intensity.
- `getRenderStats()`: `frame`, `cpu`, `gpu`, and per-stage times, each `{ samples, mean, p50, p95, p99, max }` in milliseconds over the last `600` frames (`null` before the first sample; intervals above one second are skipped); `drawCalls` and `triangles` of every render of the last frame (shadow maps, scene, and post-processing, because `FrameStats` resets `renderer.info` in `beginFrame()`); `programs`, `geometries`, `textures`, `pixelRatio`, `drawingBuffer`; and `adaptivePixelRatio`. GPU time needs `EXT_disjoint_timer_query_webgl2` (`gpuSupported`); its queries start on the first call, so `gpu` stays `null` for a few frames and an unprofiled page issues none.

Do not create a second render loop, terrain-parameter store, or chunk registry without an architectural reason documented here.

## Data Flow

```text
main.js -> createAppParams, createSharedUniforms, RenderSetup, Intro, World
        -> loadStartupAssets --(airplane failed)--> Intro.showError
                |
                v
        Intro.start -> World.init(assets)
                         +-> Plane (FlightInput, FollowCamera, Propeller, WingTrails) -> flightPolicy
                         +-> SceneryImpostors (atlas bake, impostor material, SceneryMeshes)
                         +-> SceneryShadows (cascade depth targets, caster proxies)
                         +-> Clouds (cloudPlacement, cloud atlas, near cloud meshes) -> CloudShadows
                         +-> ChunkManager -> worker pool (chunkWorkerJob)
                                 |              +-> transferable terrain and scenery buffers
                                 v
                             Chunk -> terrain mesh, scenery impostor mesh

World.tic -> Plane -> uniforms -> DayNight -> ChunkManager -> SceneryImpostors -> Clouds
          -> SceneryShadows -> CloudShadows -> PostProcessing -> WebGLRenderer
```

Terrain CPU calculations and terrain GLSL consume the same world data. When changing height, bands, biomes, curvature, or water behavior, verify the CPU path and every affected shader path together.

## Extension Boundaries

- Add world-streaming policy to `ChunkManager` and `chunkPolicy.js`, not to `World`.
- Add scenery placement rules to `sceneryPlacement.js` so they stay deterministic and run in the worker. Add new scenery types to `impostorArchetypes.js` and `impostorTypes.js`. Keep near-mesh rules in `sceneryMeshPolicy.js` and their GPU twin in `scenery-instance-pars-vertex.glsl`.
- Change terrain band or biome constants only in `terrainBands.js`; the shader receives them as defines.
- Add input to `FlightInput`, chase-camera behavior to `FollowCamera`, trail behavior to `WingTrails`, and flight behavior to `Plane`; keep scalar flight rules in `flightPolicy.js`.
- Add a frame stage to `World.tic()` only when no system's own update can host it, and add a `frameStats.mark()` for it.
- Add parameters to `createAppParams()` and their controls to `debugGui.js`; a control calls the owning system, never duplicates its logic.
- Keep material-specific GLSL in `src/shaders/`, patch three.js chunks only through `replaceChunks()`, and document new replacement points in [Rendering](RENDERING.md).
- Add fullscreen passes to `PostProcessing`, time-of-day rules to `dayNightPolicy.js`, and sky, light, or fog application to `DayNight`.
- Keep shadow rules in `shadowPolicy.js`, light-space math in `lightSpace.js`, casters and cascades in `SceneryShadows`, and cloud coverage in `CloudShadows`; receivers go through `createSceneryLighting()`.
- Add new impostor families as catalogs in `impostorCatalogs.js`, so the baker, impostor material, and near meshes stay shared. Give every family distinct defines, so materials that share an `onBeforeCompile` source never share a compiled program.
- Keep DOM IDs synchronized between `index.html`, `main.js`, and `intro.js` (checked by `test/domShell.test.js`); see [Experience](EXPERIENCE.md).

## Known Architectural Gaps

- There is no teardown path for the animation frame, event listeners, audio, or the renderer (only `Plane.dispose()` removes its input listeners).
- Shared module-level materials rely on mutable `onBeforeCompile` callbacks.
- The seed is deterministic but is not persisted when omitted or changed from the GUI; there is no broader session state.

Treat these as descriptions of the current system, not permission to broaden unrelated tasks.

## Open Questions

- Should the tracked-object terminology in `ChunkManager` replace the current camera naming?
- What teardown lifecycle is required if the experience is embedded in a larger application?
