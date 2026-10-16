import { smoothstep } from './math.js'
import { NOISE_TILE_CELLS } from './noiseTexturePolicy.js'
import { cellRandom, hashSeed } from './random.js'

// Rules of the horizon clouds (src/horizonClouds.js, horizon-clouds-pars.glsl):
// banks of toon cumulus painted on a ring around the eye, sitting on the curved
// world's visible edge. The shaders draw them per view direction in angular
// coordinates: azimuth around the eye and elevation above the dipped edge,
// both in radians, so the ring follows the airplane and needs no geometry.
// Pure: no three.js, so the tests import it.
//
// Every layer samples the baked noise tile (src/noiseTexture.js) so that the
// ring has no seam. The bank layer runs along the horizon on a circle in the
// periodic tile, which closes over a turn at any size: where its noise passes
// the coverage threshold a bank rises as a dome, to a tower height from a
// second field. The billow octaves, a whole number of tiles per turn, add
// rounded lobes (the absolute value of the noise) that grow toward the tops.
// The wind turns the whole ring, the billows rise slowly, and every layer
// morphs by rotating between two independent noise channels; the coverage
// drifts over minutes ("weather"). Angles in the settings are in degrees.

const TWO_PI = Math.PI * 2
const DEGREE = Math.PI / 180

// Spread (standard deviation) of the tile's noise and the mean of its absolute
// value: gradient noise times NOISE_GAIN, matched to snoise() (about 0.47).
export const HORIZON_CLOUD_NOISE_SPREAD = 0.47
export const HORIZON_CLOUD_NOISE_ABS_MEAN = 0.37

// Billow octaves the shaders can evaluate (horizon-clouds-pars.glsl).
export const HORIZON_CLOUD_MAX_OCTAVES = 3

// Defines of horizon-clouds-pars.glsl, for every material that includes it
// (the sky, the aurora, the lens flare's occlusion): the billow lobes subtract
// the noise's mean absolute value, so they average to zero.
export const HORIZON_CLOUD_SHADER_DEFINES = Object.freeze({
	HORIZON_CLOUD_ABS_MEAN: HORIZON_CLOUD_NOISE_ABS_MEAN.toFixed(4),
})

// Coverage share range the threshold inverts, kept off 0 and 1 where the
// inverse is infinite.
const COVERAGE_LIMITS = Object.freeze([0.01, 0.99])

const WEATHER_SEED = hashSeed('horizon-clouds-weather')

export const HORIZON_CLOUD_DEFAULTS = Object.freeze({
	enabled: true,
	// Freezes the wind, the morphs, and the weather (debug).
	paused: false,
	// Scales the palette's cloud colors (cloudLit, cloudShade): the clouds glow
	// a little above the sky's white point before tone mapping.
	brightness: 1.25,
	// Noise cells per turn of the horizon along the bank circle (a bank is
	// about half a cell wide), and the billow octaves' tile repeats per turn,
	// whole numbers (non-multiples, so their lattices never line up).
	repeats: Object.freeze({ bank: 14, billows: Object.freeze([2, 5, 11]) }),
	// Share of the horizon the banks cover, drifting between `min` and `max`
	// over about `period` seconds, or held at `fixed` (?clouds=) unless null.
	coverage: Object.freeze({ min: 0.25, max: 0.7, period: 240, fixed: null }),
	// A bank rises as a dome where its noise passes the coverage threshold, to
	// its full height `rise` noise units above it; the full heights range from
	// `minTop` to `maxTop` (degrees above the flat base), and the base lies
	// `baseDepth` degrees below the visible edge, which the terrain covers.
	shape: Object.freeze({ rise: 0.5, minTop: 3, maxTop: 11, baseDepth: 0.8 }),
	// Lobe height of the first octave (degrees), each octave's share of the
	// previous one, and how much smaller the lobes are at the base than at the
	// top (0 alike, 1 none at the base).
	billows: Object.freeze({ amplitude: 3.2, gain: 0.42, topEmphasis: 0.5 }),
	// Wind (degrees per second around the ring), the billows' rise (degrees per
	// second), and the morph rates of the banks and billows (radians per
	// second).
	motion: Object.freeze({ wind: 0.12, rise: 0.02, bankMorph: 0.012, billowMorph: 0.035 }),
	// Outline softness (degrees), the extra softness of lost edges (a share,
	// varying along the banks), the dry-brush roughness (degrees), and the
	// antialias width in pixels.
	edges: Object.freeze({ softness: 0.1, lostEdges: 1.2, dryBrush: 0.05, antialias: 1.5 }),
	// Toon shading: the two band thresholds and their softness, the step
	// toward the light (degrees) and the depth inside the clouds at its end
	// where the shade is full (degrees), the lift of front-lit banks, the
	// darkening of backlit ones, and the extra light on the tops.
	light: Object.freeze({
		bands: Object.freeze([0.4, 0.72]),
		bandSoftness: 0.07,
		offset: 2.4,
		depth: 1.6,
		frontLift: 0.2,
		backDarken: 0.45,
		topBias: 0.15,
	}),
	// The silver lining around a light behind the clouds: strength, focus
	// (power of the lobe around the light), and width inside the outline
	// (degrees); `darkening` is the watercolor pigment just inside the edge.
	rim: Object.freeze({ strength: 1.4, focus: 10, width: 0.45, darkening: 0.06 }),
	// Aerial perspective toward the sky behind: the hazed height above the base
	// (degrees), its haze at the base and over the whole cloud, and the
	// watercolor wash (brightness variation).
	haze: Object.freeze({ height: 2.2, base: 0.8, overall: 0.06, wash: 0.07 }),
})

