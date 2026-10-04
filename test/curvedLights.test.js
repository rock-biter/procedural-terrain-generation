import assert from 'node:assert/strict'
import test from 'node:test'
import { createSceneryLighting } from '../src/curvedLights.js'

test('shadowed lighting carries the tap defines and the shadow lookup', () => {
	const lighting = createSceneryLighting({
		shadows: { taps: [8, 4], position: 'vShadowPosition', selfBias: '0.0' },
	})
	assert.deepEqual(lighting.defines, { SCENERY_SHADOW_TAPS_NEAR: 8, SCENERY_SHADOW_TAPS_FAR: 4 })
	assert.match(lighting.lightsFragment, /getSceneryShadow\(vShadowPosition, 0\.0\)/)
	assert.match(lighting.parsFragment, /float getSceneryShadow\(/)
	assert.deepEqual(lighting.uniforms, {})
})

test('the ambient scale is a define, so the programs never mix', () => {
	const scale = { value: 2 }
	const plain = createSceneryLighting()
	const scaled = createSceneryLighting({ ambientScale: scale })
	assert.ok('SCENERY_NO_SHADOWS' in plain.defines)
	assert.ok(!('SCENERY_AMBIENT_SCALE' in plain.defines))
	assert.ok('SCENERY_AMBIENT_SCALE' in scaled.defines)
	// Same GLSL text: only the define tells the two programs apart.
	assert.equal(plain.lightsFragment, scaled.lightsFragment)
	assert.equal(plain.parsFragment, scaled.parsFragment)
	assert.equal(scaled.uniforms.uSceneryAmbientScale, scale)
	assert.doesNotMatch(plain.lightsFragment, /getSceneryShadow\(/)
})
