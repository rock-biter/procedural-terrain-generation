// Time of day is a unit value: 0 = midnight, 0.5 = noon; on a flat horizon
// 0.25 = sunrise and 0.75 = sunset. Colors are sRGB triplets in [0, 1]; the
// runtime converts them into the renderer working color space.
//
// The world is drawn curved (radius CURVATURE in chunk.js), so the visible
// horizon sits `dip` below the horizontal. Keyframe times are authored for a
// flat horizon and remapped (palette time) so they follow the apparent
// sunrise and sunset at any altitude.

const TWO_PI = Math.PI * 2

// The dusk keyframe keeps the original static sky (fog #191362, atmosphere
// ceiling of linear (0.1, 0.015, 0.02)) with a cool moon light. Sun and
// ambient intensities are relative to their params peaks; moon intensity is
// relative to params.moonLight. At night the moon stays at full strength and
// ambient light is kept very low so directional moonlight reveals the relief.
// Trail tints color the unlit wing trails: pink at dawn, orange at sunset, and
// blue at night, bright enough to stay readable against the sky.
const DAY_NIGHT_KEYFRAMES = Object.freeze([
	Object.freeze({
		name: 'Midnight',
		t: 0,
		zenith: [0.008, 0.012, 0.04],
		horizon: [0.035, 0.045, 0.11],
		sunColor: [1, 0.6, 0.35],
		sunIntensity: 0.7,
		moonColor: [0.6, 0.7, 1],
		moonIntensity: 1,
		ambientColor: [0.45, 0.5, 0.85],
		ambientIntensity: 0.06,
		atmosphere: [0.1, 0.11, 0.2],
		trailTint: [0.45, 0.6, 1],
		stars: 1,
		night: 1,
	}),
	Object.freeze({
		name: 'Pre-dawn',
		t: 0.21,
		zenith: [0.03, 0.04, 0.12],
		horizon: [0.25, 0.18, 0.3],
		sunColor: [1, 0.55, 0.35],
		sunIntensity: 0.6,
		moonColor: [0.6, 0.7, 1],
		moonIntensity: 0.8,
		ambientColor: [0.55, 0.5, 0.8],
		ambientIntensity: 0.12,
		atmosphere: [0.3, 0.22, 0.34],
		trailTint: [0.75, 0.6, 0.95],
		stars: 0.5,
		night: 0.8,
	}),
	Object.freeze({
		name: 'Sunrise',
		t: 0.28,
		zenith: [0.2, 0.3, 0.55],
		horizon: [0.95, 0.55, 0.35],
		sunColor: [1, 0.65, 0.4],
		sunIntensity: 0.7,
		moonColor: [0.6, 0.7, 1],
		moonIntensity: 0.4,
		ambientColor: [0.9, 0.7, 0.65],
		ambientIntensity: 0.8,
		atmosphere: [0.6, 0.42, 0.38],
		trailTint: [1, 0.62, 0.7],
		stars: 0,
		night: 0.2,
	}),
	Object.freeze({
		name: 'Morning',
		t: 0.36,
		zenith: [0.22, 0.45, 0.85],
		horizon: [0.65, 0.78, 0.92],
		sunColor: [1, 0.95, 0.85],
		sunIntensity: 1,
		moonColor: [0.6, 0.7, 1],
		moonIntensity: 0.3,
		ambientColor: [0.85, 0.9, 1],
		ambientIntensity: 1,
		atmosphere: [0.55, 0.66, 0.8],
		trailTint: [1, 0.93, 0.9],
		stars: 0,
		night: 0,
	}),
	Object.freeze({
		name: 'Noon',
		t: 0.5,
		zenith: [0.15, 0.4, 0.85],
		horizon: [0.7, 0.82, 0.95],
		sunColor: [1, 1, 0.97],
		sunIntensity: 1.1,
		moonColor: [0.6, 0.7, 1],
		moonIntensity: 0.3,
		ambientColor: [0.85, 0.92, 1],
		ambientIntensity: 1.05,
		atmosphere: [0.6, 0.72, 0.86],
		trailTint: [1, 1, 1],
		stars: 0,
		night: 0,
	}),
	Object.freeze({
		name: 'Afternoon',
		t: 0.64,
		zenith: [0.2, 0.42, 0.82],
		horizon: [0.72, 0.76, 0.86],
		sunColor: [1, 0.92, 0.8],
		sunIntensity: 1,
		moonColor: [0.6, 0.7, 1],
		moonIntensity: 0.3,
		ambientColor: [0.9, 0.88, 0.95],
		ambientIntensity: 1,
		atmosphere: [0.6, 0.64, 0.76],
		trailTint: [1, 0.95, 0.88],
		stars: 0,
		night: 0,
	}),
	Object.freeze({
		name: 'Sunset',
		t: 0.72,
		zenith: [0.25, 0.25, 0.5],
		horizon: [1, 0.45, 0.25],
		sunColor: [1, 0.55, 0.3],
		sunIntensity: 0.75,
		moonColor: [0.6, 0.7, 1],
		moonIntensity: 0.4,
		ambientColor: [0.9, 0.6, 0.6],
		ambientIntensity: 0.8,
		atmosphere: [0.55, 0.3, 0.25],
		trailTint: [1, 0.6, 0.35],
		stars: 0,
		night: 0.2,
	}),
	Object.freeze({
		name: 'Dusk',
		t: 0.8,
		zenith: [0.04, 0.03, 0.18],
		horizon: [25 / 255, 19 / 255, 98 / 255],
		sunColor: [1, 0.5, 0.3],
		sunIntensity: 0.6,
		moonColor: [0.7, 0.78, 1],
		moonIntensity: 1,
		ambientColor: [0.75, 0.75, 0.95],
		ambientIntensity: 0.15,
		atmosphere: [0.349, 0.128, 0.152],
		trailTint: [0.55, 0.62, 1],
		stars: 0.6,
		night: 0.7,
	}),
])