// Billow octaves per device, in the shape and in the light sample.
export const HORIZON_CLOUD_QUALITY = Object.freeze({
	desktop: Object.freeze({ octaves: 3, lightOctaves: 2 }),
	mobile: Object.freeze({ octaves: 2, lightOctaves: 1 }),
})

function clone(value) {
	if (Array.isArray(value)) return value.map(clone)
	if (value && typeof value === 'object') {
		return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]))
	}
	return value
}

// Mutable settings for params.horizonClouds, edited live by the ?gui=1 panel.
// `fixedCoverage` (parseHorizonCloudCoverage()) holds the coverage.
export function createHorizonCloudSettings({ isMobile = false, fixedCoverage = null } = {}) {
	const quality = isMobile ? HORIZON_CLOUD_QUALITY.mobile : HORIZON_CLOUD_QUALITY.desktop
	const settings = { ...clone(HORIZON_CLOUD_DEFAULTS), quality: { ...quality } }
	settings.coverage.fixed = fixedCoverage
	return settings
}

// Writes `source` into `target` in place (nested objects and arrays too), so
// the ?gui=1 controllers bound to `target` keep working after a reset.
export function copyHorizonCloudSettings(source, target) {
	for (const [key, value] of Object.entries(source)) {
		if (value && typeof value === 'object' && target[key] && typeof target[key] === 'object') {
			copyHorizonCloudSettings(value, target[key])
		} else {
			target[key] = clone(value)
		}
	}
	return target
}

// `?clouds=` fixes the coverage share (0 to 1) for QA and benchmarks; null
// without it.
export function parseHorizonCloudCoverage(urlParams) {
	const raw = urlParams?.get?.('clouds')
	if (raw === null || raw === undefined || raw === '') return null
	const value = Number(raw)
	return Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : null
}

// A whole number of tile repeats per turn, at least 1: the ring stays seamless.
export function getHorizonCloudRepeats(value) {
	return Math.max(1, Math.round(Number(value) || 1))
}

// Radius, in tile units, of the circle the bank layer follows so that a turn
// of the horizon crosses `cells` noise cells (NOISE_TILE_CELLS per tile).
export function getHorizonCloudBankRadius(cells) {
	return Math.max(Number(cells) || 0, 1) / (2 * Math.PI * NOISE_TILE_CELLS)
}

// Octave counts within what the shaders evaluate; the light sample never uses
// more than the shape. Written into `out`.
export function getHorizonCloudOctaves({ octaves, lightOctaves }, out = {}) {
	out.octaves = Math.min(Math.max(Math.round(octaves), 1), HORIZON_CLOUD_MAX_OCTAVES)
	out.lightOctaves = Math.min(Math.max(Math.round(lightOctaves), 0), out.octaves)
	return out
}

// Inverse error function (Giles 2012), for the coverage threshold.
function inverseErf(x) {
	let w = -Math.log((1 - x) * (1 + x))
	let p
	if (w < 5) {
		w -= 2.5
		p = 2.81022636e-8
		p = 3.43273939e-7 + p * w
		p = -3.5233877e-6 + p * w
		p = -4.39150654e-6 + p * w
		p = 0.00021858087 + p * w
		p = -0.00125372503 + p * w
		p = -0.00417768164 + p * w
		p = 0.246640727 + p * w
		p = 1.50140941 + p * w
	} else {
		w = Math.sqrt(w) - 3
		p = -0.000200214257
		p = 0.000100950558 + p * w
		p = 0.00134934322 + p * w
		p = -0.00367342844 + p * w
		p = 0.00573950773 + p * w
		p = -0.0076224613 + p * w
		p = 0.00943887047 + p * w
		p = 1.00167406 + p * w
		p = 2.83297682 + p * w
	}
	return p * x
}

