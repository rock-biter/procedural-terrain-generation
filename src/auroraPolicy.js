import { clamp01, smoothstep } from './math.js'

// The aurora over the ice biome (three-free; src/aurora.js draws it). Auroras
// are random events, never tied to the world seed:
//
// - Entering the ice (with hysteresis on the ice field, `ice`) rolls `chance`
//   once; so does every dawn spent inside it, for the next night. No roll
//   happens while an aurora exists: one aurora at a time.
// - A successful roll scans the ice region under the airplane
//   (findIceRegion()): the aurora covers that region only, and stays anchored
//   over it when the airplane leaves.
// - It shows at night, from the end of sunset (getAuroraNightVisibility(), in
//   palette time), fades in over `fadeIn` seconds once created, and is
//   removed at dawn.
// - The curtains are ribbons parallel to the region's main axis, `spacing`
//   apart, drawn in a window of `radius` around the airplane
//   (getAuroraWindow()); every other group shapes and colors them in the
//   shaders (aurora.vert.glsl, aurora.frag.glsl). Distances are world units,
//   wavelengths world units per noise period, speeds noise periods per second.
export const AURORA_DEFAULTS = Object.freeze({
	chance: 0.4,
	fadeIn: 8,
	// Rises from `start` to `full` and falls from `fade` to `end`, across
	// midnight.
	night: Object.freeze({ start: 0.74, full: 0.8, fade: 0.17, end: 0.235 }),
	// Inside the ice once its field reaches `enter`, outside below `-exit`.
	ice: Object.freeze({ enter: 0.005, exit: 0.03 }),
	// The region scan: grid cell, cap on its cells, and blur passes of the mask.
	region: Object.freeze({ cellSize: 300, maxCells: 6000, blur: 1 }),
	// `fadeStart` is a share of `radius`, where the curtains start to shrink;
	// `jitter` shifts each ribbon by up to half that share of `spacing`;
	// `step` is the length of a segment along a ribbon and `rows` the
	// segments up a curtain; `heightVariation` changes the height along the
	// ribbons by up to that share.
	area: Object.freeze({
		radius: 4900,
		fadeStart: 0.13,
		spacing: 220,
		jitter: 0.6,
		step: 40,
		rows: 3,
		altitude: 280,
		height: 600,
		heightVariation: 0.59,
	}),
	// Sideways displacements of the curtains: a broad meander, finer folds, and
	// a sway that bends their tops.
	meander: Object.freeze({ amplitude: 380, wavelength: 2200, speed: 0.02 }),
	fold: Object.freeze({ amplitude: 70, wavelength: 320, speed: 0.1 }),
	sway: Object.freeze({ amplitude: 80, wavelength: 900, speed: 0.08 }),
	// Splits the ribbons into arcs where a noise is below `threshold`.
	presence: Object.freeze({ wavelength: 2600, threshold: -0.1, softness: 0.3, speed: 0.01 }),
	// sRGB, from the base of a curtain to its top.
	colors: Object.freeze({ bottom: '#1b5533', middle: '#40a088', top: '#387aff' }),
	// `middleStop` is the height share of the middle color, the softness values
	// height shares of the edges, `falloff` the brightness lost at the top,
	// `horizonFade` radians above the curved horizon, and `edgeFade` how
	// edge-on a curtain fades out (|cos| of its view angle).
	look: Object.freeze({
		intensity: 0.4,
		middleStop: 0.12,
		bottomSoftness: 0.225,
		topSoftness: 0.64,
		falloff: 0.83,
		horizonFade: 0.06,
		edgeFade: 0.46,
	}),
	// Vertical rays along the curtains; brighter rays reach higher.
	rays: Object.freeze({ wavelength: 76, speed: 0.18, sharpness: 7.05, strength: 0.64 }),
	// Brightness waves running along the curtains.
	pulse: Object.freeze({ wavelength: 190, speed: 0.435, strength: 0.35 }),
	// Keeps the aurora visible, and never removed, at any time of day.
	debug: Object.freeze({ showByDay: false }),
})

// Mobile keeps the look (spacing, rows) and draws a smaller, coarser window.
const MOBILE_AREA = Object.freeze({ radius: 3500, step: 60 })

