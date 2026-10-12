import {
	DataTexture,
	LinearFilter,
	LinearMipmapLinearFilter,
	RepeatWrapping,
	RGBAFormat,
	UnsignedByteType,
} from 'three'
import { generateNoiseTile, NOISE_TILE_SIZE } from './noiseTexturePolicy'

// The baked tileable noise (rules in src/noiseTexturePolicy.js), sampled by
// noise-texture-pars.glsl: four independent fields in an RGBA8 tile that
// repeats, with mipmaps, so distant samples average instead of aliasing. Built
// once per page on the main thread (about 50 ms); the shared uniforms hold it
// for the page and never dispose it.
export function createNoiseTexture() {
	const texture = new DataTexture(
		generateNoiseTile(),
		NOISE_TILE_SIZE,
		NOISE_TILE_SIZE,
		RGBAFormat,
		UnsignedByteType,
	)
	texture.name = 'NoiseTile'
	texture.wrapS = RepeatWrapping
	texture.wrapT = RepeatWrapping
	texture.magFilter = LinearFilter
	texture.minFilter = LinearMipmapLinearFilter
	texture.generateMipmaps = true
	texture.needsUpdate = true
	return texture
}
