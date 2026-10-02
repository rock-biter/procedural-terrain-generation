// Pure rules for the scenery shadows (src/sceneryShadows.js). Shadows are
// computed in flat world space, before the visual curvature: scenery
// impostors and the airplane render into light-aligned depth maps in two
// cascades, and the terrain and scenery shaders sample them with a soft PCF
// kernel that fades out with distance from the plane.

// Must match the array sizes in scenery-shadow-pars-fragment.glsl.
export const SCENERY_SHADOW_CASCADE_COUNT = 2

// Per device:
// - `cascades`: disk `radius` (world units) of terrain each cascade covers,
//   depth `mapSize` (texels), render `interval` (frames between updates), and
//   `forwardShift` (share of the radius the center moves ahead of the plane).
// - `taps`: PCF samples per receiver. `terrain` is [near, far] cascade;
//   `mesh` and `impostor` are the scenery receivers.
// - `fade`: distance from the plane where shadows start to weaken and vanish.
// - `softness`: penumbra radius in world units, near and at `fade.end`.
export const SCENERY_SHADOW_PRESETS = Object.freeze({
	desktop: Object.freeze({
		cascades: Object.freeze([
			Object.freeze({ radius: 150, mapSize: 2048, interval: 1, forwardShift: 0.35 }),
			Object.freeze({ radius: 500, mapSize: 2048, interval: 2, forwardShift: 0.25 }),
		]),
		taps: Object.freeze({ terrain: Object.freeze([8, 4]), mesh: 4, impostor: 2 }),
		fade: Object.freeze({ start: 220, end: 450 }),
	}),
	mobile: Object.freeze({
		cascades: Object.freeze([
			Object.freeze({ radius: 120, mapSize: 1024, interval: 1, forwardShift: 0.35 }),
			Object.freeze({ radius: 400, mapSize: 1024, interval: 3, forwardShift: 0.25 }),
		]),
		taps: Object.freeze({ terrain: Object.freeze([4, 2]), mesh: 2, impostor: 1 }),
		fade: Object.freeze({ start: 180, end: 360 }),
	}),
})

export const SCENERY_SHADOW_DEFAULTS = Object.freeze({
	enabled: true,
	// Share of the direct light a fully shadowed pixel loses (ambient stays).
	strength: 0.8,
	softness: Object.freeze({ near: 0.6, far: 2.5 }),
	// Constant depth bias in world units. Terrain casts no shadows, so it only
	// guards caster bases against depth precision.
	bias: 0.05,
	// World heights every cascade must contain: visible terrain (clamped at
	// -1), scenery on the highest peaks, and the airplane below its ceiling.
	heightRange: Object.freeze({ min: -2, max: 180 }),
	// Extra depth toward the light, so casters above the range still render.
	casterMargin: 60,
	// Flat elevation (radians) of the shadowing light where shadows appear.
	// Grazing light casts very long shadows, and at the sun/moon hand-over both
	// lights are low, so the strength is 0 and the switch never pops.
	elevationFade: Object.freeze({ start: 0.05, end: 0.2 }),
	// The light basis is rebuilt only after the light turns this far (radians),
	// so slow celestial motion does not rotate the texel grid every frame.
	lightThreshold: 0.0035,
})

function smoothstep(edge0, edge1, x) {
	const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1)
	return t * t * (3 - 2 * t)
}

export function createSceneryShadowSettings({ isMobile = false } = {}) {
	const preset = isMobile ? SCENERY_SHADOW_PRESETS.mobile : SCENERY_SHADOW_PRESETS.desktop
	return {
		enabled: SCENERY_SHADOW_DEFAULTS.enabled,
		strength: SCENERY_SHADOW_DEFAULTS.strength,
		softness: { ...SCENERY_SHADOW_DEFAULTS.softness },
		bias: SCENERY_SHADOW_DEFAULTS.bias,
		heightRange: { ...SCENERY_SHADOW_DEFAULTS.heightRange },
		casterMargin: SCENERY_SHADOW_DEFAULTS.casterMargin,
		elevationFade: { ...SCENERY_SHADOW_DEFAULTS.elevationFade },
		lightThreshold: SCENERY_SHADOW_DEFAULTS.lightThreshold,
		fade: { ...preset.fade },
		cascades: preset.cascades.map((cascade) => ({ ...cascade })),
		taps: { ...preset.taps, terrain: [...preset.taps.terrain] },
	}
}

// Picks the light that casts shadows: the sun or the moon, whichever stands
// higher above the flat horizon. `strength` fades in with that elevation.
// Directions are unit [x, y, z] arrays pointing toward the light.
export function selectShadowLight(sunDirection, moonDirection, { elevationFade }) {
	const sunElevation = Math.asin(Math.min(Math.max(sunDirection[1], -1), 1))
	const moonElevation = Math.asin(Math.min(Math.max(moonDirection[1], -1), 1))
	const isSun = sunElevation >= moonElevation
	const elevation = isSun ? sunElevation : moonElevation
	return {
		light: isSun ? 'sun' : 'moon',
		direction: isSun ? sunDirection : moonDirection,
		elevation,
		strength: smoothstep(elevationFade.start, elevationFade.end, elevation),
	}
}

// Shader strength: 0 skips the shadow pass and every receiver lookup.
export function getShadowStrength({ enabled, strength }, lightStrength) {
	if (!enabled) return 0
	return Math.min(Math.max(strength, 0), 1) * lightStrength
}