function copyGroups(source) {
	return Object.fromEntries(
		Object.entries(source).map(([key, value]) => [
			key,
			typeof value === 'object' ? { ...value } : value,
		]),
	)
}

// A mutable copy of AURORA_DEFAULTS (params.aurora): lighter curtains on
// mobile, and `chance` (?aurora=) when given.
export function createAuroraSettings({ isMobile = false, chance = null } = {}) {
	const settings = copyGroups(AURORA_DEFAULTS)
	if (isMobile) Object.assign(settings.area, MOBILE_AREA)
	if (chance !== null) settings.chance = chance
	return settings
}

// Writes `source` into `target` in place, keeping its group objects.
export function copyAuroraSettings(source, target) {
	for (const [key, value] of Object.entries(source)) {
		if (typeof value === 'object') Object.assign(target[key], value)
		else target[key] = value
	}
	return target
}

// ?aurora= as a chance in [0, 1], or null.
export function parseAuroraChance(urlParams) {
	const raw = urlParams.get('aurora')
	if (raw === null || raw.trim() === '') return null
	const value = Number(raw)
	return Number.isFinite(value) ? clamp01(value) : null
}

function wrapUnit(value) {
	return value - Math.floor(value)
}

// Share of the aurora shown at `paletteTime` (src/dayNightPolicy.js): 0 by
// day, 1 deep in the night, smooth in between.
export function getAuroraNightVisibility(paletteTime, night) {
	const length = wrapUnit(night.end - night.start)
	const since = wrapUnit(paletteTime - night.start)
	if (since >= length) return 0
	const rise = Math.min(wrapUnit(night.full - night.start), length)
	const fall = Math.min(Math.max(wrapUnit(night.fade - night.start), rise), length)
	if (since < rise) return smoothstep(0, rise, since)
	if (since <= fall) return 1
	return 1 - smoothstep(fall, length, since)
}

// Share of an aurora `age` seconds old that has faded in.
export function getAuroraFadeIn(age, fadeIn) {
	return fadeIn > 0 ? smoothstep(0, fadeIn, age) : 1
}

// Whether the airplane is in the ice, at ice field value `ice`.
export function updateIcePresence(inIce, ice, settings) {
	return inIce ? ice >= -settings.exit : ice >= settings.enter
}

// Unique for cell coordinates below 2^19 in magnitude.
function cellKey(i, k) {
	return i * 1048576 + k
}

// The region of `cells` (flat i, k pairs of a grid of `cellSize`): its mask,
// with a border of empty cells, blurred `blur` times; its centroid; and its
// main axis (a unit XZ vector).
function createRegion(cells, cellSize, blur) {
	const count = cells.length / 2
	let minI = Infinity
	let maxI = -Infinity
	let minK = Infinity
	let maxK = -Infinity
	let sumX = 0
	let sumZ = 0
	for (let index = 0; index < cells.length; index += 2) {
		const i = cells[index]
		const k = cells[index + 1]
		minI = Math.min(minI, i)
		maxI = Math.max(maxI, i)
		minK = Math.min(minK, k)
		maxK = Math.max(maxK, k)
		sumX += (i + 0.5) * cellSize
		sumZ += (k + 0.5) * cellSize
	}
	const centerX = sumX / count
	const centerZ = sumZ / count
	let xx = 0
	let zz = 0
	let xz = 0
	for (let index = 0; index < cells.length; index += 2) {
		const dx = (cells[index] + 0.5) * cellSize - centerX
		const dz = (cells[index + 1] + 0.5) * cellSize - centerZ
		xx += dx * dx
		zz += dz * dz
		xz += dx * dz
	}
	const angle = 0.5 * Math.atan2(2 * xz, xx - zz)

	// The blur spreads one cell per pass; the border keeps the outer ring
	// empty, so the clamped texture reads 0 beyond the mask.
	const border = Math.max(Math.round(blur), 0) + 1
	const columns = maxI - minI + 1 + border * 2
	const rows = maxK - minK + 1 + border * 2
	let values = new Float32Array(columns * rows)
	for (let index = 0; index < cells.length; index += 2) {
		values[(cells[index + 1] - minK + border) * columns + cells[index] - minI + border] = 1
	}
	for (let pass = 0; pass < border - 1; pass++) {
		const blurred = new Float32Array(values.length)
		for (let row = 1; row < rows - 1; row++) {
			for (let column = 1; column < columns - 1; column++) {
				let sum = 0
				for (let dRow = -1; dRow <= 1; dRow++) {
					for (let dColumn = -1; dColumn <= 1; dColumn++) {
						sum += values[(row + dRow) * columns + column + dColumn]
					}
				}
				blurred[row * columns + column] = sum / 9
			}
		}
		values = blurred
	}
	const mask = new Uint8Array(values.length)
	for (let index = 0; index < values.length; index++) {
		mask[index] = Math.round(values[index] * 255)
	}

	return {
		minX: (minI - border) * cellSize,
		minZ: (minK - border) * cellSize,
		cellSize,
		columns,
		rows,
		mask,
		cellCount: count,
		center: [centerX, centerZ],
		axis: [Math.cos(angle), Math.sin(angle)],
	}
}

