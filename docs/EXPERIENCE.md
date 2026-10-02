# Experience, Controls, And Audio

## Purpose

This document covers user-visible startup, flight input, camera behavior, audio, and responsive UI. The coupled sources are [`index.html`](../index.html), [`main.js`](../main.js), [`src/plane.js`](../src/plane.js), and the pure rules in [`src/flightPolicy.js`](../src/flightPolicy.js).

## DOM Contract

`main.js` resolves these elements at module evaluation time:

| ID             | Owner                      | Role                                                           |
| -------------- | -------------------------- | -------------------------------------------------------------- |
| `loader`       | `index.html` and `main.js` | Full startup loading state.                                    |
| `progress`     | `index.html` and `main.js` | Width-based asset progress indicator.                          |
| `play`         | `index.html` and `main.js` | Starts movement, audio, camera transition, and flight effects. |
| `sound-toggle` | `index.html` and `main.js` | Toggles soundtrack volume between `0.1` and `0`.               |

Changing an ID requires updating both files. UI classes are Tailwind utilities in `index.html`; [`style.css`](../style.css) imports Tailwind and prevents document scrolling.

## Loading Flow

1. The module starts soundtrack, airplane, and wood-grain texture requests with a shared `THREE.LoadingManager`. The terrain normal maps load independently; the boat request is disabled by `worldFeatures`.
2. `onStart` reveals the loader.
3. `onProgress` animates the progress width from loaded item count divided by total item count.
4. `onLoad` hides the canvas, registers the sound toggle, and fades out the loader.
5. After the loader fade, `init(assets)` bakes the scenery impostor atlas, starts the scene, and the play action fades in.
6. The canvas fades in while the scene is already rendering.

The current flow has no explicit asset error handler. A failed startup-critical request can therefore leave the experience without a useful recovery message.

## Play Action

The play action is the required user gesture for audio and movement:

- Start the looping soundtrack when the debug GUI (`?gui=1`) is disabled.
- Animate plane `baseSpeed` and `speed` from the initial values to `55`.
- Hide the play action.
- Move camera Z from `-1` to `-18` on desktop or `-16` on mobile.
- Call `plane.addEffect()` after the camera transition.

Keep audio playback behind a user gesture to comply with browser autoplay policies. If startup is redesigned, verify that playback still begins from a direct interaction.

## Flight Controls

`Plane.initCursor()` installs global input listeners:

- `mousemove` maps horizontal pointer position into normalized `[-1, 1]` coordinates and records vertical position as a top-origin screen ratio.
- Horizontal cursor position turns the plane around Y and rolls the airplane model.
- Vertical positions above `45%` of the screen command a climb. Positions from `45%` through `65%` command zero vertical speed so the plane settles at its reached altitude. Positions below `65%` command a descent. Input strength increases linearly toward the top or bottom edge.
- Scrolling down animates the speed effect toward `1`, boosting speed up to three times cruise speed. Scrolling up animates it toward `-1`, braking to no less than `95%` of cruise speed.
- `touchmove` applies the same vertical bands to the first touch and reduces horizontal input by dividing it by `1.5`.

- Every flight listener returns early while `Plane.inputEnabled` is `false`, which is the case during the debug flight pause.

There are no player keyboard controls. The only keyboard shortcut is the debug flight pause below. Do not document or expose a control until it is implemented and manually verified.

## Debug Flight Pause

With `?debug=1`, [`src/flightPauseDebug.js`](../src/flightPauseDebug.js) registers a `keydown` listener. Without the flag, neither the listener nor the controls exist.

