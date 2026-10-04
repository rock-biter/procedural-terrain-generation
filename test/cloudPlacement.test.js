import assert from 'node:assert/strict'
import test from 'node:test'
import {
	CLOUD_CONFIG,
	CLOUD_FAR_FADE_MARGINS,
	CLOUD_FIELD_RADIUS,
	CLOUD_TYPE_KEYS,
	createCloudSettings,
	generateCloudInstances,
	getCloudCell,
	getCloudFarFade,
	getCloudFieldReach,
	getCloudFieldOffsets,
	getCloudNeighbourRing,
	getCloudRegion,
	getFacingYaw,
} from '../src/cloudPlacement.js'
import { FLIGHT_LIMITS } from '../src/flightPolicy.js'
import { CLOUD_TYPE_COUNT, IMPOSTOR_INSTANCE_STRIDE } from '../src/impostors/impostorTypes.js'

// The follow camera rides this far above the airplane (Plane.addEffect()).
const CAMERA_HEIGHT = 7

function generate(overrides = {}) {
	return generateCloudInstances({
		seed: 'cloud-test',
		centerX: 0,
		centerZ: 0,
		settings: createCloudSettings(),
		...overrides,
	})
}

// One object per instance, keyed by its rounded base.
function byBase(instances) {
	const map = new Map()
	for (let i = 0; i < instances.length; i += IMPOSTOR_INSTANCE_STRIDE) {
		const key = `${instances[i].toFixed(3)}|${instances[i + 2].toFixed(3)}`
		map.set(key, Array.from(instances.subarray(i, i + IMPOSTOR_INSTANCE_STRIDE)))
	}
	return map
}

test('settings are fresh per device', () => {
	const desktop = createCloudSettings()
	const mobile = createCloudSettings({ isMobile: true })
	assert.equal(desktop.radius, CLOUD_FIELD_RADIUS.desktop)
	assert.equal(mobile.radius, CLOUD_FIELD_RADIUS.mobile)
	const defaults = createCloudSettings()
	desktop.size.bank = 3
	desktop.altitude.min = 500
	assert.equal(createCloudSettings().size.bank, defaults.size.bank)
	assert.equal(createCloudSettings().altitude.min, defaults.altitude.min)
	assert.deepEqual(Object.keys(desktop.size).sort(), Object.values(CLOUD_TYPE_KEYS).sort())
})

test('placement is deterministic and changes with the seed', () => {
	const first = generate()
	assert.ok(first.length > 0)
	assert.equal(first.length % IMPOSTOR_INSTANCE_STRIDE, 0)
	assert.deepEqual(generate(), first)
	assert.notDeepEqual(generate({ seed: 'another-seed' }), first)
})

test('a cell keeps its cloud wherever the field is centered', () => {
	const a = byBase(generate({ centerX: 0, centerZ: 0 }))
	const b = byBase(generate({ centerX: 700, centerZ: -400 }))
	let shared = 0
	for (const [key, values] of a) {
		if (!b.has(key)) continue
		assert.deepEqual(b.get(key), values)
		shared++
	}
	assert.ok(shared > 10, 'overlapping fields share clouds')
})

test('keeps bases inside the field reach, the altitude band, and the type range', () => {
	const settings = createCloudSettings()
	const instances = generate({ centerX: 1234, centerZ: -567, settings })
	for (let i = 0; i < instances.length; i += IMPOSTOR_INSTANCE_STRIDE) {
		const [x, y, z, scale, seed, type, , stretch] = instances.subarray(
			i,
			i + IMPOSTOR_INSTANCE_STRIDE,
		)
		assert.ok(Math.hypot(x - 1234, z + 567) <= getCloudFieldReach(settings.radius) + 1e-3)
		assert.ok(y >= settings.altitude.min - 1e-3)
		assert.ok(y <= settings.altitude.min + settings.altitude.range + 1e-3)
		assert.ok(Number.isInteger(type) && type >= 0 && type < CLOUD_TYPE_COUNT)
		assert.ok(scale > 0 && stretch > 0)
		assert.ok(seed >= 0 && seed < Math.PI * 2, 'the yaw slot holds only the dither seed')
	}
})

test('the lowest cloud stays above the highest eye', () => {
	const { altitude } = createCloudSettings()
	assert.ok(altitude.min > FLIGHT_LIMITS.maximumAltitude + CAMERA_HEIGHT + 20)
})

test('density and coverage scale the cloud count', () => {
	const settings = createCloudSettings()
	const full = generate({ settings }).length
	assert.equal(generate({ settings: { ...settings, density: 0 } }).length, 0)
	// Regional coverage can open clouds in a clear sky, so switch it off.
	const clear = { ...settings, coverage: 0, regional: { ...settings.regional, coverage: 0 } }
	assert.equal(generate({ settings: clear }).length, 0)
	assert.ok(generate({ settings: { ...settings, density: 1, coverage: 1 } }).length > full)
})

