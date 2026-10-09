import assert from 'node:assert/strict'
import test from 'node:test'
import {
	AURORA_DEFAULTS,
	clearAuroraEvent,
	copyAuroraSettings,
	createAuroraSettings,
	createAuroraState,
	createDiscRegion,
	findIceRegion,
	getAuroraFadeIn,
	getAuroraLayout,
	getAuroraNightVisibility,
	getAuroraWindow,
	parseAuroraChance,
	refreshAuroraRegion,
	resetAuroraState,
	startAuroraEvent,
	stepAurora,
	updateIcePresence,
} from '../src/auroraPolicy.js'
import { BIOME_DEFAULTS, createBiomeOffset, getIceValue } from '../src/biome.js'

const NOON = 0.5
const MIDNIGHT = 0

// A disc of ice of `radius` around (cx, cz), the field rising toward its
// center.
function discIce(cx, cz, radius) {
	return (x, z) => 1 - Math.hypot(x - cx, z - cz) / radius
}

// Scripted rolls: each call returns the next value.
function scripted(...values) {
	let index = 0
	return () => values[index++ % values.length]
}

function createSettings(overrides = {}) {
	return { ...createAuroraSettings(), ...overrides }
}

// One step of `dt` seconds with the airplane at (x, z) over `sampleIce`.
function step(state, settings, { paletteTime, x = 0, z = 0, sampleIce, dt = 1, random }) {
	return stepAurora(
		state,
		{ dt, paletteTime, x, z, ice: sampleIce(x, z), sampleIce },
		settings,
		random ?? scripted(0),
	)
}

test('settings are mutable copies, lighter on mobile, with the ?aurora= chance', () => {
	const settings = createAuroraSettings()
	assert.deepEqual(settings.area, AURORA_DEFAULTS.area)
	settings.area.radius = 1
	settings.colors.top = '#000000'
	assert.notEqual(AURORA_DEFAULTS.area.radius, 1)
	assert.notEqual(AURORA_DEFAULTS.colors.top, '#000000')

	const mobile = createAuroraSettings({ isMobile: true })
	const desktopLayout = getAuroraLayout(createAuroraSettings())
	const mobileLayout = getAuroraLayout(mobile)
	const vertices = ({ ribbons, columns, rows }) => ribbons * (columns + 1) * (rows + 1)
	assert.ok(vertices(mobileLayout) < vertices(desktopLayout) / 2)
	assert.equal(createAuroraSettings({ chance: 0.9 }).chance, 0.9)

	const target = createAuroraSettings()
	const area = target.area
	copyAuroraSettings(createAuroraSettings({ chance: 0.1, isMobile: true }), target)
	assert.equal(target.area, area)
	assert.equal(target.chance, 0.1)
	assert.equal(target.area.radius, mobile.area.radius)
})

test('parses ?aurora= as a chance', () => {
	const parse = (query) => parseAuroraChance(new URLSearchParams(query))
	assert.equal(parse(''), null)
	assert.equal(parse('aurora='), null)
	assert.equal(parse('aurora=often'), null)
	assert.equal(parse('aurora=0'), 0)
	assert.equal(parse('aurora=0.25'), 0.25)
	assert.equal(parse('aurora=1'), 1)
	assert.equal(parse('aurora=3'), 1)
	assert.equal(parse('aurora=-1'), 0)
})

test('shows the aurora at night only, from the end of sunset', () => {
	const { night } = AURORA_DEFAULTS
	assert.equal(getAuroraNightVisibility(MIDNIGHT, night), 1)
	for (let time = night.end; time <= night.start; time += 0.01) {
		assert.equal(getAuroraNightVisibility(time, night), 0, `time ${time}`)
	}
	// The sunset keyframe (0.72) is still dark-free; dusk (0.8) is full night.
	assert.equal(getAuroraNightVisibility(0.72, night), 0)
	assert.equal(getAuroraNightVisibility(night.full, night), 1)
	assert.equal(getAuroraNightVisibility(night.fade, night), 1)

	// Rising, then falling, continuously across midnight.
	let previous = 0
	let rising = true
	for (let index = 0; index <= 1000; index++) {
		const time = (night.start + index * 0.0005) % 1
		const value = getAuroraNightVisibility(time, night)
		assert.ok(Math.abs(value - previous) < 0.05, `jump at ${time}`)
		if (rising && value < previous) rising = false
		if (!rising) assert.ok(value <= previous + 1e-12, `rises again at ${time}`)
		previous = value
	}
	assert.equal(getAuroraNightVisibility(night.end + 0.001, night), 0)
	// Periodic.
	assert.equal(getAuroraNightVisibility(1.1, night), getAuroraNightVisibility(0.1, night))
})