// Bounding sphere of the receivers a cascade covers: a disk of `radius`
// around a center moved ahead of the plane along its heading, spanning
// `heightRange`. The orthographic box is a square of half-size
// `sphereRadius`, constant for any light direction, which keeps texel
// snapping stable.
export function getCascadeSphere(
	planeX,
	planeZ,
	headingX,
	headingZ,
	{ radius, forwardShift },
	{ heightRange },
	target = {},
) {
	const headingLength = Math.hypot(headingX, headingZ)
	const shift = headingLength > 1e-6 ? (radius * forwardShift) / headingLength : 0
	const halfHeight = (heightRange.max - heightRange.min) / 2
	target.x = planeX + headingX * shift
	target.y = (heightRange.max + heightRange.min) / 2
	target.z = planeZ + headingZ * shift
	target.diskRadius = radius
	target.sphereRadius = Math.hypot(radius, halfHeight)
	return target
}

// Near and far planes of a cascade camera placed `sphereRadius + margin`
// toward the light from the sphere center.
export function getCascadeDepthRange(sphereRadius, casterMargin) {
	return { near: 0, far: sphereRadius * 2 + casterMargin }
}

export function snapToTexel(value, texelSize) {
	return Math.round(value / texelSize) * texelSize
}

// Angle in radians between two unit directions.
export function getLightAngle(a, b) {
	const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
	return Math.acos(Math.min(Math.max(dot, -1), 1))
}

export function hasLightDirectionChanged(previous, next, threshold) {
	if (!previous) return true
	return getLightAngle(previous, next) > threshold
}

// Cascades with an interval above 1 render on staggered frames, so two
// cascades with the same interval never render on the same frame. `forced`
// (new light basis or settings) renders every cascade.
export function shouldRenderCascade(frame, index, interval, forced = false) {
	if (forced || interval <= 1) return true
	return (frame + index) % interval === 0
}

// Cloud shadows (src/cloudShadows.js). Clouds float above every receiver, so
// instead of depth cascades they render into one light-aligned coverage map:
// a receiver is shadowed by however much of its ray toward the light a cloud
// covers. The map is blurred once per render and sampled with one tap. Clouds
// never move but turn to face the airplane, so their silhouettes change with
// travel: the map renders again when the airplane travels `recenterShare` of
// the radius, the light turns past the scenery shadows' `lightThreshold`, the
// cloud field regenerates, or the settings change.
//
// Per device: `radius` of the covered disk (world units) and `mapSize`
// (texels).
export const CLOUD_SHADOW_PRESETS = Object.freeze({
	desktop: Object.freeze({ radius: 1100, mapSize: 1024 }),
	mobile: Object.freeze({ radius: 800, mapSize: 512 }),
})

export const CLOUD_SHADOW_DEFAULTS = Object.freeze({
	enabled: true,
	// Share of the direct light a fully covered pixel loses.
	strength: 0.55,
	// Penumbra (blur half-width) in world units.
	softness: 6,
	// Small, so shadows follow the clouds turning (about 16 units on desktop).
	recenterShare: 0.015,
	// Receiver heights the map must contain: terrain and the scenery on the
	// highest peaks, all below the cloud layer.
	heightRange: Object.freeze({ min: -2, max: 120 }),
	// Largest blur half-width in texels; the blur shader loops this far.
	maxBlurTexels: 8,
})

export function createCloudShadowSettings({ isMobile = false } = {}) {
	const preset = isMobile ? CLOUD_SHADOW_PRESETS.mobile : CLOUD_SHADOW_PRESETS.desktop
	return {
		enabled: CLOUD_SHADOW_DEFAULTS.enabled,
		strength: CLOUD_SHADOW_DEFAULTS.strength,
		softness: CLOUD_SHADOW_DEFAULTS.softness,
		recenterShare: CLOUD_SHADOW_DEFAULTS.recenterShare,
		heightRange: { ...CLOUD_SHADOW_DEFAULTS.heightRange },
		radius: preset.radius,
		mapSize: preset.mapSize,
	}
}

// Bounding sphere of the covered disk around the airplane (no forward shift:
// the map covers every direction). Same shape as a cascade, so the
// orthographic box keeps a constant size for any light direction.
export function getCloudShadowSphere(planeX, planeZ, settings, target = {}) {
	return getCascadeSphere(
		planeX,
		planeZ,
		0,
		0,
		{ radius: settings.radius, forwardShift: 0 },
		settings,
		target,
	)
}

// Blur half-width in texels for a penumbra of `softness` world units.
export function getCloudShadowBlurTexels(
	softness,
	texelSize,
	maxTexels = CLOUD_SHADOW_DEFAULTS.maxBlurTexels,
) {
	if (!(texelSize > 0)) return 0
	return Math.min(Math.max(softness / texelSize, 0), maxTexels)
}

// True when the map must render again around (x, z). `center` is the [x, z]
// of the last render, or null before the first one.
export function shouldRenderCloudShadow({
	center,
	x,
	z,
	recenterDistance,
	lightChanged = false,
	revisionChanged = false,
	forced = false,
}) {
	if (forced || lightChanged || revisionChanged || !center) return true
	return Math.hypot(x - center[0], z - center[1]) > recenterDistance
}