// The bank noise value above which a bank stands, so about `coverage` of the
// horizon is covered: the noise is close to normal with the tile's spread.
export function getCoverageThreshold(coverage, spread = HORIZON_CLOUD_NOISE_SPREAD) {
	const share = Math.min(Math.max(coverage, COVERAGE_LIMITS[0]), COVERAGE_LIMITS[1])
	return spread * Math.SQRT2 * inverseErf(1 - 2 * share)
}

// Smooth value noise over time in [0, 1]: two octaves of cells of `period`
// and about a third of it, eased between per-cell random values.
export function getHorizonCloudWeather(time, period, seedHash = WEATHER_SEED) {
	const octave = (t, salt) => {
		const cell = Math.floor(t)
		const from = cellRandom(seedHash, cell, 0, salt)
		const to = cellRandom(seedHash, cell + 1, 0, salt)
		return from + (to - from) * smoothstep(0, 1, t - cell)
	}
	const length = Math.max(period, 1e-3)
	const value = octave(time / length, 0) * 0.65 + octave((time / length) * 2.7 + 17.3, 1) * 0.35
	return Math.min(Math.max((value - 0.5) * 1.6 + 0.5, 0), 1)
}

// The coverage share at loop time `time` (seconds): the weather within the
// settings' range, or the `override` (?clouds=).
export function getHorizonCloudCoverage(time, { coverage }, override = null) {
	if (override !== null && override !== undefined) return override
	const weather = getHorizonCloudWeather(time, coverage.period)
	return coverage.min + (coverage.max - coverage.min) * weather
}

// The wind, the morphs, and the billows' rise, accumulated (not speed times
// time) and wrapped, so a live speed change never jumps and floats stay
// precise. `rise` holds each billow octave's offset in tile units.
export function createHorizonCloudMotion() {
	return {
		time: 0,
		wind: 0,
		bankMorph: 0,
		billowMorph: 0,
		rise: new Array(HORIZON_CLOUD_MAX_OCTAVES).fill(0),
	}
}

function wrap(value, period) {
	return value - Math.floor(value / period) * period
}

export function stepHorizonCloudMotion(motion, deltaSeconds, settings) {
	if (settings.paused || !(deltaSeconds > 0)) return motion
	const { wind, rise, bankMorph, billowMorph } = settings.motion
	motion.time += deltaSeconds
	motion.wind = wrap(motion.wind + wind * DEGREE * deltaSeconds, TWO_PI)
	motion.bankMorph = wrap(motion.bankMorph + bankMorph * deltaSeconds, TWO_PI)
	motion.billowMorph = wrap(motion.billowMorph + billowMorph * deltaSeconds, TWO_PI)
	const { billows } = settings.repeats
	for (let index = 0; index < motion.rise.length; index++) {
		const tilesPerRadian = getHorizonCloudRepeats(billows[index]) / TWO_PI
		motion.rise[index] = wrap(motion.rise[index] + rise * DEGREE * deltaSeconds * tilesPerRadian, 1)
	}
	return motion
}

// Highest the billows can lift a top above its bank height, in radians: the
// first octave's amplitude over every octave's share, at the noise's clamp.
export function getHorizonCloudBillowReach({ billows }, octaves = HORIZON_CLOUD_MAX_OCTAVES) {
	let reach = 0
	let weight = 1
	for (let octave = 0; octave < octaves; octave++) {
		reach += weight
		weight *= billows.gain
	}
	return billows.amplitude * DEGREE * reach * (1 - HORIZON_CLOUD_NOISE_ABS_MEAN)
}

// Elevations above the visible edge, in radians, that no cloud pixel leaves:
// [lowest, highest], written into `out`. Conservative, so the shaders' early
// outs never cut one.
export function getHorizonCloudBand(settings, octaves = HORIZON_CLOUD_MAX_OCTAVES, out = [0, 0]) {
	const { shape, edges } = settings
	out[0] = -(shape.baseDepth + edges.softness * (1 + edges.lostEdges)) * DEGREE
	out[1] =
		Math.max(shape.minTop, shape.maxTop) * DEGREE +
		getHorizonCloudBillowReach(settings, octaves) +
		(edges.dryBrush + edges.softness) * DEGREE
	return out
}

// The light the clouds are shaded by, from a getDayNightState() result: the
// sun or the moon, whichever weighs more, and `contrast`, which reaches 0
// where they hand over, so the shading never pops. The sun lights the clouds a
// little below the edge (they stand far and high); the moon lights them
// weaker. Writes { light, direction, contrast } into `out`.
export function selectHorizonCloudLight(state, out = {}) {
	const sun = smoothstep(-0.15, 0, state.sunElevation)
	const moon = smoothstep(-0.1, 0.05, state.moonElevation) * 0.6
	const isSun = sun >= moon
	out.light = isSun ? 'sun' : 'moon'
	out.direction = isSun ? state.sunDirection : state.moonDirection
	out.contrast = Math.abs(sun - moon)
	return out
}