// Asserts that no two footprints of `instances` intersect; with a single
// base altitude every pair could cut through each other.
function assertFootprintsApart(instances) {
	const clouds = []
	for (let i = 0; i < instances.length; i += IMPOSTOR_INSTANCE_STRIDE) {
		const [x, , z, scale, , type] = instances.subarray(i, i + IMPOSTOR_INSTANCE_STRIDE)
		const [halfWidth, , halfDepth] = CLOUD_CONFIG.extent[type]
		clouds.push({ x, z, footprint: Math.hypot(halfWidth, halfDepth) * scale })
	}
	assert.ok(clouds.length > 0)
	// All bases share one altitude, so every footprint pair must stay apart.
	for (let a = 0; a < clouds.length; a++) {
		for (let b = a + 1; b < clouds.length; b++) {
			const first = clouds[a]
			const second = clouds[b]
			const distance = Math.hypot(first.x - second.x, first.z - second.z)
			assert.ok(distance >= first.footprint + second.footprint)
		}
	}
}

test('drops neighbours that could cut through each other at any heading', () => {
	const settings = {
		...createCloudSettings(),
		density: 1,
		coverage: 1,
		altitude: { min: 130, range: 0 },
	}
	assertFootprintsApart(generate({ settings }))
})

test('checks farther cells when clouds can outgrow the adjacent ones', () => {
	const small = createCloudSettings()
	small.size = { bank: 1, heap: 1, puff: 1 }
	assert.equal(getCloudNeighbourRing(small), 1)
	assert.ok(getCloudNeighbourRing(createCloudSettings()) >= 2)

	// The largest GUI sizes: bases several cells apart can still touch.
	const large = {
		...createCloudSettings(),
		density: 1,
		coverage: 1,
		altitude: { min: 130, range: 0 },
		size: { bank: 3, heap: 3, puff: 3 },
	}
	large.regional = { ...large.regional, size: 1.5 }
	assert.ok(getCloudNeighbourRing(large) > 2)
	for (const seed of ['ring-a', 'ring-b', 'ring-c']) {
		assertFootprintsApart(generate({ seed, settings: large }))
	}
})

test('turns the front face (local -Z) toward the target', () => {
	const rotate = ([x, z], [c, s]) => [c * x + s * z, -s * x + c * z]
	const targets = [
		[0, -50],
		[30, 40],
		[-70, 5],
		[0, 80],
		[-12, -13],
	]
	for (const [targetX, targetZ] of targets) {
		const [x, z] = rotate([0, -1], getFacingYaw(100, 200, 100 + targetX, 200 + targetZ))
		const length = Math.hypot(targetX, targetZ)
		assert.ok(Math.abs(x - targetX / length) < 1e-9)
		assert.ok(Math.abs(z - targetZ / length) < 1e-9)
	}
	// The starting view (airplane at -Z) keeps the source orientation.
	assert.deepEqual(
		getFacingYaw(0, 100, 0, 0).map((value) => value + 0),
		[1, 0],
	)
	assert.deepEqual(getFacingYaw(5, 5, 5, 5), [1, 0])
})

test('cells and the far fade', () => {
	assert.deepEqual(getCloudCell(0, 0), [0, 0])
	assert.deepEqual(getCloudCell(-1, CLOUD_CONFIG.cellSize), [-1, 1])
	const [start, end] = getCloudFarFade(1500)
	assert.equal(start, 1500 - CLOUD_FAR_FADE_MARGINS.start)
	assert.equal(end, 1500 - CLOUD_FAR_FADE_MARGINS.end)
	const [smallStart, smallEnd] = getCloudFarFade(10)
	assert.ok(smallStart >= 0 && smallStart < smallEnd)
})

test('regional fields leave the settings unchanged at zero amplitude', () => {
	const settings = createCloudSettings()
	settings.regional = { ...settings.regional, density: 0, coverage: 0, size: 0 }
	const offsets = getCloudFieldOffsets('cloud-test')
	for (let i = 0; i < 50; i++) {
		const region = getCloudRegion(i * 731, -i * 377, offsets, settings)
		assert.equal(region.density, settings.density)
		assert.equal(region.coverage, settings.coverage)
		assert.equal(region.size, 1)
	}
	const instances = generate({ settings })
	for (let i = 0; i < instances.length; i += IMPOSTOR_INSTANCE_STRIDE) {
		const type = instances[i + 5]
		const [, maxScale] = CLOUD_CONFIG.shape[type]
		const size = settings.size[CLOUD_TYPE_KEYS[type]]
		assert.ok(instances[i + 3] <= maxScale * size + 1e-5, 'no regional size change')
	}
})

