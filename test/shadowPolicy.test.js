import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
	CLOUD_SHADOW_DEFAULTS,
	CLOUD_SHADOW_PRESETS,
	SCENERY_SHADOW_CASCADE_COUNT,
	SCENERY_SHADOW_MAX_TAPS,
	SCENERY_SHADOW_PRESETS,
	createCloudShadowSettings,
	createSceneryShadowSettings,
	getCloudShadowBlurTexels,
	getCloudShadowSphere,
	shouldRenderCloudShadow,
	getCascadeDepthRange,
	getCascadeSphere,
	getLightAngle,
	getSceneryShadowTapDefines,
	getShadowEdgeFactor,
	getShadowStrength,
	getTerrainCasterReach,
	getTerrainShadowSegments,
	hasLightDirectionChanged,
	selectShadowLight,
	shouldRenderCascade,
	snapToTexel,
	terrainChunkCastsIntoDisk,
	terrainChunkFacesAwayFrom,
} from '../src/shadowPolicy.js'
import { getChunkSegments } from '../src/chunkGeometry.js'
import { CHUNK_SIZE } from '../src/worldConstants.js'

function direction(elevation, azimuth = 0) {
	return [
		Math.cos(elevation) * Math.cos(azimuth),
		Math.sin(elevation),
		Math.cos(elevation) * Math.sin(azimuth),
	]
}

test('settings are fresh copies of the device preset', () => {
	const desktop = createSceneryShadowSettings()
	const mobile = createSceneryShadowSettings({ isMobile: true })
	assert.equal(desktop.cascades.length, SCENERY_SHADOW_CASCADE_COUNT)
	assert.equal(mobile.cascades.length, SCENERY_SHADOW_CASCADE_COUNT)
	assert.deepEqual(desktop.cascades, SCENERY_SHADOW_PRESETS.desktop.cascades)
	assert.deepEqual(mobile.taps.terrain, SCENERY_SHADOW_PRESETS.mobile.taps.terrain)

	assert.deepEqual(mobile.terrainCasters, {
		enabled: true,
		offset: 0.5,
		maxReach: SCENERY_SHADOW_PRESETS.mobile.terrainCasters.maxReach,
		segments: SCENERY_SHADOW_PRESETS.mobile.terrainCasters.segments,
	})

	desktop.cascades[0].radius = 1
	desktop.taps.terrain[0] = 1
	desktop.fade.end = 1
	desktop.terrainCasters.segments[0] = 1
	desktop.terrainCasters.offset = 2
	const again = createSceneryShadowSettings()
	assert.equal(again.cascades[0].radius, SCENERY_SHADOW_PRESETS.desktop.cascades[0].radius)
	assert.equal(again.taps.terrain[0], SCENERY_SHADOW_PRESETS.desktop.taps.terrain[0])
	assert.equal(again.fade.end, SCENERY_SHADOW_PRESETS.desktop.fade.end)
	assert.equal(
		again.terrainCasters.segments[0],
		SCENERY_SHADOW_PRESETS.desktop.terrainCasters.segments[0],
	)
	assert.equal(again.terrainCasters.offset, 0.5)
})

test('terrain shadow grids divide the LOD 0 and LOD 1 chunk grids', () => {
	// Grid densities of src/chunkManager.js.
	for (const [device, density] of [
		['desktop', 2],
		['mobile', 4],
	]) {
		const { segments } = SCENERY_SHADOW_PRESETS[device].terrainCasters
		assert.equal(segments.length, SCENERY_SHADOW_CASCADE_COUNT)
		for (const shadowSegments of segments) {
			for (const LOD of [0, 1]) {
				const ratio = getChunkSegments(CHUNK_SIZE, LOD, density) / shadowSegments
				assert.ok(Number.isInteger(Math.log2(ratio)), `${device} ${shadowSegments} LOD ${LOD}`)
			}
		}
	}
	assert.equal(getTerrainShadowSegments(64, 128), 64)
	assert.equal(getTerrainShadowSegments(64, 16), 16)
})

