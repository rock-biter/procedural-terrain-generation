import { SEA_SURFACE_Y } from './chunkGeometry.js'
import { clamp01, lerp, smoothstep } from './math.js'

// Pure rules of the airplane's wake on the sea (src/seaWake.js). While the
// airplane flies low over the water, a small square map centered on it runs
// a damped wave equation: every step the previous state scrolls by whole
// texels as the airplane moves, then the airplane stamps its track at the
// center, kicking the water and laying foam. The kicks pulse with the
// distance flown and the waves travel at a share of the airplane's speed, so
// the ripples open into a speedboat's V of constant angle. The sea reads the
// map for its vertices, normals, and foam (src/shaders/sea-wake-pars.glsl),
// the boats for their heave and tilt. A sponge border absorbs the ripples and
// every reader fades the wake radially, so it never ends on the map's edge.
// Three-free.

const degrees = Math.PI / 180

// `enabled` gates the whole wake. `shoreDepth` is the raw depth (world units
// below the water line) over which the wake comes in from the coast, both
// under the airplane (where it stamps) and on the sea it shades.
//
// altitude: height of the airplane above the drawn sea (SEA_SURFACE_Y) where
// it stamps at full strength (`full`) and no longer stamps (`none`); its
// floor over the sea is about 4 to 10, lower the calmer the sea
// (getSeaFlightClearance() in src/flightPolicy.js).
//
// steps: the wave advances at most `rate` times per second (0 every frame),
// by the flight time gathered since, so a 120 Hz screen steps it every other
// frame; each advance takes sub-steps of at most `maxStepTime` seconds, at
// most `maxSteps` of them.
//
// trail: the stamp. `impulse` is the height kick of a full-strength pass (the
// height is a share of the readers' amplitudes, about -1 to 1), `radius` its
// reach (world units, never under 1.5 texels). The kick pulses every
// `pulseSpacing` world units flown: `pulseMix` 0 is a steady downwash trough,
// 1 a pure oscillation. `foam` (0 to 1) is the trail's fresh foam within
// `foamRadius` world units of the track.
//
// waves: they run at sin(`angle`) times the airplane's speed, never slower
// than `minSpeed` (world units per second), so the V keeps `angle` degrees
// of half-angle at any speed; `maxCourant` (waves' texels per step, stable
// below 0.707) caps the speed instead when a step is too long. Their
// amplitude halves every `halfLife` seconds; within `spongeWidth` (share of
// the half-size, radially) of the map's edge it also falls by `spongeRate`
// per second, so the ripples die before the edge instead of reflecting.
//
// foam: the trail's foam halves every `halfLife` seconds and spreads at
// `spread` square world units per second; `intensity` scales it, `laceScale`
// is the frequency (per world unit) of the lace that opens holes in it as it
// ages, `fray` the ragged share of the crest lines' width.
//
// lines: ink strokes on the crests of the ripples, where their amplitude
// rises past `threshold` (height units), over `softness`; `halfWidth` in
// world units, `intensity` their opacity.
//
// shading: `vertexAmplitude` (world units per height unit) lifts the sea's
// vertices (0 skips the vertex lookup), `normalStrength` (the same, for the
// slopes) tilts its normals. The readers fade the wake radially from
// `fadeStart` to `fadeEnd` (shares of the half-size). `boatHeave` (world
// units per height unit) lifts the boats, `boatTilt` scales their tilt.
//
// occupancy: the CPU tracks a conservative rectangle of where the wake can
// be non-zero (getSeaWakeOccupiedRect()), in boxes opened every `interval`
// seconds and grown at the waves' speed, plus `marginTexels`; outside it the
// readers skip the lookup. A box is dropped once its waves and foam have
// decayed below `settleThreshold` of their stamp (getSeaWakeSettleTime()).
export const SEA_WAKE_DEFAULTS = Object.freeze({
	enabled: true,
	shoreDepth: 1.5,
	altitude: Object.freeze({ full: 14, none: 30 }),
	steps: Object.freeze({ rate: 60, maxStepTime: 1 / 50, maxSteps: 3 }),
	trail: Object.freeze({
		impulse: 2.5,
		radius: 2,
		pulseSpacing: 24,
		pulseMix: 0.75,
		foam: 1,
		foamRadius: 1.5,
	}),
	waves: Object.freeze({
		angle: 20,
		minSpeed: 8,
		maxCourant: 0.6,
		halfLife: 2,
		spongeWidth: 0.3,
		spongeRate: 10,
	}),
	foam: Object.freeze({ halfLife: 2.85, spread: 3.8, intensity: 1.8, laceScale: 0.33, fray: 0.35 }),
	lines: Object.freeze({ threshold: 0.3, softness: 0.246, halfWidth: 0.52, intensity: 1 }),
	shading: Object.freeze({
		vertexAmplitude: 0.8,
		normalStrength: 1.2,
		fadeStart: 0.6,
		fadeEnd: 0.95,
		boatHeave: 0.6,
		boatTilt: 1,
	}),
	occupancy: Object.freeze({ interval: 0.25, settleThreshold: 0.03, marginTexels: 3 }),
})