// The ice region around (x, z): a four-connected flood fill of the cells of a
// world-aligned grid whose center has `sampleIce(x, z) >= 0`, from the cell
// under the point or, near the border, its iciest neighbour. Stops after
// `maxCells` cells (`capped`). Null outside the ice.
export function findIceRegion(x, z, sampleIce, { cellSize, maxCells, blur }) {
	const samples = new Map()
	const sample = (i, k) => {
		const key = cellKey(i, k)
		let value = samples.get(key)
		if (value === undefined) {
			value = sampleIce((i + 0.5) * cellSize, (k + 0.5) * cellSize)
			samples.set(key, value)
		}
		return value
	}

	const startI = Math.floor(x / cellSize)
	const startK = Math.floor(z / cellSize)
	let seed = sample(startI, startK) >= 0 ? [startI, startK] : null
	if (!seed) {
		let best = 0
		for (let dk = -1; dk <= 1; dk++) {
			for (let di = -1; di <= 1; di++) {
				const value = sample(startI + di, startK + dk)
				if (value >= best) {
					best = value
					seed = [startI + di, startK + dk]
				}
			}
		}
	}
	if (!seed) return null

	const cells = []
	const queued = new Set([cellKey(seed[0], seed[1])])
	const queue = [seed]
	let head = 0
	while (head < queue.length && cells.length / 2 < maxCells) {
		const [i, k] = queue[head++]
		cells.push(i, k)
		for (const [di, dk] of [
			[1, 0],
			[-1, 0],
			[0, 1],
			[0, -1],
		]) {
			const key = cellKey(i + di, k + dk)
			if (queued.has(key) || sample(i + di, k + dk) < 0) continue
			queued.add(key)
			queue.push([i + di, k + dk])
		}
	}

	const region = createRegion(cells, cellSize, blur)
	region.capped = head < queue.length
	return region
}

// A disc of `radius` around (x, z) as a region along `angle` (radians), for
// an aurora forced away from the ice.
export function createDiscRegion(x, z, radius, angle, { cellSize, blur }) {
	const cells = []
	const reach = Math.ceil(radius / cellSize) + 1
	const centerI = Math.floor(x / cellSize)
	const centerK = Math.floor(z / cellSize)
	for (let k = centerK - reach; k <= centerK + reach; k++) {
		for (let i = centerI - reach; i <= centerI + reach; i++) {
			if (Math.hypot((i + 0.5) * cellSize - x, (k + 0.5) * cellSize - z) <= radius) {
				cells.push(i, k)
			}
		}
	}
	const region = createRegion(cells, cellSize, blur)
	region.center = [x, z]
	region.axis = [Math.cos(angle), Math.sin(angle)]
	region.capped = false
	return region
}

export function createAuroraState() {
	return {
		inIce: false,
		// Whether the night window was open on the previous step.
		dark: false,
		event: null,
		// Bumped whenever the event or its region changes.
		revision: 0,
		rolls: 0,
		successes: 0,
		nightVisibility: 0,
		visibility: 0,
	}
}

