# Experience, Controls, And Audio

## Purpose

This document covers user-visible startup, flight input, camera behavior, audio, and responsive UI. The coupled sources are [`index.html`](../index.html), [`main.js`](../main.js), and [`src/plane.js`](../src/plane.js).

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

1. The module starts soundtrack and airplane requests with a shared `THREE.LoadingManager`. The terrain normal map loads independently; tree and boat requests are disabled by `worldFeatures`.
2. `onStart` reveals the loader.
3. `onProgress` animates the progress width from loaded item count divided by total item count.
4. `onLoad` hides the canvas, registers the sound toggle, and fades out the loader.
5. After the loader fade, `init(assets)` starts the scene and the play action fades in.
6. The canvas fades in while the scene is already rendering.

The current flow has no explicit asset error handler. A failed startup-critical request can therefore leave the experience without a useful recovery message.

## Play Action

The play action is the required user gesture for audio and movement:

- Start the looping soundtrack when the debug GUI is disabled.
- Animate plane `baseSpeed` and `speed` from the initial values to `55`.
- Hide the play action.
- Move camera Z from `-1` to `-18` on desktop or `-16` on mobile.
- Call `plane.addEffect()` after the camera transition.

Keep audio playback behind a user gesture to comply with browser autoplay policies. If startup is redesigned, verify that playback still begins from a direct interaction.

## Flight Controls

`Plane.initCursor()` installs global input listeners:

- `mousemove` maps pointer position into normalized `[-1, 1]` cursor coordinates.
- Horizontal cursor position turns the plane around Y and rolls the airplane model.
- Vertical cursor position is recorded but is not currently used for movement.
- `wheel` animates acceleration to `1`, producing a temporary speed and camera effect.
- `touchmove` maps the first touch to cursor coordinates and reduces horizontal input by dividing it by `1.5`.

There are no keyboard controls. Do not document or expose a control until it is implemented and manually verified.

## Movement And Camera

- `Plane` moves forward along its local positive Z axis.
- `main.js` clamps the movement delta passed to `Plane.update()` to `0.016` seconds.
- The camera is parented to `Plane`, so world traversal follows the player automatically.
- After `addEffect()`, acceleration changes speed, camera X/Z position, and FOV; values ease back toward the base state over time.
- `Plane.addEffect()` currently uses Z `-18` as its follow/effect baseline on every viewport, even after the mobile play transition ends at `-16`.
- The airplane mesh roll and shader-driven trails visualize turning and acceleration.

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
- Terrain density and, when trees are enabled, tree density.

`handleResize()` updates renderer dimensions and camera projection, but it does not recompute `isMobile` or rebuild terrain. Crossing the breakpoint after startup therefore does not switch runtime policy.

The play action includes an additional Tailwind layout adjustment below `240px`. Validate text and controls at very narrow widths when changing UI classes.

## Experience Change Checklist

1. Start from a fresh reload and observe loader progress.
2. Confirm the scene appears before interaction without console or network errors.
3. Activate play and verify audio, forward movement, camera transition, and trails.
4. Move the pointer or touch input and verify turning and model roll.
5. Use wheel input and verify temporary acceleration and FOV response.
6. Toggle sound in both states.
7. Resize the viewport and repeat at desktop and narrow/mobile sizes.
8. Check that loader, play action, sound control, and canvas do not overlap or clip.

## Known Gaps And Open Questions

- The play and sound controls are not semantic buttons and have no keyboard activation or accessible labels.
- Global input listeners have no teardown path.
- Asset failures have no user-visible error state or retry action.
- The mobile policy is based on startup width rather than input capabilities or live media queries.
- Decide whether vertical input should control altitude or be removed from the state model.
