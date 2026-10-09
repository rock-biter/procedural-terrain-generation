# Experience, Controls, And Audio

## Purpose

This document covers user-visible startup, flight input, camera behavior, audio, and responsive UI. The coupled sources are [`index.html`](../index.html), [`src/intro.js`](../src/intro.js), [`src/assetLoader.js`](../src/assetLoader.js), [`src/flightInput.js`](../src/flightInput.js), [`src/followCamera.js`](../src/followCamera.js), [`src/plane.js`](../src/plane.js), and the pure rules in [`src/flightPolicy.js`](../src/flightPolicy.js).

## DOM Contract

`Intro` ([`src/intro.js`](../src/intro.js)) resolves these elements when `main.js` creates it:

| ID                   | Role                                                                      |
| -------------------- | ------------------------------------------------------------------------- |
| `loader`             | Full startup loading state.                                               |
| `progress`           | Width-based asset progress indicator.                                     |
| `load-error`         | Load-error state, `hidden` until the airplane fails to load (`role="alert"`). |
| `load-error-message` | The error text.                                                           |
| `load-retry`         | Retry button: reloads the page.                                           |
| `play`               | Starts movement, audio, camera transition, and flight effects.            |
| `sound-toggle`       | Mutes or unmutes the soundtrack (volume `0.1` or `0`).                    |