- The physical **P** key (`KeyP`, so every keyboard layout uses the same key) toggles the pause. Repeated key events, Ctrl/Meta/Alt chords, and presses inside text inputs, selects, or editable elements are ignored ([`src/debugPolicy.js`](../src/debugPolicy.js)).
- Pausing is possible only after the play intro finishes, because the intro tweens the camera and speed.
- The pause freezes only the flight: `Plane.update()` is skipped, so movement, altitude, and camera follow stop, and no new trail poses are recorded. Each paused frame still calls `Plane.refreshTrails()`, so the **Trails** GUI sliders (`?gui=1`) change the frozen trail in real time. The global timer, `uTime`, chunk streaming, and rendering keep running. The flight speed effect is forced to `0`, so post-processing uses its idle bypass unless the GUI **speedEffect** slider (`?gui=1`) is above `0`, which keeps blur and chromatic aberration on the frozen frame.
- On pause, the plane's pointer, wheel, and touch input is disabled, any running `acceleration` tween is killed, and the camera is detached into world space with `scene.attach()`. `OrbitControls` then orbits, pans, and zooms around the plane's world position, from `2` to `600` units. Panning is map-style (`screenSpacePanning = false`): it slides the camera and its target across the horizontal world plane instead of the camera's view plane, so it never changes their height. The controls are created on the first pause, not at startup, because the `OrbitControls` constructor calls `lookAt()` and would otherwise rotate the follow camera while it is still a child of the plane.
- On resume, the camera is re-parented to the plane and its saved local position, orientation, and FOV are restored, so the flight view continues without a jump.
- Chunk streaming and curvature stay centered on the plane, not on the orbit camera. Moving far from the plane therefore shows the edge of the loaded world and curvature that is not centered on the view.

## Movement And Camera