export const DAY_NIGHT_DEFAULTS = Object.freeze({
	cycleDuration: 240,
	startTimeOfDay: 0.3,
	// Tilts the celestial arc toward +Z so the sun crosses the initial view.
	orbitTilt: 0.5,
	// Sun/moon light fades in over this apparent-elevation band, in radians.
	lightFadeStart: -0.03,
	lightFadeEnd: 0.05,
	// Angular falloff of the sky gradient above the curved edge, in radians:
	// about 63% of the way from horizon to zenith color at this elevation.
	skyGradientHeight: 0.095,
	keyframes: DAY_NIGHT_KEYFRAMES,
})

export const DAY_NIGHT_COLOR_FIELDS = Object.freeze([
	'zenith',
	'horizon',
	'sunColor',
	'moonColor',
	'ambientColor',
	'atmosphere',
	'trailTint',
])
export const DAY_NIGHT_SCALAR_FIELDS = Object.freeze([
	'sunIntensity',
	'moonIntensity',
	'ambientIntensity',
	'stars',
	'night',
])

function clampUnit(value) {
	return Math.max(0, Math.min(value, 1))
}

function smoothstep(value) {
	const clampedValue = clampUnit(value)
	return clampedValue * clampedValue * (3 - 2 * clampedValue)
}

export function wrapTimeOfDay(timeOfDay) {
	const wrapped = timeOfDay - Math.floor(timeOfDay)
	// Guards against -1e-17 style inputs rounding up to exactly 1.
	return wrapped >= 1 ? 0 : wrapped
}

export function advanceTimeOfDay(timeOfDay, deltaSeconds, cycleDuration) {
	if (!(cycleDuration > 0)) return wrapTimeOfDay(timeOfDay)
	return wrapTimeOfDay(timeOfDay + deltaSeconds / cycleDuration)
}

// Angle below the horizontal of the curved world's visible edge, seen from
// `height` above sea level on a sphere of radius `curvature`.
export function getHorizonDip(height, curvature) {
	if (!(curvature > 0)) return 0
	const clampedHeight = Math.max(height, 0)
	return Math.acos(curvature / (curvature + clampedHeight))
}

// Elevation above the visible (dipped) horizon, in radians.
export function getApparentElevation(directionY, dip) {
	return Math.asin(Math.max(-1, Math.min(directionY, 1))) + dip
}

// Stretches the apparent day [sunrise, sunset] onto [0.25, 0.75] and the night
// onto the rest, so flat-horizon keyframes stay aligned with the sun on the
// curved horizon. Continuous, monotonic, and the identity when dip is 0.
export function getPaletteTime(
	timeOfDay,
	dip,
	tilt = DAY_NIGHT_DEFAULTS.orbitTilt,
) {
	const wrapped = wrapTimeOfDay(timeOfDay)
	const ratio = Math.min(Math.sin(Math.max(dip, 0)) / Math.cos(tilt), 0.999)
	const shift = Math.asin(ratio) / TWO_PI
	const sunrise = 0.25 - shift
	const sunset = 0.75 + shift

	if (wrapped >= sunrise && wrapped <= sunset) {
		return 0.25 + ((wrapped - sunrise) * 0.5) / (sunset - sunrise)
	}
	const nightTime = wrapped < sunrise ? wrapped + 1 : wrapped
	return wrapTimeOfDay(
		0.75 + ((nightTime - sunset) * 0.5) / (sunrise + 1 - sunset),
	)
}

// Inverse of getPaletteTime(): the time of day whose palette time is
// `paletteTime` at this dip.
export function getTimeOfDayForPaletteTime(
	paletteTime,
	dip,
	tilt = DAY_NIGHT_DEFAULTS.orbitTilt,
) {
	const wrapped = wrapTimeOfDay(paletteTime)
	const ratio = Math.min(Math.sin(Math.max(dip, 0)) / Math.cos(tilt), 0.999)
	const shift = Math.asin(ratio) / TWO_PI
	const sunrise = 0.25 - shift
	const sunset = 0.75 + shift

	if (wrapped >= 0.25 && wrapped <= 0.75) {
		return sunrise + ((wrapped - 0.25) * (sunset - sunrise)) / 0.5
	}
	const nightPalette = wrapped < 0.25 ? wrapped + 1 : wrapped
	return wrapTimeOfDay(
		sunset + ((nightPalette - 0.75) * (sunrise + 1 - sunset)) / 0.5,
	)
}

