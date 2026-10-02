import assert from 'node:assert/strict'
import test from 'node:test'
import {
	AIRPLANE_MODELS,
	DEFAULT_AIRPLANE_MODEL,
	getAirplaneModelKey,
} from '../src/airplaneModels.js'

test('the plane parameter picks a known model or the default', () => {
	assert.equal(getAirplaneModelKey(new URLSearchParams('plane=toy')), 'toy')
	assert.equal(getAirplaneModelKey(new URLSearchParams('plane=biplane')), 'biplane')
	assert.equal(getAirplaneModelKey(new URLSearchParams('plane=nope')), DEFAULT_AIRPLANE_MODEL)
	assert.equal(getAirplaneModelKey(new URLSearchParams('')), DEFAULT_AIRPLANE_MODEL)
	assert.equal(getAirplaneModelKey(new URLSearchParams('plane=toString')), DEFAULT_AIRPLANE_MODEL)
})

test('every model has the data the loader and Plane need', () => {
	assert.ok(Object.hasOwn(AIRPLANE_MODELS, DEFAULT_AIRPLANE_MODEL))
	for (const model of Object.values(AIRPLANE_MODELS)) {
		assert.match(model.path, /^\/.+\.glb$/)
		assert.equal(typeof model.rotationY, 'number')
		assert.ok(model.wingspan > 0)
		assert.equal(model.trailAnchor.length, 3)
		assert.equal(model.propeller.axis.length, 2)
		assert.ok(model.propeller.minZ > 0)
		for (const plug of model.propeller.plugs) {
			assert.equal(typeof plug.z, 'number')
			if (plug.radius === undefined) assert.ok(plug.outerRadius > plug.innerRadius)
			else assert.ok(plug.radius > 0)
		}
	}
})