- `Plane` moves forward along its local positive Z axis.
- `main.js` clamps the movement delta passed to `Plane.update()` to `0.016` seconds.
- The camera is parented to `Plane`, so world traversal follows the player automatically.
- The plane samples terrain at its current position and three points along its heading. At cruise speed those points are `20.625`, `41.25`, and `61.875` units ahead; they expand smoothly to `41.25`, `82.5`, and `123.75` units at maximum boost.
- The highest sampled terrain point plus a fixed `10`-unit clearance sets the target minimum altitude. That target rises promptly and falls more slowly; current terrain still provides the hard collision floor.
- When the smoothed terrain floor rises above the current flight path, automatic climb speed changes from `6` to `28` units per second based only on upcoming topographic relief.
- Automatic terrain braking applies only above cruise speed and while the sampled target minimum is above the airplane's actual altitude. With that collision risk present, relief over `10` units smoothly reduces the excess speed; at `30` units of relief the reduction grows to `25%` for a `20`-unit altitude deficit and `45%` for a severe `40`-unit deficit.
- While that same collision risk is present, a target minimum that rises more than `8` units above the smoothed minimum also triggers a temporary automatic brake pulse. It reaches `0.65` for a `30`-unit jump, reducing a full boost from `165` to `93.5`; the wheel brake remains stronger at `1`. Camera Z and FOV move in the braking direction and the acceleration trail is suppressed. Both automatic braking effects clear as soon as the airplane reaches the target minimum; cruise speed and manual braking remain unchanged.
- When a downward command would cross the smoothed minimum altitude, its negative vertical velocity is cancelled. The plane holds the floor without repeatedly descending into and climbing out of it; if the floor is rising, automatic climb remains gradual.
- Flight altitude is capped at Y `95`, below the dormant cloud placement around Y `100`.
- After `addEffect()`, boost and braking change speed, camera Z, and FOV in opposite directions; values ease back toward the base state over time. Braking does not activate the acceleration-driven trail contribution.
- `Plane.addEffect()` currently uses Z `-18` as its follow/effect baseline on every viewport, even after the mobile play transition ends at `-16`.
- The airplane mesh roll and two wing trails visualize turning and acceleration. At cruise speed, only pronounced turns reveal a trail; curvature alone can reach at most `75%` of full width, with the outer wing's stripe wider. Increasing actual speed above cruise can reach full width at maximum boost. Each recorded section keeps its width until it leaves the approximately `60`-unit trail. The world-space path follows the airplane's position and wing bank at emission. Each stripe begins and ends at zero thickness, grows wider near the middle, and has irregular inner and outer edges with a thin dark outline. The stripes drift sideways in slightly different gentle waves: the offsets are zero for level wings, grow with the bank recorded at emission, and ramp up along the trail from zero at the wings. Very thin projected sections become slightly translucent to reduce flicker.
- The airplane is the toy biplane by default; `?plane=toy` loads the toy monoplane. With the biplane, the trails leave the upper wing tips.
- The propeller turns continuously while flying, at `params.propeller.speed` turns per second (default `4`), and stops during the debug flight pause. With `?gui=1`, **Airplane > Propeller speed** changes it live (`0`–`20`).
- With `?gui=1`, the **Trails** folder tunes ribbon width, white line width, black border width, separate turbulence frequency and amplitude for the inner and outer edges, and frequency and amplitude of the line oscillation. Changes affect the visible trail immediately.
- A continuous day/night cycle (default `240` seconds per day, starting in the morning) changes the sky, lighting, fog, and distant terrain color. The sun and moon rise and set behind the curved edge of the world, and at dusk distant terrain toward the sun stays lit after nearby terrain darkens. The wing trails follow the cycle: pink at dawn, orange at sunset, white by day, and blue at night. The airplane has no navigation lights. See [Rendering](RENDERING.md#daynight-cycle).
- A light blur and chromatic aberration are always present at the viewport edges, matching a `0.3` speed effect. Boosting grows them from the center toward the edges up to full strength, and they ease back to that minimum as the boost fades. Braking does not raise them. The FOV and camera-distance kick still starts from the base view. See [Rendering](RENDERING.md#post-processing-pipeline) for parameters.

`window.__INFINITE_WORLD__.getFlightStats()` exposes read-only position, speed, manual and visual speed effects, terrain-brake effect, pointer ratio, vertical input, vertical velocity, camera state, and terrain-corridor values for browser checks. Corridor diagnostics include all four sampled heights, their speed-scaled distances, target and smoothed minimum altitudes, collision-risk state, minimum-altitude jump, brake impulse, and target and smoothed terrain slowdowns.

Changes to movement should be checked together with chunk tracking because `ChunkManager` follows `plane.position`.

## Audio

- `THREE.AudioListener` is attached to the camera.
- The soundtrack is non-positional, loops continuously, and starts at volume `0.1`.
- The sound toggle changes volume and its own opacity; it does not pause or stop the audio buffer.
- The initial toggle state is audible.

See [Assets](ASSETS.md) for the soundtrack path and unresolved provenance metadata.

## Responsive Behavior

The JavaScript `isMobile` flag is evaluated once at module startup with `window.innerWidth < 768`.

It controls:

- Initial camera FOV and zoom.
- Play-transition camera distance.
- Chunk radius and per-frame queue throughput.
- Terrain density and the default scenery grid cell: `8` units on desktop, `16` on mobile. `?gui=1` can change the cell at runtime.
- Scenery impostors: mobile bakes a `12 × 12` view grid instead of `16 × 16` and samples one baked frame instead of three.
- Near scenery meshes: on mobile, impostors hand over to reduced-detail meshes between `120` and `180` units from the eye, and those to full-detail meshes between `60` and `90`. Desktop uses `220 → 300` and `110 → 150`.

`handleResize()` updates renderer dimensions and camera projection, but it does not recompute `isMobile` or rebuild terrain. Crossing the breakpoint after startup therefore does not switch runtime policy.

The play action includes an additional Tailwind layout adjustment below `240px`. Validate text and controls at very narrow widths when changing UI classes.

## Experience Change Checklist

1. Start from a fresh reload and observe loader progress.
2. Confirm the scene appears before interaction without console or network errors.
3. Activate play and verify audio, forward movement, camera transition, and trails.
4. Move the pointer or touch input and verify turning, model roll, climb above `45%`, altitude hold from `45%` through `65%`, and descent below `65%`.
5. Scroll down and up to verify temporary boost and gentler braking with opposite camera/FOV responses.
6. Toggle sound in both states.
7. Resize the viewport and repeat at desktop and narrow/mobile sizes.
8. Check that loader, play action, sound control, and canvas do not overlap or clip.

## Known Gaps And Open Questions

- The play and sound controls are not semantic buttons and have no keyboard activation or accessible labels.
- Global input listeners have no teardown path.
- Asset failures have no user-visible error state or retry action.
- The mobile policy is based on startup width rather than input capabilities or live media queries.
