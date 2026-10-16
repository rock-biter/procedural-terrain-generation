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
})

const SHADOWS = { taps: [8, 4], position: 'vShadowPosition', selfBias: '0.0' }

// The code each variant adds to the directional light loop, from the light's
// info up to its RE_Direct().
function getDirectionalLightCode(lightsFragment) {
	const start = lightsFragment.indexOf('getDirectionalLightInfo( directionalLight, directLight );')
	return lightsFragment.slice(start, lightsFragment.indexOf('RE_Direct(', start))
}

test('the shadows dim the glare of their own light, through its specular term', () => {
	const lighting = createSceneryLighting({ shadows: SHADOWS })
	assert.match(
		lighting.lightsFragment,
		/IncidentLight directLight;\nvec3 sceneryMultiScattering = material\.multiScatteringCompensation;/,
	)
	assert.match(lighting.lightsFragment, /\(1\.0 - sceneryShadow\) \* uSceneryShadowSpecular/)
	assert.doesNotMatch(lighting.lightsFragment, /Cloud/)
	assert.match(
		getDirectionalLightCode(lighting.lightsFragment),
		/material\.multiScatteringCompensation = sceneryMultiScattering \* mix\(1\.0, sceneryShadowSpecular, step\(0\.0, dot\(directLight\.direction, sceneryShadowLightView\)\)\);/,
	)
})

test('the code added to the directional light loop survives its unrolling', () => {
	// three's unrollLoops() copies the loop body without its braces and ends
	// it at the first closing brace: no declarations, no braces.
	for (const lighting of [
		createSceneryLighting({ shadows: SHADOWS }),
		createSceneryLighting({ shadows: SHADOWS, sunOcclusion: { steps: 12 } }),
	]) {
		const code = getDirectionalLightCode(lighting.lightsFragment)
		assert.match(code, /curved|directLight\.color \*= smoothstep/)
		assert.doesNotMatch(code, /[{}]/)
		assert.doesNotMatch(code, /\b(float|int|bool|vec[234]|mat[234])\s+\w+\s*=/)
	}
})

test('the low-sun occlusion is a define over one text', () => {
	const plain = createSceneryLighting({ shadows: SHADOWS })
	const lowSun = createSceneryLighting({ shadows: SHADOWS, sunOcclusion: { steps: 12 } })
	assert.equal(plain.lightsFragment, lowSun.lightsFragment)
	assert.equal(plain.parsFragment, lowSun.parsFragment)
	assert.equal(lowSun.defines.SUN_OCCLUSION_STEPS, 12)
	assert.ok(!('SUN_OCCLUSION_STEPS' in plain.defines))
	assert.match(lowSun.lightsFragment, /getSunOcclusion\(vShadowPosition, distanceFromCamera,/)
	assert.match(lowSun.parsFragment, /vec2 getSunOcclusion\(/)
})

test('a directional light whose color is zero skips its RE_Direct()', () => {
	const { lightsFragment } = createSceneryLighting({ shadows: SHADOWS })
	const block = lightsFragment.slice(lightsFragment.indexOf('#if ( NUM_DIR_LIGHTS > 0 )'))
	assert.match(
		block,
		/if \( any\( notEqual\( directionalLight\.color, vec3\( 0\.0 \) \) \) \) RE_Direct\( directLight,/,
	)
	// Only the directional lights' call, once: the other light types keep theirs.
	assert.equal(lightsFragment.match(/notEqual\( directionalLight\.color/g).length, 1)
})