test('an edge snaps only to a coarser loaded neighbor', () => {
	assert.equal(getShadowEdgeFactor(64, 16), 4)
	assert.equal(getShadowEdgeFactor(64, 64), 1)
	assert.equal(getShadowEdgeFactor(16, 64), 1)
	assert.equal(getShadowEdgeFactor(64, undefined), 1)
})

test('terrain reaches farther upstream under a lower light, up to the cap', () => {
	const minHeight = -2
	const low = getTerrainCasterReach(38, direction(0.2), minHeight, 1e6)
	assert.ok(Math.abs(low - 40 / Math.tan(0.2)) < 1e-9)
	assert.ok(getTerrainCasterReach(38, direction(0.1), minHeight, 1e6) > low)
	assert.equal(getTerrainCasterReach(38, direction(0.1), minHeight, 300), 300)
	assert.equal(getTerrainCasterReach(-3, direction(0.2), minHeight, 300), 0)
	assert.equal(getTerrainCasterReach(38, [0, 1, 0], minHeight, 300), 0)
	// Below the horizon the shadows are off; the cap keeps every caster.
	assert.equal(getTerrainCasterReach(38, direction(-0.1), minHeight, 300), 300)
})

test('only chunks steeper than the light elevation cast terrain shadows', () => {
	// Open sea is clamped flat.
	assert.ok(!terrainChunkFacesAwayFrom(0, direction(0.06)))
	// A 30-degree slope faces away from a light below 30 degrees only.
	const slope = Math.tan(Math.PI / 6)
	assert.ok(terrainChunkFacesAwayFrom(slope, direction(Math.PI / 6 - 0.01)))
	assert.ok(!terrainChunkFacesAwayFrom(slope, direction(Math.PI / 6 + 0.01)))
	assert.ok(!terrainChunkFacesAwayFrom(10, [0, 1, 0]))
	assert.ok(terrainChunkFacesAwayFrom(undefined, [0, 1, 0]))
})

test('terrain chunks cast into a disk from inside it or upstream within reach', () => {
	const disk = { x: 0, z: 0, diskRadius: 150 }
	const halfSize = 128
	const casts = (x, z, reach) => terrainChunkCastsIntoDisk(x, z, halfSize, disk, 1, 0, reach)
	assert.ok(casts(0, 0, 0))
	// Within the disk plus the footprint's circle.
	assert.ok(casts(300, 0, 0))
	assert.ok(!casts(340, 0, 0))
	// Upstream (toward the light, +X) within reach.
	assert.ok(casts(600, 0, 400))
	assert.ok(!casts(800, 0, 400))
	// Downstream never casts into the disk.
	assert.ok(!casts(-600, 0, 400))
	// Beside the swept disk.
	assert.ok(!casts(400, 400, 400))
	// The light direction need not be unit length.
	assert.ok(terrainChunkCastsIntoDisk(600, 0, halfSize, disk, 0.2, 0, 400))
	// A vertical light keeps only the disk.
	assert.ok(!terrainChunkCastsIntoDisk(600, 0, halfSize, disk, 0, 0, 400))
})

test('every preset fades shadows out inside the far cascade', () => {
	for (const preset of Object.values(SCENERY_SHADOW_PRESETS)) {
		const [near, far] = preset.cascades
		assert.ok(near.radius < far.radius)
		assert.ok(preset.fade.start < preset.fade.end)
		// Ahead of the plane, the far cascade reaches past the fade end.
		assert.ok(preset.fade.end < far.radius * (1 + far.forwardShift) * 0.85)
		assert.ok(preset.fade.end > near.radius)
	}
})

test('the higher light casts shadows and fades in with elevation', () => {
	const settings = createSceneryShadowSettings()
	const sunHigh = selectShadowLight(direction(0.8), direction(-0.8, Math.PI), settings)
	assert.equal(sunHigh.light, 'sun')
	assert.equal(sunHigh.strength, 1)

	const moonHigh = selectShadowLight(direction(-0.6), direction(0.6, Math.PI), settings)
	assert.equal(moonHigh.light, 'moon')
	assert.equal(moonHigh.strength, 1)

	const halfway = (settings.elevationFade.start + settings.elevationFade.end) / 2
	const fading = selectShadowLight(direction(halfway), direction(-halfway, Math.PI), settings)
	assert.ok(fading.strength > 0 && fading.strength < 1)
})