test('regional fields stay in range, reach their extremes, and vary smoothly', () => {
	const settings = createCloudSettings()
	const { scale, density, coverage, size } = settings.regional
	const offsets = getCloudFieldOffsets('cloud-test')
	const seen = { density: [1, 0], coverage: [1, 0], size: [Infinity, 0] }
	for (let i = 0; i < 4000; i++) {
		const x = ((i * 7919) % 400) * scale * 0.25
		const z = Math.floor(i / 400) * scale * 0.37
		const region = getCloudRegion(x, z, offsets, settings)
		const near = getCloudRegion(x + 1, z - 1, offsets, settings)
		assert.ok(region.density >= 0 && region.density <= 1)
		assert.ok(region.coverage >= 0 && region.coverage <= 1)
		assert.ok(region.size >= 2 ** -size - 1e-9 && region.size <= 2 ** size + 1e-9)
		assert.ok(Math.abs(near.density - region.density) < 0.01, 'smooth density')
		assert.ok(Math.abs(near.coverage - region.coverage) < 0.01, 'smooth coverage')
		assert.ok(Math.abs(Math.log2(near.size / region.size)) < 0.01, 'smooth size')
		for (const key of ['density', 'coverage', 'size']) {
			seen[key][0] = Math.min(seen[key][0], region[key])
			seen[key][1] = Math.max(seen[key][1], region[key])
		}
	}
	// Each field covers most of its range somewhere in the world.
	assert.ok(seen.density[0] < settings.density * (1 - density * 0.7))
	assert.ok(seen.density[1] > settings.density * (1 + density * 0.7))
	assert.ok(seen.coverage[0] < settings.coverage - coverage * 0.7)
	assert.ok(seen.coverage[1] > settings.coverage + coverage * 0.7)
	assert.ok(seen.size[0] < 2 ** (-size * 0.7) && seen.size[1] > 2 ** (size * 0.7))
})

test('regional fields are independent and follow the seed', () => {
	const settings = createCloudSettings()
	const offsets = getCloudFieldOffsets('cloud-test')
	const other = getCloudFieldOffsets('another-seed')
	assert.notDeepEqual(offsets.density, offsets.size)
	assert.notDeepEqual(offsets.density, offsets.regionCoverage)
	let differentSeed = 0
	let correlated = 0
	for (let i = 0; i < 200; i++) {
		const x = i * 2111
		const z = -i * 1373
		const region = getCloudRegion(x, z, offsets, settings)
		if (Math.abs(region.density - getCloudRegion(x, z, other, settings).density) > 0.05)
			differentSeed++
		const densityUp = region.density > settings.density
		const sizeUp = region.size > 1
		if (densityUp === sizeUp) correlated++
	}
	assert.ok(differentSeed > 100, 'another seed has another sky')
	assert.ok(correlated > 60 && correlated < 140, 'density and size vary independently')
})

test('every cloud nearer than the far fade end exists wherever the airplane is in its cell', () => {
	const { cellSize } = CLOUD_CONFIG
	const settings = createCloudSettings()
	const [, fadeEnd] = getCloudFarFade(settings.radius)
	const key = (values, i) => `${values[i].toFixed(3)},${values[i + 2].toFixed(3)}`
	let checked = 0
	for (const seed of ['reach-a', 'reach-b', 'reach-c']) {
		const field = generate({ seed, centerX: cellSize / 2, centerZ: cellSize / 2, settings })
		const present = new Set()
		for (let i = 0; i < field.length; i += IMPOSTOR_INSTANCE_STRIDE) present.add(key(field, i))
		// The cell's corners and edge midpoints, just inside the cell.
		for (const [u, v] of [
			[0, 0],
			[1, 0],
			[0, 1],
			[1, 1],
			[0.5, 0],
			[0, 0.5],
			[1, 0.5],
			[0.5, 1],
		]) {
			const eyeX = (0.001 + u * 0.998) * cellSize
			const eyeZ = (0.001 + v * 0.998) * cellSize
			// Every cloud around the eye, from a field large enough to hold them all.
			const around = generate({
				seed,
				centerX: eyeX,
				centerZ: eyeZ,
				settings: { ...settings, radius: fadeEnd + cellSize },
			})
			for (let i = 0; i < around.length; i += IMPOSTOR_INSTANCE_STRIDE) {
				if (Math.hypot(around[i] - eyeX, around[i + 2] - eyeZ) >= fadeEnd) continue
				assert.ok(present.has(key(around, i)), `missing cloud ${key(around, i)} for eye ${u},${v}`)
				checked++
			}
		}
	}
	assert.ok(checked > 100)
})
