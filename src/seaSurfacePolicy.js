// Pure rules of the moving sea surface (three-free): the waves, the ripples
// of the sea's normal map, the whitecaps, and the coast's foam lines, drawn by
// the terrain shader (sea-surface-pars.glsl, sea-ripple-pars-fragment.glsl,
// color-fragment.glsl) with the uniforms of updateSeaSurfaceUniforms()
// (src/sharedUniforms.js), and the boats that float on the waves.
//
// - Two sea types share the model with their own settings: the sea (index 0)
//   and the deep ocean (index 1). The shader blends them across the deep
//   ocean's border, over `oceanBlend` of the deep ocean field inside it, so
//   the boats, which keep out of the deep ocean, only ever float on the sea.
// - The waves are SEA_WAVE_COUNT Gerstner waves per type, derived from a few
//   settings (getSeaWaveComponents()): the dominant `wavelength`, the
//   `amplitude` (world units, the highest crest when every wave peaks
//   together), the `steepness` (0 to 1, how far the crests sharpen, reached in
//   the roughest regions), the wind `direction` and the `spread` of the
//   components around it (degrees), and the `speed` multiplier of the deep
//   water dispersion ω = √(g k), so longer waves travel faster.
// - Regions: a slow noise field (wavelength `regions.scale`, sharpened by
//   `contrast`, drifting at `drift` units per second toward `direction`)
//   sets a sea state from 0 (calm) to 1 (rough). Each type scales its waves
//   from `calm` to `rough` times their amplitude by it.
// - The waves fade toward the coast, from nothing at `coast.start` units of
//   depth to full at `coast.full`, and under the frozen sea.
// - Vertices move only within `vertex.fadeStart` to `vertex.fadeEnd` world
//   units (horizontal) of the airplane, inside the LOD 0 block (at least one
//   chunk, 256 units, around the airplane's chunk), so moved vertices never
//   meet a coarser neighbour's T-junctions. Beyond, the waves live in the
//   normals alone.
// - Ripples: the sea's ribbed normal map snakes across its ribs, by
//   `amplitude` world units, with crests `wavelength` units apart along the
//   ribs, travelling at `speed` units per second, its phase broken by a noise
//   (`irregularity` radians, `irregularityScale` per world unit). The map's
//   strength grows with the sea state by up to ± `stateStrength`.
// - Whitecaps foam where the crests squeeze the surface by more than
//   `threshold` (at most the steepness), over `softness`, broken by a noise of
//   `scale` per world unit, up to `intensity`.
// - Foam lines: the coast's animated contour lines (getSeaRipple()), from
//   `start` to `full` and from `fadeStart` to `end` units of depth,
//   `frequency` lines per unit of depth moving at `speed`, sharpened by the
//   power `sharpness`, `intensity` bright, wobbling by `wobbleAmount` radians
//   at `wobbleFrequency` per world unit, and broken into dashes by a noise of
//   `dashScale` per world unit weighted by `dashAmount`. The sea state scales
//   them by up to ± `stateBoost`.
// - `foamColor` (sRGB) colors the lines and the whitecaps; `debugView` paints
//   the sea with one of SEA_SURFACE_DEBUG_VIEWS.

export const SEA_TYPES = Object.freeze(['sea', 'ocean'])
export const SEA_WAVE_COUNT = 4
// Wavelength of each component relative to the dominant one; the amplitudes
// follow the same ratios.
export const SEA_WAVE_RATIOS = Object.freeze([1, 0.62, 0.38, 0.24])
// Direction of each component in units of the spread around the wind.
export const SEA_WAVE_ANGLES = Object.freeze([0, 0.45, -0.75, 1])
// Gravity of the dispersion, in world units per second squared.
export const SEA_GRAVITY = 9.81
// Boats store their depth (world units) in steps of this size (packBoatTint()
// in src/sceneryPlacement.js).
export const SEA_BOAT_DEPTH_STEP = 0.25

export const SEA_SURFACE_DEBUG_VIEWS = Object.freeze({
	none: 0,
	seaState: 1,
	oceanMask: 2,
	waveAmount: 3,
	crestSqueeze: 4,
})

const FOAM_LINE_DEFAULTS = Object.freeze({
	start: 3.5,
	full: 5,
	fadeStart: 6.5,
	end: 7.5,
	frequency: 8,
	speed: 4,
	sharpness: 4,
	intensity: 0.5,
	wobbleFrequency: 0.5,
	wobbleAmount: 1,
	dashScale: 0.05,
	dashAmount: 1,
	stateBoost: 0.3,
})