test('the shadow light is written into the object passed in', () => {
	const settings = createSceneryShadowSettings()
	const out = selectShadowLight(direction(0.8), direction(-0.8, Math.PI), settings)
	const moon = direction(0.6, Math.PI)
	assert.equal(selectShadowLight(direction(-0.6), moon, settings, out), out)
	assert.equal(out.light, 'moon')
	assert.equal(out.direction, moon)
})

test('the sun/moon hand-over happens at zero strength', () => {
	const settings = createSceneryShadowSettings()
	for (const elevation of [-0.04, -0.01, 0, 0.01, 0.04]) {
		const { strength } = selectShadowLight(
			direction(elevation),
			direction(-elevation, Math.PI),
			settings,
		)
		assert.equal(strength, 0)
	}
})

test('strength is 0 when disabled and clamps the setting', () => {
	assert.equal(getShadowStrength({ enabled: false, strength: 1 }, 1), 0)
	assert.equal(getShadowStrength({ enabled: true, strength: 0.5 }, 0.5), 0.25)
	assert.equal(getShadowStrength({ enabled: true, strength: 2 }, 1), 1)
})

test('cascade spheres move ahead of the plane and contain the height range', () => {
	const settings = createSceneryShadowSettings()
	const cascade = settings.cascades[0]
	const sphere = getCascadeSphere(10, 20, 0, 2, cascade, settings)
	assert.equal(sphere.x, 10)
	assert.equal(sphere.z, 20 + cascade.radius * cascade.forwardShift)
	assert.equal(sphere.diskRadius, cascade.radius)
	const { min, max } = settings.heightRange
	assert.equal(sphere.y, (min + max) / 2)
	// Every disk point at any covered height lies inside the sphere.
	assert.ok(Math.hypot(cascade.radius, (max - min) / 2) <= sphere.sphereRadius + 1e-9)

	const still = getCascadeSphere(10, 20, 0, 0, cascade, settings)
	assert.equal(still.x, 10)
	assert.equal(still.z, 20)
})

test('the depth range holds the sphere plus the caster margin', () => {
	assert.deepEqual(getCascadeDepthRange(100, 60), { near: 0, far: 260 })
})

test('texel snapping rounds to the grid', () => {
	assert.equal(snapToTexel(1.26, 0.5), 1.5)
	assert.equal(snapToTexel(-1.24, 0.5), -1)
	assert.equal(snapToTexel(3, 1), 3)
})

test('the light basis changes only beyond the threshold', () => {
	const a = direction(0.5)
	const b = direction(0.5 + 0.001)
	const c = direction(0.5 + 0.01)
	assert.ok(Math.abs(getLightAngle(a, c) - 0.01) < 1e-9)
	assert.equal(hasLightDirectionChanged(null, a, 0.0035), true)
	assert.equal(hasLightDirectionChanged(a, b, 0.0035), false)
	assert.equal(hasLightDirectionChanged(a, c, 0.0035), true)
})

test('cascades render on staggered frames unless forced', () => {
	assert.equal(shouldRenderCascade(7, 0, 1), true)
	const frames = [0, 1, 2, 3, 4, 5].filter((frame) => shouldRenderCascade(frame, 1, 2))
	assert.deepEqual(frames, [1, 3, 5])
	const third = [0, 1, 2, 3, 4, 5].filter((frame) => shouldRenderCascade(frame, 1, 3))
	assert.deepEqual(third, [2, 5])
	assert.equal(shouldRenderCascade(0, 1, 3, true), true)
})

