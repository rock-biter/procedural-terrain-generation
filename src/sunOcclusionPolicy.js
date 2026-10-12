import { SEA_SURFACE_Y } from './chunkGeometry.js'
import { getCurvatureDrop } from './chunkPolicy.js'
import { clamp01, smoothstep } from './math.js'

// Pure rules for the low-sun terrain occlusion (src/sunOcclusion.js). The
// scenery shadow maps live in flat world space, so they fade out with a low
// light and cannot exist once the sun sinks below the flat horizon, while the
// curvature still shows it above the edge. Meanwhile the islands would leave
// the sea's glare on in the very spots they hide from the sun. So, while the
// sun is low, the terrain renders a top-down height map around the airplane
// and every terrain pixel marches toward the sun over it, in the world as
// drawn (flat XZ, lowered by the curvature around the airplane), to find
// whether the relief hides the sun. The result removes the sun's glare (its
// direct specular) and, optionally, part of its diffuse light.

// Must not exceed the loop bound the shader is compiled with.
export const SUN_OCCLUSION_MAX_STEPS = 32

// Per device: `radius` of the square window (world units, half its side),
// `mapSize` (texels), `segments` of each chunk's grid in the map (powers of
// two that divide every chunk grid, or the chunk's own when coarser), the
// march's `steps`, and its `reach` (world units toward the sun).
export const SUN_OCCLUSION_PRESETS = Object.freeze({
	desktop: Object.freeze({ radius: 2048, mapSize: 1024, segments: 32, steps: 12, reach: 1600 }),
	mobile: Object.freeze({ radius: 1536, mapSize: 512, segments: 16, steps: 6, reach: 1200 }),
})

export const SUN_OCCLUSION_DEFAULTS = Object.freeze({
	enabled: true,
	// Share of the sun's glare (its direct specular) the relief can hide.
	specular: 1,
	// Share of the sun's diffuse light it can hide: the long shadows of a low
	// sun. 0 keeps the diffuse lighting as the shadow maps leave it.
	diffuse: 0,
	// Flat elevation of the sun (radians) below which the march runs at full
	// strength, and above which it stops. The band overlaps the shadow maps'
	// fade-in (SCENERY_SHADOW_DEFAULTS.elevationFade), so one takes over
	// from the other.
	elevation: Object.freeze({ full: 0.15, end: 0.3 }),
	// Half-width of the penumbra, as the slope of the clearance over the relief.
	penumbra: 0.02,
	// Distance of the first sample (world units); later ones spread
	// quadratically up to the preset's reach.
	firstStep: 4,
	// Glare cone: without diffuse occlusion, only pixels whose view ray is
	// within this cosine of the sun march. The glare of a rough surface needs
	// a view toward the light: 60 degrees away its Fresnel term is already
	// down to about 0.07.
	cone: 0.5,
	// Share of the radius the window moves toward the sun, where the march goes.
	sunShift: 0.25,
	// Share of the radius the window moves before the map renders again.
	recenterShare: 0.05,
	// Fewest frames between two renders for new chunks, which arrive in bursts.
	minFrames: 15,
})

export function createSunOcclusionSettings({ isMobile = false } = {}) {
	const preset = isMobile ? SUN_OCCLUSION_PRESETS.mobile : SUN_OCCLUSION_PRESETS.desktop
	return {
		enabled: SUN_OCCLUSION_DEFAULTS.enabled,
		specular: SUN_OCCLUSION_DEFAULTS.specular,
		diffuse: SUN_OCCLUSION_DEFAULTS.diffuse,
		elevation: { ...SUN_OCCLUSION_DEFAULTS.elevation },
		penumbra: SUN_OCCLUSION_DEFAULTS.penumbra,
		firstStep: SUN_OCCLUSION_DEFAULTS.firstStep,
		cone: SUN_OCCLUSION_DEFAULTS.cone,
		sunShift: SUN_OCCLUSION_DEFAULTS.sunShift,
		recenterShare: SUN_OCCLUSION_DEFAULTS.recenterShare,
		minFrames: SUN_OCCLUSION_DEFAULTS.minFrames,
		...preset,
	}
}

// The height the map stores 0 for, as a GLSL float: the drawn sea, so a
// cleared texel is sea. Caster and receivers share it.
export const SUN_OCCLUSION_HEIGHT_DEFINES = Object.freeze({
	SUN_OCCLUSION_HEIGHT_BASE: `(${SEA_SURFACE_Y.toFixed(1)})`,
})

// Material defines of a receiver: the march's step count (a compile-time loop
// bound, so part of the program cache key) and the map's height base.
export function getSunOcclusionDefines(steps) {
	if (!Number.isInteger(steps) || steps < 1 || steps > SUN_OCCLUSION_MAX_STEPS) {
		throw new RangeError(
			`Sun occlusion steps must be an integer from 1 to ${SUN_OCCLUSION_MAX_STEPS}: ${steps}`,
		)
	}
	return { SUN_OCCLUSION_STEPS: steps, ...SUN_OCCLUSION_HEIGHT_DEFINES }
}