test('fades in over the fade-in time', () => {
	assert.equal(getAuroraFadeIn(0, 8), 0)
	assert.equal(getAuroraFadeIn(4, 8), 0.5)
	assert.equal(getAuroraFadeIn(8, 8), 1)
	assert.equal(getAuroraFadeIn(0, 0), 1)
})

test('enters and leaves the ice with hysteresis', () => {
	const ice = { enter: 0.01, exit: 0.03 }
	assert.equal(updateIcePresence(false, 0.005, ice), false)
	assert.equal(updateIcePresence(false, 0.01, ice), true)
	assert.equal(updateIcePresence(true, -0.02, ice), true)
	assert.equal(updateIcePresence(true, -0.031, ice), false)
})

test('finds the ice region under the airplane', () => {
	const region = { cellSize: 100, maxCells: 100000, blur: 1 }
	const disc = findIceRegion(2000, -500, discIce(2000, -500, 1000), region)
	assert.ok(Math.hypot(disc.center[0] - 2000, disc.center[1] + 500) < 60)
	assert.ok(Math.abs(Math.PI * 100 - disc.cellCount) < 20)
	assert.equal(disc.capped, false)
	assert.ok(Math.abs(Math.hypot(...disc.axis) - 1) < 1e-12)

	// The mask covers the region with an empty border, and stays inside [0, 1].
	const { columns, rows, mask } = disc
	assert.equal(mask.length, columns * rows)
	for (let column = 0; column < columns; column++) {
		assert.equal(mask[column], 0)
		assert.equal(mask[(rows - 1) * columns + column], 0)
	}
	for (let row = 0; row < rows; row++) {
		assert.equal(mask[row * columns], 0)
		assert.equal(mask[row * columns + columns - 1], 0)
	}
	const centerColumn = Math.floor((2000 - disc.minX) / disc.cellSize)
	const centerRow = Math.floor((-500 - disc.minZ) / disc.cellSize)
	assert.equal(mask[centerRow * columns + centerColumn], 255)

	// An ellipse long along x and z = x lies along that diagonal.
	const ellipse = (x, z) => {
		const along = (x + z) / Math.SQRT2
		const across = (z - x) / Math.SQRT2
		return 1 - Math.hypot(along / 3000, across / 800)
	}
	const axis = findIceRegion(0, 0, ellipse, region).axis
	assert.ok(Math.abs(Math.abs(axis[0] * Math.SQRT1_2 + axis[1] * Math.SQRT1_2) - 1) < 0.01)

	// Two islands: only the one under the airplane.
	const islands = (x, z) => Math.max(discIce(0, 0, 500)(x, z), discIce(3000, 0, 500)(x, z))
	const near = findIceRegion(0, 0, islands, region)
	assert.ok(Math.abs(near.center[0]) < 60)
	assert.ok(near.cellCount < 100)

	// Outside the ice, or just beyond its border.
	assert.equal(findIceRegion(5000, 5000, discIce(0, 0, 500), region), null)
	const border = findIceRegion(540, 0, discIce(0, 0, 500), region)
	assert.ok(border && border.cellCount > 50)

	// Capped.
	const capped = findIceRegion(0, 0, discIce(0, 0, 1000), { ...region, maxCells: 40 })
	assert.equal(capped.cellCount, 40)
	assert.equal(capped.capped, true)
})

test('finds the ice region of a seed that starts in the ice', () => {
	const offset = createBiomeOffset('ice194')
	const sampleIce = (x, z) => getIceValue(x, z, offset, BIOME_DEFAULTS)
	assert.ok(sampleIce(0, 0) > 0)
	const region = findIceRegion(0, 0, sampleIce, AURORA_DEFAULTS.region)
	assert.ok(region.cellCount > 100)
	assert.ok(sampleIce(...region.center) > -0.05)
	assert.equal(region.capped, false)
})

