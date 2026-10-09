import assert from 'node:assert/strict'
import test from 'node:test'
import { createAppParams } from '../src/appParams.js'
import {
	copySeaSurfaceSettings,
	createSeaSurfaceSettings,
	getSeaBreakingLags,
	getSeaRegionDrift,
	getSeaWaveBound,
	getSeaWaveComponents,
	SEA_BREAKING_LAGS,
	SEA_GRAVITY,
	SEA_SURFACE_DEFAULTS,
	SEA_TYPES,
	SEA_WAVE_ANGLES,
	SEA_WAVE_COUNT,
	SEA_WAVE_RATIOS,
} from '../src/seaSurfacePolicy.js'
import { createSharedUniforms, updateSeaSurfaceUniforms } from '../src/sharedUniforms.js'

const close = (actual, expected, message) =>
	assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} != ${expected}`)

test('the settings are a deep mutable copy of the defaults', () => {
	const settings = createSeaSurfaceSettings()
	assert.deepEqual(settings, JSON.parse(JSON.stringify(SEA_SURFACE_DEFAULTS)))
	settings.sea.waves.amplitude = 99
	settings.sea.foam.intensity = 99
	assert.notEqual(SEA_SURFACE_DEFAULTS.sea.waves.amplitude, 99)
	// The two types never share a group object.
	assert.notEqual(settings.ocean.foam.intensity, 99)
	for (const type of SEA_TYPES) {
		for (const group of Object.keys(settings[type])) {
			assert.ok(!Object.isFrozen(settings[type][group]), `${type}.${group}`)
		}
	}
})

test('the reset copies every setting in place', () => {
	const settings = createSeaSurfaceSettings()
	const waves = settings.ocean.waves
	settings.ocean.waves.speed = 3
	settings.regions.scale = 1
	settings.debugView = 4
	copySeaSurfaceSettings(createSeaSurfaceSettings(), settings)
	assert.equal(settings.ocean.waves, waves)
	assert.deepEqual(settings, createSeaSurfaceSettings())
})

test('the wave components follow the wind, the ratios, and deep water dispersion', () => {
	for (const type of SEA_TYPES) {
		const { waves } = SEA_SURFACE_DEFAULTS[type]
		const components = getSeaWaveComponents(waves)
		assert.equal(components.length, SEA_WAVE_COUNT)
		let amplitude = 0
		let squeeze = 0
		components.forEach((component, index) => {
			close(Math.hypot(component.x, component.z), 1, 'unit direction')
			const angle = (Math.atan2(component.z, component.x) * 180) / Math.PI
			const expected = waves.direction + SEA_WAVE_ANGLES[index] * waves.spread
			close(((angle - expected + 540) % 360) - 180, 0, 'direction')
			close((2 * Math.PI) / component.k, waves.wavelength * SEA_WAVE_RATIOS[index], 'wavelength')
			close(component.omega, Math.sqrt(SEA_GRAVITY * component.k) * waves.speed, 'dispersion')
			amplitude += component.amplitude
			squeeze += component.k * component.reach
		})
		// The amplitude is the highest crest; the crests squeeze by at most the
		// steepness, so they never fold over.
		close(amplitude, waves.amplitude, 'amplitude')
		close(squeeze, waves.steepness, 'squeeze')
		// Longer waves travel faster.
		assert.ok(components[0].omega / components[0].k > components[3].omega / components[3].k)
	}
	const steep = getSeaWaveComponents({ ...SEA_SURFACE_DEFAULTS.sea.waves, steepness: 3 })
	close(
		steep.reduce((sum, { k, reach }) => sum + k * reach, 0),
		1,
		'steepness clamped to 1',
	)
})

test('calm water keeps some crest lines and ripples, the deep ocean more ripples', () => {
	const { sea, ocean } = SEA_SURFACE_DEFAULTS
	for (const group of ['crests', 'breaking', 'ripples']) {
		for (const type of [sea, ocean]) assert.ok(type[group].minimum > 0, group)
	}
	assert.ok(ocean.ripples.minimum > sea.ripples.minimum)
	// The ripples' floor lifts the calmest regions' map strength.
	for (const { ripples } of [sea, ocean]) {
		assert.ok(ripples.minimum > 1 - ripples.stateStrength)
	}
})

test('the bound covers the largest displacement of both types', () => {
	const settings = createSeaSurfaceSettings()
	const bound = getSeaWaveBound(settings)
	for (const type of SEA_TYPES) {
		const { waves } = settings[type]
		assert.ok(bound.vertical >= waves.amplitude * Math.max(waves.calm, waves.rough))
		const reach = getSeaWaveComponents(waves).reduce((sum, component) => sum + component.reach, 0)
		assert.ok(bound.horizontal >= reach)
	}
	settings.ocean.waves.calm = 5
	assert.equal(getSeaWaveBound(settings).vertical, settings.ocean.waves.amplitude * 5)
})

test('the breaking foam samples its trail evenly, short of its end', () => {
	assert.deepEqual(getSeaBreakingLags(2.5), [0.5, 1, 1.5, 2])
	assert.deepEqual(getSeaBreakingLags(-1), [0, 0, 0, 0])
	assert.equal(getSeaBreakingLags(1).length, SEA_BREAKING_LAGS)
})

test('the regions drift along their direction', () => {
	const [x, z] = getSeaRegionDrift({ drift: 2, direction: 90 })
	close(x, 0, 'x')
	close(z, 2, 'z')
})

test('the uniforms mirror the settings and keep every smoothstep ordered', () => {
	const params = createAppParams({ urlParams: new URLSearchParams(), isMobile: false })
	const uniforms = createSharedUniforms(params, 'sea')
	const settings = params.seaSurface
	assert.equal(uniforms.uSeaWaves.value.length, SEA_TYPES.length * SEA_WAVE_COUNT)
	SEA_TYPES.forEach((key, type) => {
		getSeaWaveComponents(settings[key].waves).forEach((component, index) => {
			const slot = type * SEA_WAVE_COUNT + index
			assert.deepEqual(uniforms.uSeaWaves.value[slot].toArray(), [
				component.x,
				component.z,
				component.k,
				component.omega,
			])
		})
		const { waves, coast, crests, ripples } = settings[key]
		assert.deepEqual(uniforms.uSeaWaveShape.value[type].toArray(), [
			waves.calm,
			waves.rough,
			coast.start,
			coast.full,
		])
		assert.deepEqual(uniforms.uSeaMinimum.value[type].toArray(), [
			crests.minimum,
			ripples.minimum,
			settings[key].breaking.minimum,
		])
		// The breaking foam's trail: each component's phase turns over the lags.
		const lags = getSeaBreakingLags(settings[key].breaking.trail)
		getSeaWaveComponents(waves).forEach((component, index) => {
			const slot = type * SEA_WAVE_COUNT + index
			lags.forEach((lag, step) => {
				close(
					uniforms.uSeaWaveLagCos.value[slot].getComponent(step),
					Math.cos(component.omega * lag),
					'cos',
				)
				close(
					uniforms.uSeaWaveLagSin.value[slot].getComponent(step),
					Math.sin(component.omega * lag),
					'sin',
				)
			})
		})
		assert.equal(uniforms.uSeaCrestWaves.value[type], crests.waves)
	})

	settings.vertex.fadeStart = 300
	settings.vertex.fadeEnd = 100
	settings.sea.coast.start = 5
	settings.sea.coast.full = 2
	settings.ocean.foam.start = 4
	settings.ocean.foam.full = 1
	settings.debugView = 2
	updateSeaSurfaceUniforms(uniforms, settings)
	const [fadeStart, fadeEnd, , debugView] = uniforms.uSeaSurface.value.toArray()
	assert.ok(fadeEnd > fadeStart)
	assert.equal(debugView, 2)
	const shape = uniforms.uSeaWaveShape.value[0]
	assert.ok(shape.w > shape.z)
	const band = uniforms.uSeaFoamLineBand.value[1]
	assert.ok(band.y > band.x && band.w > band.z)
})