Changing an ID requires updating `index.html` and `intro.js`; `test/domShell.test.js` fails when a looked-up ID is missing. UI classes are Tailwind utilities in `index.html`; [`style.css`](../style.css) imports Tailwind and prevents document scrolling. The `?gui=1` tools create their own elements with inline styles and no IDs: the lil-gui panel (top right) and the [debug biome map](#debug-biome-map) (top left).

## Loading Flow

1. Before the bundle runs, an inline script in `index.html` preloads the default airplane GLB (skipped when `?plane=` is set). `loadStartupAssets()` then requests the airplane and its shadow caster, the white oak wood texture, the boat model, and the terrain normal maps through one `THREE.LoadingManager`, reusing the preloaded airplane response; the textures are KTX2 and count as loaded once transcoded. The soundtrack is not part of it: its media element buffers in the background and never delays startup.
2. `onStart` reveals the loader; `onProgress` animates the progress width from loaded item count divided by total item count.
3. When every request has settled and the airplane is missing, `Intro.showError()` fades the loader out and shows "The airplane could not be loaded." with a focused **Retry** button that reloads the page. Nothing else starts. The other assets degrade instead of failing: without the wood texture, scenery and clouds keep their plain vertex colors; without a normal map, its layer stays flat; without the shadow caster, the shadow pass draws the full airplane; without the boat model, a stand-in boat built from primitives is drawn.
4. Otherwise `Intro.start()` hides the canvas, registers the sound toggle, and fades out the loader. After the fade, `World.init(assets)` bakes the impostor atlases and starts the scene, shader precompilation starts in the background, and the play action fades in.
5. The canvas fades in while the scene is already rendering.

## Play Action

The play action is the required user gesture for audio and movement (`Intro.play()`):

- Start the looping soundtrack when the debug GUI (`?gui=1`) is disabled. A failed or blocked playback only logs a warning; the flight starts anyway.
- Animate plane `baseSpeed` and `speed` from the initial values to `55`.
- Hide the play action.
- Move camera Z from `-1` to `-18` on desktop or `-16` on mobile in one second with an `expo.out` ease.
- After the camera transition, call `World.startFlight()`: the chase camera starts reacting to the flight (`FollowCamera.start()`) and the debug pause becomes available.

Keep audio playback behind a user gesture to comply with browser autoplay policies. If startup is redesigned, verify that playback still begins from a direct interaction.

## Flight Controls

`FlightInput` ([`src/flightInput.js`](../src/flightInput.js)), created by `Plane`, installs global input listeners:

- `mousemove` maps horizontal pointer position into normalized `[-1, 1]` coordinates and records vertical position as a top-origin screen ratio.
- Horizontal cursor position turns the plane around Y and rolls the airplane model.
- Vertical positions above `45%` of the screen command a climb. Positions from `45%` through `65%` command zero vertical speed so the plane settles at its reached altitude. Positions below `65%` command a descent. Input strength increases linearly toward the top or bottom edge.
- Each wheel event holds a request for `0.2` seconds (`FLIGHT_LIMITS.wheelHold`): scrolling down requests a boost (`1`), scrolling up a brake (`-1`). While a request is held, the speed effect eases toward it (`wheelResponse`, about `95%` of the way in `0.2` s), so continuous scrolling holds a full boost; without one it decays toward `0` at `speedEffectDecay` (`0.6`) per second. The effect boosts speed up to three times cruise speed or brakes to no less than `95%` of it. `getNextSpeedEffect()` is the effect's only writer.
- `touchmove` applies the same vertical bands to the first touch and reduces horizontal input by dividing it by `1.5`.
- Every flight listener returns early while input is disabled (`Plane.setInputEnabled(false)`, during the debug flight pause and while the pointer is over the debug biome map), which also drops a held wheel request. `FlightInput.center()` returns the input to its neutral start (no turn, the pointer in the middle of the vertical hold band).

There are no player keyboard controls. The only keyboard shortcut is the debug flight pause below. Do not document or expose a control until it is implemented and manually verified.

## Debug Flight Pause

With `?debug=1`, [`src/flightPauseDebug.js`](../src/flightPauseDebug.js) registers a `keydown` listener. Without the flag, neither the listener nor the controls exist.

- The physical **P** key (`KeyP`, so every keyboard layout uses the same key) toggles the pause. Repeated key events, Ctrl/Meta/Alt chords, and presses inside text inputs, selects, or editable elements are ignored ([`src/debugPolicy.js`](../src/debugPolicy.js)).
- Pausing is possible only after the play intro finishes, because the intro tweens the camera and speed.
- The pause freezes only the flight: `Plane.update()` is skipped, so movement, altitude, and camera follow stop, and no new trail poses are recorded. Each paused frame still calls `Plane.refreshTrails()`, so the **Trails** GUI sliders (`?gui=1`) change the frozen trail in real time. The global timer, `uTime`, chunk streaming, and rendering keep running. The flight speed effect is forced to `0`, so post-processing uses its idle bypass unless the GUI **speedEffect** slider (`?gui=1`) is above `0`, which keeps blur and chromatic aberration on the frozen frame.
- On pause, the plane's pointer, wheel, and touch input is disabled (dropping any held wheel request, so the speed effect stays frozen), and the camera is detached into world space with `scene.attach()`. `OrbitControls` then orbits, pans, and zooms around the plane's world position, from `2` to `600` units. Panning is map-style (`screenSpacePanning = false`): it slides the camera and its target across the horizontal world plane instead of the camera's view plane, so it never changes their height. The controls are created on the first pause, not at startup, because the `OrbitControls` constructor calls `lookAt()` and would otherwise rotate the follow camera while it is still a child of the plane.
- On resume, the camera is re-parented to the plane and its saved local position, orientation, and FOV are restored, so the flight view continues without a jump.
- A teleport from the `?gui=1` [biome map](#debug-biome-map) while paused moves the camera and the orbit target by the airplane's offset (`FlightPauseDebug.moveBy()`), so the orbit stays around it.
- Chunk streaming and curvature stay centered on the plane, not on the orbit camera. Moving far from the plane therefore shows the edge of the loaded world and curvature that is not centered on the view.

## Movement And Camera

- `Plane` moves forward along its local positive Z axis.
- `World.tic()` clamps the movement delta passed to `Plane.update()` to `0`–`0.016` seconds; after a hidden tab the timer can report `0` or a negative first delta, and `Plane` treats a zero delta as no vertical motion.
- The camera is parented to `Plane`, so world traversal follows the player automatically.
- The plane samples terrain at its current position and three points along its heading. At cruise speed those points are `20.625`, `41.25`, and `61.875` units ahead; they expand smoothly to `41.25`, `82.5`, and `123.75` units at maximum boost.
- The highest sampled terrain point plus a fixed `10`-unit clearance sets the target minimum altitude. That target rises promptly and falls more slowly; current terrain still provides the hard collision floor.
- When the smoothed terrain floor rises above the current flight path, automatic climb speed changes from `6` to `28` units per second based only on upcoming topographic relief.
- Automatic terrain braking applies only above cruise speed and while the sampled target minimum is above the airplane's actual altitude. With that collision risk present, relief over `10` units smoothly reduces the excess speed; at `30` units of relief the reduction grows to `25%` for a `20`-unit altitude deficit and `45%` for a severe `40`-unit deficit.
- While that same collision risk is present, a target minimum that rises more than `8` units above the smoothed minimum also triggers a temporary automatic brake pulse. It reaches `0.65` for a `30`-unit jump, reducing a full boost from `165` to `93.5`; the wheel brake remains stronger at `1`. Camera Z and FOV move in the braking direction and the acceleration trail is suppressed. Both automatic braking effects clear as soon as the airplane reaches the target minimum; cruise speed and manual braking remain unchanged.
- When a downward command would cross the smoothed minimum altitude, its negative vertical velocity is cancelled. The plane holds the floor without repeatedly descending into and climbing out of it; if the floor is rising, automatic climb remains gradual.
- Flight altitude is capped at Y `95`. With the follow camera `7` units above the airplane, the eye stays below about Y `102`, under the cloud layer (cloud bases from Y `197` to `257`). The airplane can never reach a cloud and always sees them from below.
- After the intro, `FollowCamera` makes boost and braking change camera Z and FOV in opposite directions and moves the camera against the turn; values ease back toward the base state over time. Braking does not activate the acceleration-driven trail contribution.
- `FollowCamera` uses Z `-18` as its follow baseline on every viewport, so on mobile the camera eases from the intro's `-16` to `-18`.
- The airplane mesh roll and two wing trails visualize turning and acceleration. At cruise speed, only pronounced turns reveal a trail; curvature alone can reach at most `75%` of full width, with the outer wing's stripe wider. Increasing actual speed above cruise can reach full width at maximum boost. Each recorded section keeps its width until it leaves the approximately `60`-unit trail. The world-space path follows the airplane's position and wing bank at emission. Each stripe begins and ends at zero thickness, grows wider near the middle, and has irregular inner and outer edges with a thin dark outline. The stripes drift sideways in slightly different gentle waves: the offsets are zero for level wings, grow with the bank recorded at emission, and ramp up along the trail from zero at the wings. Very thin projected sections become slightly translucent to reduce flicker.
- The airplane is the toy biplane by default; `?plane=toy` loads the toy monoplane. With the biplane, the trails leave the upper wing tips.
- The propeller turns continuously while flying, at `params.propeller.speed` turns per second (default `4`), and stops during the debug flight pause. With `?gui=1`, **Airplane > Propeller speed** changes it live (`0`–`20`).
- With `?gui=1`, the **Trails** folder tunes ribbon width, white line width, black border width, separate turbulence frequency and amplitude for the inner and outer edges, and frequency and amplitude of the line oscillation. Changes affect the visible trail immediately.
- A continuous day/night cycle (default `240` seconds per day, starting in the morning) changes the sky, lighting, fog, and distant terrain color. The sun and moon rise and set behind the curved edge of the world, and at dusk distant terrain toward the sun stays lit after nearby terrain darkens. The wing trails follow the cycle: pink at dawn, orange at sunset, white by day, and blue at night. The airplane has no navigation lights. See [Rendering](RENDERING.md#daynight-cycle).
- A light blur and chromatic aberration are always present at the viewport edges, matching a `0.4` speed effect. Boosting grows them from the center toward the edges up to full strength, and they ease back to that minimum as the boost fades. Braking does not raise them. The FOV and camera-distance kick still starts from the base view. See [Rendering](RENDERING.md#post-processing-pipeline) for parameters.

`window.__INFINITE_WORLD__.getFlightStats()` exposes read-only position, speed, manual and visual speed effects, terrain-brake effect, pointer ratio, vertical input, vertical velocity, camera state, and terrain-corridor values for browser checks. Corridor diagnostics include all four sampled heights, their speed-scaled distances, target and smoothed minimum altitudes, collision-risk state, minimum-altitude jump, brake impulse, and target and smoothed terrain slowdowns.

Changes to movement should be checked together with chunk tracking because `ChunkManager` follows `plane.position`.

## Audio

- [`src/soundtrack.js`](../src/soundtrack.js) streams the music through an `Audio` media element (`preload = 'auto'`, or `'none'` with `?gui=1`, which never plays it). It is not decoded into memory up front and is not part of the loading manager.
- The first `play()`, inside the play action, creates an `AudioContext` and routes the element through a gain node, because iOS ignores the volume of media elements. The soundtrack loops continuously at volume `0.1`.
- The sound toggle sets the gain to `0` or `0.1` and changes its own opacity; it does not pause or stop the stream. Muting before the play action applies once playback starts.
- The initial toggle state is audible.

See [Assets](ASSETS.md) for the soundtrack path and unresolved provenance metadata.

## Debug Biome Map

With `?gui=1`, `createDebugGui()` also creates the biome map ([`src/debug/biomeMap.js`](../src/debug/biomeMap.js)), a square in the top-left corner that shows the world's biome distribution, to tune the **Biomes > Distribution** settings ([Terrain](TERRAIN.md#biome-field)). It is loaded with the GUI, so the default bundle carries neither.

- **Content:** one flat color per category: sea, frozen sea (the [sea ice](RENDERING.md#sea-ice) sheet, without its floes), desert, forest, and ice ([`src/debug/biomeMapPolicy.js`](../src/debug/biomeMapPolicy.js)). Each pixel averages `2 × 2` samples of the same `getHeight()` and biome fields as the chunks, so islands smaller than a pixel blend instead of speckling. A red arrow marks the airplane along its heading, a bar gives the scale, and the legend gives the shares of desert, forest, and ice in the land the map shows.
- **View:** north (`-Z`) up and `+X` to the right, `10` km wide at first, between `0.5` and `400` km. The wheel zooms about the pointer (about the airplane while following it), and a drag pans and stops following; **Biomes > Map** has **Show**, **Follow airplane**, and **Reset view**. While following, the map moves with the airplane every frame and renders again once it has moved `5%` of its width.
- **Teleport:** a double click moves the airplane to the world point under the pointer (`World.teleportPlane()`) and follows it again, to jump between biomes while tuning. `Plane.teleport()` keeps the heading, places the airplane at the spawn height (`max(height, 0) + 60`), and starts the terrain corridor, the vertical speed, and the wing trails over, so no brake triggers and no ribbon joins the two places. The chunks, scenery, and clouds then stream in around it as after a long flight. During the [debug flight pause](#debug-flight-pause) the orbit camera and its target move with the airplane. Before `World.init()` there is no airplane to move.
- **Rendering:** a module worker ([`src/debug/biomeMap.worker.js`](../src/debug/biomeMap.worker.js)) rasterizes the map from the seed and a `createTerrainSnapshot()` of `params`, keeping the seeded noises between requests. Requests are latest-only: a coarse raster (`80` pixels, `50` on mobile) while the view or a setting changes, then a fine one (`160`, `100` on mobile; about `100` ms in the worker) `150` ms after the last change. Until a raster arrives, the previous one is drawn moved and scaled into the current view, so zoom and pan respond at once. The GUI renders the map again after every terrain, biome, sea ice, or seed change; it does not wait for the chunks.
- **Input:** the map stops `mousemove`, `wheel`, `touchstart`, `touchmove`, `pointerdown`, and `click` from reaching the global flight listeners, so the wheel over it never boosts or brakes. While the pointer is over it, the flight input is disabled and centered, so the airplane holds its course instead of steering toward the corner; leaving restores the previous state.
- **Layout:** `220` CSS pixels wide (`160` below `768` pixels) inside a `6`-pixel padded box (`box-sizing: content-box`, since Tailwind's preflight makes every element `border-box`), fixed `8` pixels from the top-left corner, with `z-index` `1000`, just under the lil-gui panel (`1001`), which it can overlap on narrow screens. Before `World.init()` there is no airplane yet: the map centers on the origin.

## Responsive Behavior

The JavaScript `isMobile` flag is evaluated once at module startup with `window.innerWidth < 768`.

It controls:

- Initial camera FOV and zoom.
- Play-transition camera distance.
- Chunk radius and per-frame queue throughput.
- Terrain density and the default scenery grid cell: `8` units on desktop, `16` on mobile. `?gui=1` can change the cell at runtime.
- Scenery impostors: mobile bakes the same `12 × 12` view grid as desktop but samples one baked frame instead of three.
- The `?gui=1` [biome map](#debug-biome-map): `160` CSS pixels wide with coarser rasters on mobile.
- Near scenery meshes: on mobile, impostors hand over to reduced-detail meshes between `120` and `180` units from the eye, and those to full-detail meshes between `60` and `90`. Desktop uses `220 → 300` and `110 → 150`.

`RenderSetup.handleResize()` updates renderer dimensions and camera projection, but it does not recompute `isMobile` or rebuild terrain. Crossing the breakpoint after startup therefore does not switch runtime policy.

The play action includes an additional Tailwind layout adjustment below `240px`. Validate text and controls at very narrow widths when changing UI classes.

## Experience Change Checklist

1. Start from a fresh reload and observe loader progress.
2. Confirm the scene appears before interaction without console or network errors.
3. Activate play and verify audio, forward movement, camera transition, and trails.
4. Move the pointer or touch input and verify turning, model roll, climb above `45%`, altitude hold from `45%` through `65%`, and descent below `65%`.
5. Scroll down and up to verify the boost (held while scrolling, decaying after) and gentler braking with opposite camera/FOV responses.
6. Toggle sound in both states.
7. Resize the viewport and repeat at desktop and narrow/mobile sizes.
8. Check that loader, play action, sound control, and canvas do not overlap or clip.

## Known Gaps And Open Questions

- The play and sound controls are not semantic buttons and have no keyboard activation or accessible labels.
- Global input listeners have no teardown path.
- Only the airplane failure has a user-visible error state; the retry reloads the whole page.
- The mobile policy is based on startup width rather than input capabilities or live media queries.