test('a forced disc covers the radius along the given angle', () => {
	const disc = createDiscRegion(100, 200, 1000, Math.PI / 2, { cellSize: 100, blur: 0 })
	assert.deepEqual(disc.center, [100, 200])
	assert.ok(Math.abs(disc.axis[0]) < 1e-12 && Math.abs(disc.axis[1] - 1) < 1e-12)
	assert.ok(Math.abs(Math.PI * 100 - disc.cellCount) < 20)
})

test('rolls on entering the ice, at most one aurora at a time', () => {
	const sampleIce = discIce(0, 0, 1000)
	// Chance 0: rolls, never an aurora.
	const never = createAuroraState()
	step(never, createSettings({ chance: 0 }), { paletteTime: MIDNIGHT, sampleIce })
	assert.equal(never.rolls, 1)
	assert.equal(never.event, null)

	// Chance 1: an aurora, which then blocks every roll.
	const settings = createSettings({ chance: 1 })
	const state = createAuroraState()
	step(state, settings, { paletteTime: NOON, sampleIce })
	assert.equal(state.rolls, 1)
	assert.equal(state.successes, 1)
	const { event } = state
	assert.ok(event)
	// Waiting for the night.
	assert.equal(state.visibility, 0)
	step(state, settings, { paletteTime: NOON, x: 5000, sampleIce })
	assert.equal(state.inIce, false)
	step(state, settings, { paletteTime: NOON, sampleIce })
	assert.equal(state.rolls, 1)
	// Anchored: leaving the ice keeps it.
	step(state, settings, { paletteTime: MIDNIGHT, x: 5000, sampleIce, dt: 100 })
	assert.equal(state.event, event)
	assert.equal(state.visibility, 1)
})

test('re-entering the ice without an aurora rolls again', () => {
	const sampleIce = discIce(0, 0, 1000)
	const settings = createSettings({ chance: 0.5 })
	const state = createAuroraState()
	step(state, settings, { paletteTime: MIDNIGHT, sampleIce, random: scripted(0.9) })
	assert.equal(state.event, null)
	// Staying in the ice: no new roll the same night.
	step(state, settings, { paletteTime: MIDNIGHT, sampleIce, random: scripted(0.1) })
	assert.equal(state.rolls, 1)
	// Out of the ice, and back.
	step(state, settings, { paletteTime: MIDNIGHT, x: 5000, sampleIce })
	step(state, settings, { paletteTime: MIDNIGHT, sampleIce, random: scripted(0.1) })
	assert.equal(state.rolls, 2)
	assert.ok(state.event)
})

test('fades in when created at night', () => {
	const sampleIce = discIce(0, 0, 1000)
	const settings = createSettings({ chance: 1, fadeIn: 8 })
	const state = createAuroraState()
	step(state, settings, { paletteTime: MIDNIGHT, sampleIce, dt: 0 })
	assert.equal(state.visibility, 0)
	step(state, settings, { paletteTime: MIDNIGHT, sampleIce, dt: 4 })
	assert.equal(state.visibility, 0.5)
	step(state, settings, { paletteTime: MIDNIGHT, sampleIce, dt: 4 })
	assert.equal(state.visibility, 1)
	assert.equal(state.event.time, 8)
})

test('dawn removes the aurora and rolls for the next night in the ice', () => {
	const sampleIce = discIce(0, 0, 1000)
	const settings = createSettings({ chance: 1 })
	const state = createAuroraState()
	step(state, settings, { paletteTime: MIDNIGHT, sampleIce })
	const first = state.event
	assert.ok(first)
	// Paused at night: it stays.
	for (let frame = 0; frame < 10; frame++) {
		step(state, settings, { paletteTime: MIDNIGHT, sampleIce })
	}
	assert.equal(state.event, first)
	// Dawn in the ice: a new roll, for a new aurora.
	step(state, settings, { paletteTime: NOON, sampleIce })
	assert.equal(state.rolls, 2)
	assert.ok(state.event)
	assert.notEqual(state.event, first)
	assert.equal(state.visibility, 0)

	// Dawn away from the ice: removed, no roll.
	step(state, settings, { paletteTime: MIDNIGHT, x: 5000, sampleIce })
	step(state, settings, { paletteTime: NOON, x: 5000, sampleIce })
	assert.equal(state.event, null)
	assert.equal(state.rolls, 2)
	// A jump across midnight stays night.
	step(state, settings, { paletteTime: MIDNIGHT, sampleIce })
	const night = state.event
	step(state, settings, { paletteTime: 0.99, sampleIce })
	step(state, settings, { paletteTime: 0.01, sampleIce })
	assert.equal(state.event, night)
})