test('shadow tap defines cover both cascades and reject unsupported counts', () => {
	assert.deepEqual(getSceneryShadowTapDefines(8, 4), {
		SCENERY_SHADOW_TAPS_NEAR: 8,
		SCENERY_SHADOW_TAPS_FAR: 4,
	})
	assert.deepEqual(getSceneryShadowTapDefines(2), {
		SCENERY_SHADOW_TAPS_NEAR: 2,
		SCENERY_SHADOW_TAPS_FAR: 2,
	})
	for (const taps of [0, SCENERY_SHADOW_MAX_TAPS + 1, 2.5]) {
		assert.throws(() => getSceneryShadowTapDefines(taps), RangeError)
	}
	for (const preset of Object.values(SCENERY_SHADOW_PRESETS)) {
		const { terrain, mesh, impostor } = preset.taps
		assert.doesNotThrow(() => getSceneryShadowTapDefines(...terrain))
		assert.doesNotThrow(() => getSceneryShadowTapDefines(mesh))
		assert.doesNotThrow(() => getSceneryShadowTapDefines(impostor))
	}
})

test('the GLSL PCF kernel is the golden-angle spiral', () => {
	const glsl = readFileSync(
		new URL('../src/shaders/scenery-shadow-pars-fragment.glsl', import.meta.url),
		'utf8',
	)
	const table = glsl.match(/SCENERY_SHADOW_SPIRAL\[(\d+)\] = vec2\[\d+\]\(([^;]*)\);/)
	assert.ok(table, 'SCENERY_SHADOW_SPIRAL table')
	assert.equal(Number(table[1]), SCENERY_SHADOW_MAX_TAPS)
	const taps = [...table[2].matchAll(/vec2\(([-\d.]+), ([-\d.]+)\)/g)]
	assert.equal(taps.length, SCENERY_SHADOW_MAX_TAPS)
	taps.forEach(([, x, y], i) => {
		const radius = Math.sqrt(i + 0.5)
		const angle = i * 2.39996323
		assert.ok(Math.abs(Number(x) - radius * Math.cos(angle)) < 1e-6, `tap ${i} x`)
		assert.ok(Math.abs(Number(y) - radius * Math.sin(angle)) < 1e-6, `tap ${i} y`)
	})
})

test('cloud shadow settings are fresh copies of the device preset', () => {
	const desktop = createCloudShadowSettings()
	const mobile = createCloudShadowSettings({ isMobile: true })
	assert.equal(desktop.radius, CLOUD_SHADOW_PRESETS.desktop.radius)
	assert.equal(desktop.mapSize, CLOUD_SHADOW_PRESETS.desktop.mapSize)
	assert.equal(mobile.mapSize, CLOUD_SHADOW_PRESETS.mobile.mapSize)
	desktop.heightRange.max = 999
	assert.equal(createCloudShadowSettings().heightRange.max, CLOUD_SHADOW_DEFAULTS.heightRange.max)
})

test('the cloud shadow disk is centered on the plane and covers the receivers', () => {
	const settings = createCloudShadowSettings()
	const sphere = getCloudShadowSphere(120, -40, settings)
	assert.equal(sphere.x, 120)
	assert.equal(sphere.z, -40)
	assert.equal(sphere.diskRadius, settings.radius)
	const halfHeight = (settings.heightRange.max - settings.heightRange.min) / 2
	assert.ok(sphere.sphereRadius >= Math.hypot(settings.radius, halfHeight) - 1e-9)
})

test('the cloud shadow map renders only when needed', () => {
	const base = { center: [0, 0], x: 0, z: 0, recenterDistance: 100 }
	assert.equal(shouldRenderCloudShadow({ ...base, center: null }), true)
	assert.equal(shouldRenderCloudShadow(base), false)
	assert.equal(shouldRenderCloudShadow({ ...base, x: 99 }), false)
	assert.equal(shouldRenderCloudShadow({ ...base, x: 80, z: 80 }), true)
	assert.equal(shouldRenderCloudShadow({ ...base, lightChanged: true }), true)
	assert.equal(shouldRenderCloudShadow({ ...base, revisionChanged: true }), true)
	assert.equal(shouldRenderCloudShadow({ ...base, forced: true }), true)
})

test('the cloud shadow blur follows the softness and stays bounded', () => {
	assert.equal(getCloudShadowBlurTexels(6, 2), 3)
	assert.equal(getCloudShadowBlurTexels(0, 2), 0)
	assert.equal(getCloudShadowBlurTexels(100, 1), CLOUD_SHADOW_DEFAULTS.maxBlurTexels)
	assert.equal(getCloudShadowBlurTexels(6, 0), 0)
})