// Per device: `radius` (half the map's side, world units) and `mapSize`
// (texels per side), about 1.25 world units per texel on desktop and 1.9 on
// mobile, where the pulses are longer so the ripples keep about four texels
// per wavelength, and the vertices, 4 units apart, do not move. The map
// reaches far enough behind the airplane for its trail to last several
// seconds at cruise speed before the edge fades it out.
export const SEA_WAKE_PRESETS = Object.freeze({
	desktop: Object.freeze({ radius: 320, mapSize: 512 }),
	mobile: Object.freeze({
		radius: 240,
		mapSize: 256,
		trail: Object.freeze({ pulseSpacing: 32 }),
		shading: Object.freeze({ vertexAmplitude: 0 }),
	}),
})

// Resolutions the GUI offers (texels per side).
export const SEA_WAKE_MAP_SIZES = Object.freeze([64, 128, 256, 512, 1024])

export function createSeaWakeSettings({ isMobile = false } = {}) {
	const preset = isMobile ? SEA_WAKE_PRESETS.mobile : SEA_WAKE_PRESETS.desktop
	const settings = { radius: preset.radius, mapSize: preset.mapSize }
	for (const [key, value] of Object.entries(SEA_WAKE_DEFAULTS)) {
		settings[key] = typeof value === 'object' ? { ...value, ...preset[key] } : value
	}
	return settings
}

// World units per texel.
export function getSeaWakeTexel(settings) {
	return (settings.radius * 2) / settings.mapSize
}

// The map's square around (x, z), its center snapped to whole texels so the
// previous state scrolls by whole texels and never blurs. `previous` is the
// last step's window (or null): `shiftX`, `shiftZ` are the texels the state
// moves by, read at the new texel plus the shift, and `reset` is set when
// nothing of the previous state can be kept (no previous window, a new
// texel size, or a shift across the whole map).
export function getSeaWakeWindow(x, z, settings, previous = null, target = {}) {
	const texel = getSeaWakeTexel(settings)
	const size = settings.mapSize
	const indexX = Math.round(x / texel)
	const indexZ = Math.round(z / texel)
	const kept = previous !== null && previous.texel === texel && previous.size === size
	target.shiftX = kept ? indexX - previous.indexX : 0
	target.shiftZ = kept ? indexZ - previous.indexZ : 0
	target.reset = !kept || Math.max(Math.abs(target.shiftX), Math.abs(target.shiftZ)) >= size
	if (target.reset) target.shiftX = target.shiftZ = 0
	target.indexX = indexX
	target.indexZ = indexZ
	target.x = indexX * texel
	target.z = indexZ * texel
	target.texel = texel
	target.size = size
	target.halfSize = settings.radius
	return target
}

// Texel coordinates of world point (x, z) in `window`: texel i covers
// [i, i + 1), so its center is at i + 0.5, as gl_FragCoord.
export function getSeaWakeTexelPoint(x, z, window, target = {}) {
	target.x = (x - window.x) / window.texel + window.size / 2
	target.y = (z - window.z) / window.texel + window.size / 2
	return target
}

// Share of the stamp for an airplane `altitude` above the drawn sea, over
// water `depth` world units deep (the raw height's opposite): 1 low over open
// water, 0 high up or over land.
export function getSeaWakeStrength(altitude, depth, settings) {
	if (!settings.enabled) return 0
	const { full, none } = settings.altitude
	const height = 1 - smoothstep(Math.min(full, none - 1e-3), none, altitude)
	const sea = smoothstep(0, Math.max(settings.shoreDepth, 1e-3), depth)
	return height * sea
}