// Shares of the sun's glare and diffuse light the march can hide, faded by
// the sun's flat elevation (unit [x, y, z] toward the sun). Both are 0 when
// the occlusion is off or the sun gives no light (`sunIntensity`, the day/night
// cycle's factor). Writes into `out`.
export function getSunOcclusionStrength(settings, sunDirection, sunIntensity, out = {}) {
	let fade = 0
	if (settings.enabled && sunIntensity > 0) {
		const { full, end } = settings.elevation
		const elevation = Math.asin(Math.min(Math.max(sunDirection[1], -1), 1))
		fade = 1 - smoothstep(full, Math.max(end, full + 1e-3), elevation)
	}
	out.specular = clamp01(settings.specular) * fade
	out.diffuse = clamp01(settings.diffuse) * fade
	return out
}

// Square window of the map around the airplane at (x, z), moved
// `sunShift` of the radius toward the sun and snapped to whole texels, so maps
// rendered at nearby centers sample the same heights.
export function getSunOcclusionWindow(x, z, sunDirection, settings, target = {}) {
	const texel = (settings.radius * 2) / settings.mapSize
	const horizontal = Math.hypot(sunDirection[0], sunDirection[2])
	const shift = horizontal > 1e-6 ? (settings.radius * settings.sunShift) / horizontal : 0
	target.x = Math.round((x + sunDirection[0] * shift) / texel) * texel
	target.z = Math.round((z + sunDirection[2] * shift) / texel) * texel
	target.halfSize = settings.radius
	target.texel = texel
	return target
}

// True when a square chunk centered on (centerX, centerZ), of half side
// `halfSize`, overlaps the window.
export function chunkIntersectsSunOcclusionWindow(centerX, centerZ, halfSize, window) {
	const reach = halfSize + window.halfSize
	return Math.abs(centerX - window.x) <= reach && Math.abs(centerZ - window.z) <= reach
}

// True when a chunk rises above the drawn sea, the map's cleared height:
// `top` is the highest point its flat box can reach.
export function chunkRisesAboveSea(top) {
	return top > SEA_SURFACE_Y + 1e-3
}

// Grid of a chunk in the map: the requested segments, or the chunk's own
// where it is coarser (far chunks).
export function getSunOcclusionSegments(requested, chunkSegments) {
	return Math.min(requested, chunkSegments)
}

// True when the map must render again. `center` is the [x, z] of the last
// rendered window, or null before the first one; (x, z) is the current one.
// New casters wait `minFrames` since the last render, so a burst of chunk
// commits renders once.
export function shouldRenderSunOcclusion({
	center,
	x,
	z,
	recenterDistance,
	castersChanged = false,
	forced = false,
	framesSinceRender = Infinity,
	minFrames = 0,
}) {
	if (forced || !center) return true
	if (Math.hypot(x - center[0], z - center[1]) > recenterDistance) return true
	return castersChanged && framesSinceRender >= minFrames
}

// Distance of march sample `index` of `steps` (sun-occlusion-pars-fragment.glsl):
// from `firstStep` toward `reach`, spaced quadratically, so near relief is
// sampled densely and far islands are still met. `jitter` in [0, 1) is the
// per-pixel offset of every sample.
export function getSunOcclusionStepDistance(index, steps, jitter, firstStep, reach) {
	const t = (index + jitter) / steps
	return firstStep + (reach - firstStep) * t * t
}

// CPU twin of getSunOcclusionVisibility() in sun-occlusion-pars-fragment.glsl,
// for the tests: the visibility in [0, 1] of the sun from the flat surface
// point (x, y, z), with the eye (the curvature's center) at `eye` [x, y, z].
// `sampleHeight(x, z)` gives the flat surface height the map would store
// (never below the drawn sea).
export function getSunOcclusionVisibility({
	x,
	y,
	z,
	eye,
	sunDirection,
	sampleHeight,
	curvature,
	steps,
	firstStep,
	reach,
	penumbra,
	jitter = 0.5,
}) {
	const [sunX, sunY, sunZ] = sunDirection
	const horizontal = Math.hypot(sunX, sunZ)
	if (horizontal < 1e-4) return 1
	const directionX = sunX / horizontal
	const directionZ = sunZ / horizontal
	const rise = sunY / horizontal
	const eyeDistance = Math.hypot(x - eye[0], y - eye[1], z - eye[2])
	const originY = Math.max(y, sampleHeight(x, z)) - getCurvatureDrop(eyeDistance, curvature)
	let clearance = 1
	for (let index = 0; index < steps; index++) {
		const distance = getSunOcclusionStepDistance(index, steps, jitter, firstStep, reach)
		const sampleX = x + directionX * distance
		const sampleZ = z + directionZ * distance
		const height = sampleHeight(sampleX, sampleZ)
		const drop = getCurvatureDrop(
			Math.hypot(sampleX - eye[0], height - eye[1], sampleZ - eye[2]),
			curvature,
		)
		clearance = Math.min(clearance, (originY + distance * rise - (height - drop)) / distance)
		if (clearance < -penumbra) break
	}
	return smoothstep(-penumbra, penumbra, clearance)
}