test('debug: a spawn replaces the aurora, and Show by day keeps it', () => {
	const sampleIce = discIce(0, 0, 1000)
	const settings = createSettings({ chance: 1 })
	const state = createAuroraState()
	step(state, settings, { paletteTime: MIDNIGHT, sampleIce })
	const rolled = state.event
	const region = createDiscRegion(9000, 0, 500, 0, settings.region)
	const spawned = startAuroraEvent(state, region, [9000, 0], scripted(0.3), {
		age: settings.fadeIn,
		synthetic: true,
	})
	assert.notEqual(spawned, rolled)
	assert.equal(spawned.seed, 0.3)
	assert.equal(spawned.time, 0)
	step(state, settings, { paletteTime: MIDNIGHT, x: 9000, sampleIce, dt: 0 })
	assert.equal(state.visibility, 1)

	settings.debug.showByDay = true
	step(state, settings, { paletteTime: NOON, x: 9000, sampleIce })
	assert.equal(state.event, spawned)
	assert.equal(state.visibility, 1)
	// The forced disc survives a biome refresh.
	refreshAuroraRegion(state, sampleIce, settings)
	assert.equal(state.event, spawned)

	settings.debug.showByDay = false
	step(state, settings, { paletteTime: NOON, x: 9000, sampleIce })
	assert.equal(state.event, null)
})

test('revisions follow every change of the event', () => {
	const sampleIce = discIce(0, 0, 1000)
	const settings = createSettings({ chance: 1 })
	const state = createAuroraState()
	let revision = state.revision
	const changed = () => {
		const result = state.revision !== revision
		revision = state.revision
		return result
	}
	step(state, settings, { paletteTime: MIDNIGHT, sampleIce })
	assert.ok(changed())
	step(state, settings, { paletteTime: MIDNIGHT, sampleIce })
	assert.ok(!changed())
	// A rescan where the ice is gone removes a rolled aurora.
	refreshAuroraRegion(state, () => -1, settings)
	assert.ok(changed())
	assert.equal(state.event, null)
	clearAuroraEvent(state)
	assert.ok(!changed())

	step(state, settings, { paletteTime: MIDNIGHT, x: 5000, sampleIce })
	step(state, settings, { paletteTime: MIDNIGHT, sampleIce })
	assert.ok(state.event)
	resetAuroraState(state)
	assert.ok(changed())
	assert.equal(state.event, null)
	assert.equal(state.inIce, false)
	// Still in the ice: the next step rolls again.
	step(state, settings, { paletteTime: MIDNIGHT, sampleIce })
	assert.ok(state.event)
})

test('the window covers the radius and snaps to whole steps', () => {
	const settings = createAuroraSettings()
	const layout = getAuroraLayout(settings)
	const event = {
		region: { center: [-1234, 5678], axis: [Math.cos(0.7), Math.sin(0.7)] },
	}
	const [ax, az] = event.region.axis
	for (const [x, z] of [
		[0, 0],
		[-1234, 5678],
		[-9000.5, 3333.3],
		[12345.6, -7654.3],
	]) {
		const placement = getAuroraWindow(event, x, z, layout)
		assert.ok(Number.isInteger(placement.ribbon))
		assert.ok(
			Math.abs(placement.along / layout.step - Math.round(placement.along / layout.step)) < 1e-9,
		)
		const dx = x - event.region.center[0]
		const dz = z - event.region.center[1]
		const along = dx * ax + dz * az
		const across = dz * ax - dx * az
		assert.ok(placement.along <= along - layout.radius)
		assert.ok(placement.along + layout.columns * layout.step >= along + layout.radius)
		assert.ok(placement.ribbon * layout.spacing <= across - layout.reach)
		assert.ok((placement.ribbon + layout.ribbons - 1) * layout.spacing >= across + layout.reach)
	}
	// Moving less than a step keeps the window.
	const before = getAuroraWindow(event, 100, 100, layout)
	const after = getAuroraWindow(event, 100 + ax * 0.1, 100 + az * 0.1, layout)
	assert.ok(Math.abs(before.along - after.along) <= layout.step)

	// The reach includes every sideways displacement.
	settings.meander.amplitude += 500
	assert.ok(getAuroraLayout(settings).ribbons > layout.ribbons)
})