// The airplane's height above the drawn sea at world height `y`.
export function getSeaWakeAltitude(y) {
	return y - SEA_SURFACE_Y
}

// True once `pending` seconds of flight have gathered for the next advance:
// a frame of a 60 Hz screen at the default rate, two of a 120 Hz one. The
// tenth of slack lets the flight's own clamped step (0.016 s) still advance
// every 60 Hz frame.
export function isSeaWakeStepDue(pending, settings) {
	const { rate } = settings.steps
	return pending > 0 && (!(rate > 0) || pending >= 0.9 / rate)
}

// Sub-steps of a frame `deltaTime` seconds long: `count` steps of `stepTime`
// seconds, none for a frame of zero or negative length. With waves running
// at `waveSpeed` on texels `texel` wide, the frame also takes enough steps
// to keep them within maxCourant texels a step, so a boost keeps the V's
// angle; both within maxSteps.
export function getSeaWakeSteps(deltaTime, settings, target = {}, waveSpeed = 0, texel = 1) {
	const { maxStepTime, maxSteps } = settings.steps
	const time = Math.max(deltaTime, 0)
	const stable =
		(Math.max(waveSpeed, 0) * time) / (Math.min(settings.waves.maxCourant, 0.7) * texel)
	const wanted = Math.max(Math.ceil(time / maxStepTime - 1e-6), Math.ceil(stable - 1e-6), 1)
	const count = time > 0 ? Math.min(wanted, Math.max(maxSteps, 1)) : 0
	target.count = count
	target.stepTime = count > 0 ? time / count : 0
	return target
}

// Speed of the waves (world units per second) for an airplane flying at
// `speed`, on texels `texel` world units wide, in steps `stepTime` seconds
// long: sin(angle) times the speed, at least minSpeed, capped so the waves
// cross at most maxCourant texels a step. `courant` is the result in texels
// per step, `clamped` whether the cap took over.
export function getSeaWakeWaveSpeed(speed, texel, stepTime, settings, target = {}) {
	const { angle, minSpeed, maxCourant } = settings.waves
	const wanted = Math.max(Math.abs(speed) * Math.sin(angle * degrees), minSpeed, 0)
	const limit = stepTime > 0 ? (Math.min(maxCourant, 0.7) * texel) / stepTime : Infinity
	target.speed = Math.min(wanted, limit)
	target.courant = stepTime > 0 ? (target.speed * stepTime) / texel : 0
	target.clamped = wanted > limit
	return target
}

// Factor that halves a value every `halfLife` seconds, over `time` seconds;
// 0 without a half-life.
export function getSeaWakeDecay(halfLife, time) {
	return halfLife > 0 ? 0.5 ** (time / halfLife) : 0
}

// Share of the foam's gap to its neighbors' mean it closes in a step `time`
// seconds long, for a spread of `spread` square world units per second on
// texels `texel` wide: the explicit diffusion of the five-point Laplacian,
// stable up to 1.
export function getSeaWakeFoamSpread(spread, time, texel) {
	return clamp01((4 * Math.max(spread, 0) * time) / (texel * texel))
}

// Phase (radians) of the stamp's pulse after `distance` world units flown.
export function getSeaWakePulsePhase(distance, settings) {
	return (2 * Math.PI * distance) / Math.max(settings.trail.pulseSpacing, 1e-3)
}

// The stamp's pulse at `phase`: -1 for a steady trough, sin(phase) for a
// pure oscillation, mixed by pulseMix. The shader evaluates it along the
// stamped segment.
export function getSeaWakePulse(phase, settings) {
	return lerp(-1, Math.sin(phase), clamp01(settings.trail.pulseMix))
}

// Wavenumber (radians per world unit) of the ripples: a pulse every
// pulseSpacing units flown, with waves at sin(angle) of the airplane's speed,
// leaves crests pulseSpacing * sin(angle) apart. The crest lines take their
// distance from the crest from it.
export function getSeaWakeLineWavenumber(settings) {
	const { pulseSpacing } = settings.trail
	const wavelength = Math.max(pulseSpacing * Math.sin(settings.waves.angle * degrees), 1e-3)
	return (2 * Math.PI) / wavelength
}

