import { clamp01, smoothstep } from './math.js'

// Pure rules for the sun's lens flare (src/lensFlareEffect.js): where the sun
// lands on screen, how much of its disc the scene leaves visible, and how the
// flare fades with the sky disc, the screen edges, and time.

// Depth taps over the sun's disc (lens-flare-taps.glsl).
export const LENS_FLARE_TAPS = 32

// The sky disc's fade with the sun's height above the curved horizon
// (sky.frag.glsl), so the flare follows the disc it comes from.
export const SUN_DISC_FADE = Object.freeze({ start: -0.15, end: 0.05 })

// Sizes are in screen heights. The defaults are a soft, cinematic flare:
// a glow around the sun, a light starburst, a chain of soft tinted ghosts
// across the screen center, and a halo ring.
export const LENS_FLARE_DEFAULTS = Object.freeze({
	enabled: true,
	// Multiplies every element; the sun's color tints them all.
	intensity: 1,
	// Seconds for the occlusion to settle, so dithered edges and the
	// propeller never flicker the flare.
	smoothing: 0.08,
	// Radius of the disc the depth taps cover, in degrees (the sky disc is
	// 1.1 to 1.4 degrees).
	occlusionRadius: 1.3,
	// Distance inside the screen edge (UV) where the flare starts to fade out.
	edgeMargin: 0.06,
	// Bright core: peak, falloff radius, and falloff power.
	glow: Object.freeze({ intensity: 0.25, size: 0.08, falloff: 2 }),
	// Rays fixed to the lens: peak, length, ray count (alternately long and
	// short), sharpness (higher is thinner), and rotation (radians).
	starburst: Object.freeze({ intensity: 0.12, size: 0.18, rays: 12, sharpness: 30, rotation: 0.2 }),
	// Soft tinted discs along the line from the sun through the screen
	// center: peak, base radius, and spacing along the line (1 = as drawn).
	ghosts: Object.freeze({ intensity: 0.06, size: 0.05, spacing: 1 }),
	// Rainbow ring around the screen center, brightest toward the sun: peak,
	// radius, and width.
	halo: Object.freeze({ intensity: 0.04, radius: 0.42, width: 0.03 }),
	// Paints the depth taps on screen: green over the sky, red where occluded.
	debug: Object.freeze({ showTaps: false }),
})

export function createLensFlareSettings() {
	const { glow, starburst, ghosts, halo, debug, ...rest } = LENS_FLARE_DEFAULTS
	return {
		...rest,
		glow: { ...glow },
		starburst: { ...starburst },
		ghosts: { ...ghosts },
		halo: { ...halo },
		debug: { ...debug },
	}
}

// How much of the sky's sun disc shows (sky.frag.glsl): `sunY` is the y of the
// unit direction toward the sun, `horizonDip` the curved horizon's dip below
// the horizontal, in radians.
export function getSunDiscVisibility(sunY, horizonDip) {
	return smoothstep(SUN_DISC_FADE.start, SUN_DISC_FADE.end, sunY + Math.sin(horizonDip))
}

// Screen position of the sun, a direction [x, y, z] at infinity, through a
// camera's world-to-view and projection matrices (column-major element
// arrays): `u`, `v` in [0, 1] across the viewport, and `inFront`, false when
// the sun is behind the camera. Writes into `out`.
export function getSunScreenPosition(direction, viewElements, projectionElements, out = {}) {
	const [x, y, z] = direction
	const v = viewElements
	const viewX = v[0] * x + v[4] * y + v[8] * z
	const viewY = v[1] * x + v[5] * y + v[9] * z
	const viewZ = v[2] * x + v[6] * y + v[10] * z
	const p = projectionElements
	const clipX = p[0] * viewX + p[4] * viewY + p[8] * viewZ
	const clipY = p[1] * viewX + p[5] * viewY + p[9] * viewZ
	const clipW = p[3] * viewX + p[7] * viewY + p[11] * viewZ
	out.inFront = clipW > 1e-6
	const w = out.inFront ? clipW : 1
	out.u = 0.5 + (0.5 * clipX) / w
	out.v = 0.5 + (0.5 * clipY) / w
	return out
}

// Radius on screen (UV, per axis) of a disc `degrees` wide in radius near the
// view axis, from the projection's scale, so zoom and aspect apply. Writes
// into `out`.
export function getOcclusionRadiusUv(projectionElements, degrees, out = {}) {
	const tangent = Math.tan((Math.max(degrees, 0) * Math.PI) / 180)
	out.u = 0.5 * Math.abs(projectionElements[0]) * tangent
	out.v = 0.5 * Math.abs(projectionElements[5]) * tangent
	return out
}

// 1 while the sun's disc (radius `radiusU`, `radiusV`) lies at least `margin`
// inside the screen, 0 once it has left it entirely.
export function getScreenEdgeFade(u, v, radiusU, radiusV, margin) {
	const edge = Math.max(margin, 1e-4)
	const fadeU = smoothstep(-radiusU, edge, Math.min(u, 1 - u))
	const fadeV = smoothstep(-radiusV, edge, Math.min(v, 1 - v))
	return fadeU * fadeV
}

// Weight of the previous visibility after `deltaTime` seconds of exponential
// smoothing over `tau` seconds: 0 without smoothing, 1 (held) for a frame
// without time.
export function getTemporalBlend(deltaTime, tau) {
	if (!(tau > 0)) return 0
	return Math.exp(-Math.max(deltaTime, 0) / tau)
}

// The flare's strength before occlusion: 0 when it is off or the sun is
// behind the camera, otherwise the sky disc's visibility times the edge fade.
export function getLensFlareGate({ enabled, intensity }, discVisibility, screen, edgeFade) {
	if (!enabled || !(intensity > 0) || !screen.inFront) return 0
	return clamp01(discVisibility) * clamp01(edgeFade)
}
