import assert from 'node:assert/strict'
import test from 'node:test'
import { PerspectiveCamera, Vector3 } from 'three'
import {
	LENS_FLARE_DEFAULTS,
	SUN_DISC_FADE,
	createLensFlareSettings,
	getLensFlareGate,
	getOcclusionRadiusUv,
	getScreenEdgeFade,
	getSunDiscVisibility,
	getSunScreenPosition,
	getOcclusionTapFootprint,
	getTemporalBlend,
	shouldTestHorizonClouds,
} from '../src/lensFlarePolicy.js'
import { smoothstep } from '../src/math.js'

function assertClose(actual, expected, tolerance = 1e-9) {
	assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not ${expected}`)
}

// A camera at the origin looking down -Z, matrices current.
function createCamera({ aspect = 16 / 9, zoom = 1 } = {}) {
	const camera = new PerspectiveCamera(60, aspect, 1, 10000)
	camera.zoom = zoom
	camera.updateProjectionMatrix()
	camera.lookAt(new Vector3(0, 0, -1))
	camera.updateMatrixWorld()
	return camera
}

function project(camera, direction) {
	return getSunScreenPosition(
		direction,
		camera.matrixWorldInverse.elements,
		camera.projectionMatrix.elements,
	)
}

test('lens flare settings are a mutable deep copy of the defaults', () => {
	const settings = createLensFlareSettings()
	settings.glow.size = 1
	settings.debug.showTaps = true
	assert.equal(LENS_FLARE_DEFAULTS.glow.size, createLensFlareSettings().glow.size)
	assert.equal(createLensFlareSettings().debug.showTaps, false)
	assert.equal(settings.enabled, true)
})

test('the flare follows the sky disc, which the horizon dip lifts', () => {
	for (const dip of [0, 0.2]) {
		for (const sunY of [-0.4, -0.15, -0.05, 0, 0.05, 0.3]) {
			assertClose(
				getSunDiscVisibility(sunY, dip),
				smoothstep(SUN_DISC_FADE.start, SUN_DISC_FADE.end, sunY + Math.sin(dip)),
			)
		}
	}
	assert.equal(getSunDiscVisibility(-0.2, 0), 0)
	assert.ok(getSunDiscVisibility(-0.2, 0.25) > 0)
})

test('the sun projects through the camera like a point at infinity', () => {
	const camera = createCamera()
	const ahead = project(camera, [0, 0, -1])
	assert.equal(ahead.inFront, true)
	assertClose(ahead.u, 0.5)
	assertClose(ahead.v, 0.5)
	assert.equal(project(camera, [0, 0, 1]).inFront, false)
	const direction = new Vector3(0.3, 0.12, -1).normalize()
	const screen = project(camera, direction.toArray())
	// From the origin, a far point along the direction projects the same.
	const point = direction.clone().multiplyScalar(5000).project(camera)
	assertClose(screen.u, 0.5 + 0.5 * point.x, 1e-9)
	assertClose(screen.v, 0.5 + 0.5 * point.y, 1e-9)
	assert.ok(screen.u > 0.5 && screen.v > 0.5)
})

test('the occlusion disc follows the zoom and the aspect', () => {
	const radius = getOcclusionRadiusUv(createCamera().projectionMatrix.elements, 1.3)
	const zoomed = getOcclusionRadiusUv(createCamera({ zoom: 0.8 }).projectionMatrix.elements, 1.3)
	assertClose(zoomed.u / radius.u, 0.8)
	assertClose(zoomed.v / radius.v, 0.8)
	assertClose(radius.u / radius.v, 9 / 16)
	// A direction that far off the view axis lands on the disc's edge.
	const angle = (1.3 * Math.PI) / 180
	const edge = project(createCamera(), [0, Math.sin(angle), -Math.cos(angle)])
	assertClose(edge.v - 0.5, radius.v)
})

test('the flare fades out as the sun leaves the screen', () => {
	assert.equal(getScreenEdgeFade(0.5, 0.5, 0.01, 0.02, 0.06), 1)
	assert.equal(getScreenEdgeFade(-0.011, 0.5, 0.01, 0.02, 0.06), 0)
	assert.equal(getScreenEdgeFade(0.5, 1.021, 0.01, 0.02, 0.06), 0)
	let previous = 0
	for (let u = -0.01; u <= 0.06; u += 0.005) {
		const fade = getScreenEdgeFade(u, 0.5, 0.01, 0.02, 0.06)
		assert.ok(fade >= previous)
		previous = fade
	}
})

test('the occlusion eases toward each new count', () => {
	assert.equal(getTemporalBlend(0.016, 0), 0)
	assert.equal(getTemporalBlend(0, 0.08), 1)
	assert.equal(getTemporalBlend(-0.5, 0.08), 1)
	assertClose(getTemporalBlend(0.08, 0.08), Math.exp(-1))
})

test('the gate closes behind the camera, when off, and at night', () => {
	const settings = createLensFlareSettings()
	const front = { inFront: true }
	assert.equal(getLensFlareGate(settings, 1, front, 1), 1)
	assert.equal(getLensFlareGate(settings, 0.5, front, 0.5), 0.25)
	assert.equal(getLensFlareGate({ ...settings, enabled: false }, 1, front, 1), 0)
	assert.equal(getLensFlareGate({ ...settings, intensity: 0 }, 1, front, 1), 0)
	assert.equal(getLensFlareGate(settings, 1, { inFront: false }, 1), 0)
	assert.equal(getLensFlareGate(settings, getSunDiscVisibility(-0.9, 0.2), front, 1), 0)
})

test('the occlusion tests the horizon clouds only while the disc reaches their band', () => {
	const degree = Math.PI / 180
	// [dip, band bottom, band top, on]
	const frame = [0.2, -1 * degree, 14 * degree, 1]
	assert.equal(shouldTestHorizonClouds(5 * degree, 1.3, frame), true)
	assert.equal(shouldTestHorizonClouds(14.5 * degree, 1.3, frame), true)
	assert.equal(shouldTestHorizonClouds(40 * degree, 1.3, frame), false)
	assert.equal(shouldTestHorizonClouds(-3 * degree, 1.3, frame), false)
	assert.equal(shouldTestHorizonClouds(5 * degree, 1.3, [0.2, -0.02, 0.24, 0]), false)
	assert.equal(shouldTestHorizonClouds(5 * degree, 1.3, null), false)
	// About the spacing of 32 taps over the disc.
	assertClose(getOcclusionTapFootprint(1.3, 32), (2.6 * degree) / Math.sqrt(32))
})