// Replaces the event with a new aurora over `region`, found from `anchor`
// ([x, z]). `age` (seconds) is how far its fade-in has gone; its animation
// time starts at 0. `synthetic` marks a region that is not the ice's.
export function startAuroraEvent(
	state,
	region,
	anchor,
	random,
	{ age = 0, synthetic = false } = {},
) {
	state.event = { region, anchor: [anchor[0], anchor[1]], seed: random(), age, time: 0, synthetic }
	state.revision++
	return state.event
}

export function clearAuroraEvent(state) {
	if (!state.event) return
	state.event = null
	state.visibility = 0
	state.revision++
}

// Forgets the event and the ice presence; the next step rolls again if the
// airplane is in the ice.
export function resetAuroraState(state) {
	const revision = state.revision + 1
	Object.assign(state, createAuroraState())
	state.revision = revision
}

// Scans the event's region again from its anchor (after a biome change):
// removes the event when no ice is left there. Forced discs stay.
export function refreshAuroraRegion(state, sampleIce, settings) {
	const { event } = state
	if (!event || event.synthetic) return
	const region = findIceRegion(event.anchor[0], event.anchor[1], sampleIce, settings.region)
	if (!region) {
		clearAuroraEvent(state)
		return
	}
	event.region = region
	state.revision++
}

// Advances the aurora by `dt` seconds with the airplane at (x, z), over ice
// field value `ice`; `sampleIce(x, z)` reads the field for the region scan
// and `random()` (0 to 1) drives the rolls.
export function stepAurora(
	state,
	{ dt, paletteTime, x, z, ice, sampleIce },
	settings,
	random = Math.random,
) {
	const nightVisibility = settings.debug.showByDay
		? 1
		: getAuroraNightVisibility(paletteTime, settings.night)
	const dark = nightVisibility > 0
	const wasInIce = state.inIce
	state.inIce = updateIcePresence(wasInIce, ice, settings.ice)
	let roll = state.inIce && !wasInIce
	// Dawn: the aurora ends, and a night ahead in the ice is a new chance.
	if (state.dark && !dark) {
		clearAuroraEvent(state)
		if (state.inIce) roll = true
	}
	state.dark = dark

	if (roll && !state.event) {
		state.rolls++
		if (random() < settings.chance) {
			const region = findIceRegion(x, z, sampleIce, settings.region)
			if (region) {
				startAuroraEvent(state, region, [x, z], random)
				state.successes++
			}
		}
	}

	const { event } = state
	if (event) {
		event.age += dt
		event.time += dt
	}
	state.nightVisibility = nightVisibility
	state.visibility = event ? nightVisibility * getAuroraFadeIn(event.age, settings.fadeIn) : 0
	return state
}

// The geometry's counts for `settings`: ribbon slots, so the window reaches
// every ribbon that may sway into `radius` (`reach`), columns spanning
// `radius` both ways along the ribbons, and rows.
export function getAuroraLayout(settings) {
	const { area, meander, fold, sway } = settings
	const reach =
		area.radius +
		Math.abs(meander.amplitude) +
		Math.abs(fold.amplitude) +
		Math.abs(sway.amplitude) +
		Math.abs(area.jitter) * area.spacing * 0.5
	return {
		ribbons: Math.ceil((2 * reach) / area.spacing) + 2,
		columns: Math.ceil((2 * area.radius) / area.step) + 2,
		rows: Math.max(Math.round(area.rows), 1),
		radius: area.radius,
		spacing: area.spacing,
		step: area.step,
		reach,
	}
}

// The window of `layout` around (x, z) in the event's frame (origin the
// region's center, its axis, and the side vector (-axis.z, axis.x)): the
// distance along the axis of the first column, and the index of the ribbon
// in the first slot. Both snap to whole steps, so the curtains stay put.
export function getAuroraWindow(event, x, z, layout, out = {}) {
	const { center, axis } = event.region
	const dx = x - center[0]
	const dz = z - center[1]
	const along = dx * axis[0] + dz * axis[1]
	const across = dz * axis[0] - dx * axis[1]
	out.along = Math.floor((along - layout.radius) / layout.step) * layout.step
	out.ribbon = Math.floor((across - layout.reach) / layout.spacing)
	return out
}
