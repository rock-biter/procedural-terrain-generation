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
	assert.match(lighting.lightsFragment, /\(1\.0 - sceneryMapShadow\) \* uSceneryShadowSpecular/)
	assert.match(lighting.lightsFragment, /\(1\.0 - sceneryCloudShadow\) \* uCloudShadowSpecular/)
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
		createSceneryLighting(),
		createSceneryLighting({ ambientScale: { value: 1 }, translucent: true }),
	]) {
		const code = getDirectionalLightCode(lighting.lightsFragment)
		assert.match(code, /curved|directLight\.color \*= smoothstep/)
		assert.doesNotMatch(code, /[{}]/)
		assert.doesNotMatch(code, /\b(float|int|bool|vec[234]|mat[234])\s+\w+\s*=/)
	}
})

test('the low-sun occlusion and the translucency are defines over one text', () => {
	const plain = createSceneryLighting({ shadows: SHADOWS })
	const lowSun = createSceneryLighting({ shadows: SHADOWS, sunOcclusion: { steps: 12 } })
	assert.equal(plain.lightsFragment, lowSun.lightsFragment)
	assert.equal(plain.parsFragment, lowSun.parsFragment)
	assert.equal(lowSun.defines.SUN_OCCLUSION_STEPS, 12)
	assert.ok(!('SUN_OCCLUSION_STEPS' in plain.defines))
	assert.match(lowSun.lightsFragment, /getSunOcclusion\(vShadowPosition, distanceFromCamera,/)
	assert.match(lowSun.parsFragment, /vec2 getSunOcclusion\(/)

	const scale = { value: 2 }
	const opaque = createSceneryLighting({ ambientScale: scale })
	const translucent = createSceneryLighting({ ambientScale: scale, translucent: true })
	assert.equal(opaque.lightsFragment, translucent.lightsFragment)
	assert.ok('CLOUD_TRANSLUCENCY' in translucent.defines)
	assert.ok(!('CLOUD_TRANSLUCENCY' in opaque.defines))
	assert.match(
		getDirectionalLightCode(translucent.lightsFragment),
		/reflectedLight\.directDiffuse \+= getCloudTranslucency\(directLight\.color,/,
	)
	assert.match(translucent.parsFragment, /vec3 getCloudTranslucency\(/)
})
