import { Color, Vector2, Vector3 } from 'three'
import { createBiomeOffset } from './biome'
import { createCloudShadowUniforms } from './cloudShadows'
import { createSceneryShadowUniforms } from './sceneryShadows'
import { createSeaFoamUniforms } from './seaFoam'
import { createTerrainNormalUniforms } from './terrainNormals'
import { CURVATURE } from './worldConstants'

// Uniforms shared by the terrain, scenery, clouds, and debug materials: one
// object whose entries every material references, so a write reaches them
// all. `params` is createAppParams(); `seed` sets the biome offset.
export function createSharedUniforms(params, seed) {
	return {
		uTime: { value: 0 },
		uCamera: { value: new Vector3() },
		uCurvature: { value: CURVATURE },
		uLand: { value: new Color(params.colors.uLand) },
		uGrass: { value: new Color(params.colors.uGrass) },
		uRocks: { value: new Color(params.colors.uRocks) },
		// Written by DayNight before the first render.
		uAtmosphere: { value: new Color() },
		uBiomeOffset: { value: new Vector2(...createBiomeOffset(seed)) },
		uColorNoiseFrequency: { value: params.terrainColorNoise.frequency },
		uColorNoiseIntensity: { value: params.terrainColorNoise.intensity },
		uColorNoiseThreshold: { value: params.terrainColorNoise.threshold },
		uColorNoiseSoftness: { value: params.terrainColorNoise.softness },
		uColorNoiseSpeed: { value: params.terrainColorNoise.speed },
		uCoastSandShade: { value: params.coastSand.shade },
		...createTerrainNormalUniforms(params.terrainNormals),
		// Impostor-to-mesh band; written by SceneryMeshes.applySettings().
		uSceneryMeshRange: { value: new Vector2(-2, -1) },
		// Shadow maps, matrices, and fades; written by SceneryShadows.
		...createSceneryShadowUniforms(params.shadows),
		// Cloud shadow map, matrix, and strength; written by CloudShadows.
		...createCloudShadowUniforms(),
		// Sea rock distance map and ripple shape; written by SeaFoam.
		...createSeaFoamUniforms(),
	}
}