export const SEA_SURFACE_DEFAULTS = Object.freeze({
	regions: Object.freeze({ scale: 2500, contrast: 1.6, drift: 4, direction: 35 }),
	vertex: Object.freeze({ fadeStart: 140, fadeEnd: 200 }),
	oceanBlend: 0.05,
	foamColor: '#ffffff',
	debugView: SEA_SURFACE_DEBUG_VIEWS.none,
	sea: Object.freeze({
		waves: Object.freeze({
			amplitude: 0.7,
			wavelength: 32,
			steepness: 0.55,
			direction: 35,
			spread: 40,
			speed: 1,
			calm: 0.35,
			rough: 1.3,
		}),
		coast: Object.freeze({ start: 1.5, full: 10 }),
		ripples: Object.freeze({
			amplitude: 0.5,
			wavelength: 12,
			speed: 1.5,
			irregularity: 2,
			irregularityScale: 0.02,
			stateStrength: 0.35,
		}),
		whitecaps: Object.freeze({ threshold: 0.44, softness: 0.06, intensity: 0.6, scale: 0.12 }),
		foam: FOAM_LINE_DEFAULTS,
	}),
	ocean: Object.freeze({
		waves: Object.freeze({
			amplitude: 1.6,
			wavelength: 64,
			steepness: 0.7,
			direction: 35,
			spread: 30,
			speed: 1,
			calm: 0.3,
			rough: 1.6,
		}),
		coast: Object.freeze({ start: 1.5, full: 12 }),
		ripples: Object.freeze({
			amplitude: 0.7,
			wavelength: 18,
			speed: 2,
			irregularity: 2.5,
			irregularityScale: 0.015,
			stateStrength: 0.45,
		}),
		whitecaps: Object.freeze({ threshold: 0.5, softness: 0.06, intensity: 0.75, scale: 0.08 }),
		foam: FOAM_LINE_DEFAULTS,
	}),
})

const GROUPS = ['waves', 'coast', 'ripples', 'whitecaps', 'foam']

// A mutable copy of SEA_SURFACE_DEFAULTS (params.seaSurface).
export function createSeaSurfaceSettings(defaults = SEA_SURFACE_DEFAULTS) {
	const copyType = (type) => Object.fromEntries(GROUPS.map((group) => [group, { ...type[group] }]))
	return {
		regions: { ...defaults.regions },
		vertex: { ...defaults.vertex },
		oceanBlend: defaults.oceanBlend,
		foamColor: defaults.foamColor,
		debugView: defaults.debugView,
		sea: copyType(defaults.sea),
		ocean: copyType(defaults.ocean),
	}
}

// Copies every setting of `source` into `target` in place (both
// createSeaSurfaceSettings() shapes), so the GUI keeps its bindings.
export function copySeaSurfaceSettings(source, target) {
	Object.assign(target.regions, source.regions)
	Object.assign(target.vertex, source.vertex)
	target.oceanBlend = source.oceanBlend
	target.foamColor = source.foamColor
	target.debugView = source.debugView
	for (const type of SEA_TYPES) {
		for (const group of GROUPS) Object.assign(target[type][group], source[type][group])
	}
	return target
}

const degrees = Math.PI / 180

// The SEA_WAVE_COUNT Gerstner components of one type's `waves` settings:
// unit direction (x, z), wavenumber k, angular speed omega, amplitude (world
// units, summing to `amplitude`), and horizontal reach (world units at full
// steepness). Every component squeezes the surface by at most steepness /
// SEA_WAVE_COUNT (k × reach), so the crests never fold over.
export function getSeaWaveComponents(waves) {
	const ratioSum = SEA_WAVE_RATIOS.reduce((sum, ratio) => sum + ratio, 0)
	const steepness = Math.min(Math.max(waves.steepness, 0), 1)
	return SEA_WAVE_RATIOS.map((ratio, index) => {
		const angle = (waves.direction + SEA_WAVE_ANGLES[index] * waves.spread) * degrees
		const wavelength = Math.max(waves.wavelength * ratio, 1e-3)
		const k = (2 * Math.PI) / wavelength
		return {
			x: Math.cos(angle),
			z: Math.sin(angle),
			k,
			omega: Math.sqrt(SEA_GRAVITY * k) * waves.speed,
			amplitude: (waves.amplitude * ratio) / ratioSum,
			reach: steepness / (SEA_WAVE_COUNT * k),
		}
	})
}

// Largest displacement of the sea surface, vertical and horizontal, over both
// types and every sea state, for the terrain's culling bounds.
export function getSeaWaveBound(settings) {
	let vertical = 0
	let horizontal = 0
	for (const type of SEA_TYPES) {
		const { waves } = settings[type]
		const components = getSeaWaveComponents(waves)
		const scale = Math.max(waves.calm, waves.rough, 0)
		vertical = Math.max(vertical, Math.max(waves.amplitude, 0) * scale)
		horizontal = Math.max(
			horizontal,
			components.reduce((sum, { reach }) => sum + reach, 0),
		)
	}
	return { vertical, horizontal }
}

// Drift of the regions in world units per second, along x and z.
export function getSeaRegionDrift({ drift, direction }) {
	return [Math.cos(direction * degrees) * drift, Math.sin(direction * degrees) * drift]
}