// Mutable deep copy of the keyframes, for live palette editing.
export function createDayNightPalette(keyframes = DAY_NIGHT_KEYFRAMES) {
	return keyframes.map((keyframe) => copyKeyframe(keyframe, {}))
}

// Writes `source` into `target` in place, reusing its color arrays.
export function copyKeyframe(source, target) {
	target.name = source.name
	target.t = source.t
	for (const field of DAY_NIGHT_COLOR_FIELDS) {
		target[field] ??= [0, 0, 0]
		for (let channel = 0; channel < 3; channel++) {
			target[field][channel] = source[field][channel]
		}
	}
	for (const field of DAY_NIGHT_SCALAR_FIELDS) target[field] = source[field]
	return target
}

export function createDayNightState() {
	const state = {
		timeOfDay: 0,
		paletteTime: 0,
		horizonDip: 0,
		sunDirection: [0, 0, 0],
		moonDirection: [0, 0, 0],
		sunElevation: 0,
		moonElevation: 0,
	}
	for (const field of DAY_NIGHT_COLOR_FIELDS) state[field] = [0, 0, 0]
	for (const field of DAY_NIGHT_SCALAR_FIELDS) state[field] = 0
	return state
}

export function getCelestialDirections(
	timeOfDay,
	tilt = DAY_NIGHT_DEFAULTS.orbitTilt,
	out = { sun: [0, 0, 0], moon: [0, 0, 0] },
) {
	// Sun rises at +X, peaks at noon, sets at -X; the moon stays opposite.
	const angle = TWO_PI * (wrapTimeOfDay(timeOfDay) - 0.25)
	const x = Math.cos(angle)
	const y = Math.sin(angle) * Math.cos(tilt)
	const z = Math.sin(angle) * Math.sin(tilt)
	out.sun[0] = x
	out.sun[1] = y
	out.sun[2] = z
	out.moon[0] = -x
	out.moon[1] = -y
	out.moon[2] = -z
	return out
}

function findSegment(timeOfDay, keyframes) {
	const count = keyframes.length
	for (let index = count - 1; index >= 0; index--) {
		if (keyframes[index].t <= timeOfDay) {
			const from = keyframes[index]
			const to = keyframes[(index + 1) % count]
			const end = index === count - 1 ? to.t + 1 : to.t
			return { from, to, blend: (timeOfDay - from.t) / (end - from.t) }
		}
	}
	// Before the first keyframe: interpolate from the last one across midnight.
	const from = keyframes[count - 1]
	const to = keyframes[0]
	return {
		from,
		to,
		blend: (timeOfDay + 1 - from.t) / (to.t + 1 - from.t),
	}
}

export function getDayNightState(
	timeOfDay,
	options = DAY_NIGHT_DEFAULTS,
	out = createDayNightState(),
	dip = 0,
) {
	const wrapped = wrapTimeOfDay(timeOfDay)
	const paletteTime = getPaletteTime(wrapped, dip, options.orbitTilt)
	const { from, to, blend } = findSegment(paletteTime, options.keyframes)
	const weight = smoothstep(blend)

	out.timeOfDay = wrapped
	out.paletteTime = paletteTime
	out.horizonDip = dip
	for (const field of DAY_NIGHT_COLOR_FIELDS) {
		const target = out[field]
		for (let channel = 0; channel < 3; channel++) {
			target[channel] =
				from[field][channel] +
				(to[field][channel] - from[field][channel]) * weight
		}
	}
	for (const field of DAY_NIGHT_SCALAR_FIELDS) {
		out[field] = from[field] + (to[field] - from[field]) * weight
	}

	getCelestialDirections(wrapped, options.orbitTilt, {
		sun: out.sunDirection,
		moon: out.moonDirection,
	})

	// Each body lights the world only while above the apparent horizon; the
	// terrain shader adds a per-fragment terminator on the curved surface.
	const fadeRange = options.lightFadeEnd - options.lightFadeStart
	out.sunElevation = getApparentElevation(out.sunDirection[1], dip)
	out.moonElevation = getApparentElevation(out.moonDirection[1], dip)
	out.sunIntensity *= smoothstep(
		(out.sunElevation - options.lightFadeStart) / fadeRange,
	)
	out.moonIntensity *= smoothstep(
		(out.moonElevation - options.lightFadeStart) / fadeRange,
	)

	return out
}

export function parseTimeOfDay(urlParams) {
	const raw = urlParams.get('time')
	if (raw === null || raw.trim() === '') return null
	const value = Number(raw)
	if (!Number.isFinite(value) || value < 0 || value > 1) return null
	return wrapTimeOfDay(value)
}