// The readers' radial fade range (shares of the half-size), ordered and
// inside the map.
export function getSeaWakeFadeRange(settings, target = {}) {
	const { fadeStart, fadeEnd } = settings.shading
	target.end = Math.min(Math.max(fadeEnd, 0.02), 1)
	target.start = Math.min(Math.max(fadeStart, 0), target.end - 0.01)
	return target
}

// Seconds after its last stamp until a box's waves and foam fall below
// settleThreshold of their start.
export function getSeaWakeSettleTime(settings) {
	const halfLife = Math.max(settings.waves.halfLife, settings.foam.halfLife, 0)
	const threshold = Math.min(Math.max(settings.occupancy.settleThreshold, 1e-4), 0.99)
	return halfLife * Math.log2(1 / threshold)
}

// How far the wake moves the sea's vertices up or down, for the terrain's
// culling bounds (the readers clamp the height to ±1).
export function getSeaWakeBound(settings) {
	return settings?.enabled ? Math.max(settings.shading.vertexAmplitude, 0) : 0
}

// The occupancy: boxes (world XZ) holding the stamped track, each grown by
// the distance its waves have run since (`reach`), dropped once settled.
export function createSeaWakeOccupancy(capacity = 64) {
	return { boxes: [], capacity, age: 0 }
}

export function clearSeaWakeOccupancy(occupancy) {
	occupancy.boxes.length = 0
}

// Adds the track from (ax, az) to (bx, bz), `radius` wide, to the newest box,
// or to a new one once the newest is `interval` seconds old. When the boxes
// fill up, the two oldest merge into one that covers both: their union with
// the larger reach, settling with the later of the two.
export function addSeaWakeStamp(occupancy, ax, az, bx, bz, radius, interval) {
	const { boxes } = occupancy
	let box = boxes[boxes.length - 1]
	if (!box || box.open >= interval) {
		if (boxes.length >= occupancy.capacity) {
			const [first, second] = boxes
			second.minX = Math.min(first.minX, second.minX)
			second.minZ = Math.min(first.minZ, second.minZ)
			second.maxX = Math.max(first.maxX, second.maxX)
			second.maxZ = Math.max(first.maxZ, second.maxZ)
			second.reach = Math.max(first.reach, second.reach)
			second.age = Math.min(first.age, second.age)
			boxes.shift()
		}
		box = {
			minX: Infinity,
			minZ: Infinity,
			maxX: -Infinity,
			maxZ: -Infinity,
			reach: 0,
			age: 0,
			open: 0,
		}
		boxes.push(box)
	}
	box.minX = Math.min(box.minX, ax - radius, bx - radius)
	box.minZ = Math.min(box.minZ, az - radius, bz - radius)
	box.maxX = Math.max(box.maxX, ax + radius, bx + radius)
	box.maxZ = Math.max(box.maxZ, az + radius, bz + radius)
	// A fresh stamp restarts the box's settling.
	box.age = 0
	return box
}

// Advances the boxes by `time` seconds with waves running at `speed`: they
// grow by the distance run, and drop once older than `maxAge` since their
// last stamp.
export function advanceSeaWakeOccupancy(occupancy, time, speed, maxAge) {
	const { boxes } = occupancy
	let kept = 0
	for (const box of boxes) {
		box.reach += Math.max(speed, 0) * time
		box.age += time
		box.open += time
		if (box.age <= maxAge) boxes[kept++] = box
	}
	boxes.length = kept
}

// The union of the boxes, each grown by its reach and `margin`, clipped to
// `window`: where the readers look the wake up. `empty` when nothing is left.
export function getSeaWakeOccupiedRect(occupancy, window, margin, target = {}) {
	let minX = Infinity
	let minZ = Infinity
	let maxX = -Infinity
	let maxZ = -Infinity
	for (const box of occupancy.boxes) {
		const grow = box.reach + margin
		minX = Math.min(minX, box.minX - grow)
		minZ = Math.min(minZ, box.minZ - grow)
		maxX = Math.max(maxX, box.maxX + grow)
		maxZ = Math.max(maxZ, box.maxZ + grow)
	}
	target.minX = Math.max(minX, window.x - window.halfSize)
	target.minZ = Math.max(minZ, window.z - window.halfSize)
	target.maxX = Math.min(maxX, window.x + window.halfSize)
	target.maxZ = Math.min(maxZ, window.z + window.halfSize)
	target.empty = !(target.minX < target.maxX && target.minZ < target.maxZ)
	return target
}
