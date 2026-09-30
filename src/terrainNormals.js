import { RepeatWrapping, TextureLoader, Vector2 } from 'three'
import fabricSrc from './textures/normal.jpg'
import dirtyCarpetSrc from './textures/dirty_carpet/dirty_carpet_nor_gl_1k.jpg'
import fabricPatternSrc from './textures/fabric_pattern/fabric_pattern_07_nor_gl_1k.jpg'
import hessianSrc from './textures/hessian/hessian_230_nor_gl_1k.jpg'
import ribbedCorduroySrc from './textures/ribbed_corduroy/ribbed_corduroy_nor_gl_1k.jpg'
import wafflePiqueSrc from './textures/waffle_pique/waffle_pique_cotton_nor_gl_1k.jpg'

// Normal maps the terrain layers can use. invertGreen flips the Y channel
// for maps that do not follow the OpenGL (+Y) convention.
export const TERRAIN_NORMAL_TEXTURES = Object.freeze({
	fabric: { src: fabricSrc, invertGreen: true },
	dirtyCarpet: { src: dirtyCarpetSrc, invertGreen: false },
	fabricPattern: { src: fabricPatternSrc, invertGreen: false },
	hessian: { src: hessianSrc, invertGreen: false },
	ribbedCorduroy: { src: ribbedCorduroySrc, invertGreen: false },
	wafflePique: { src: wafflePiqueSrc, invertGreen: false },
})

// Terrain layers in shader order: sea, then the five elevation bands of
// color-fragment.glsl from lowest to highest. `terrainBand` in that shader
// holds the index into this list.
export const TERRAIN_BANDS = Object.freeze([
	'sea',
	'sand',
	'grass',
	'land',
	'rocks',
	'snow',
])

// Which normal map each layer uses. texture is a TERRAIN_NORMAL_TEXTURES key,
// scale is the size of one texture tile in world units, and strength
// multiplies the normal-map XY. The debug GUI edits scale and strength.
export const TERRAIN_NORMAL_LAYERS = Object.freeze({
	sea: { texture: 'fabric', scale: 256 / 12, strength: 2 },
	sand: { texture: 'hessian', scale: 15, strength: 4.0 },
	grass: { texture: 'ribbedCorduroy', scale: 33, strength: 3.5 },
	land: { texture: 'wafflePique', scale: 25, strength: 1.85 },
	rocks: { texture: 'dirtyCarpet', scale: 40, strength: 2.5 },
	snow: { texture: 'fabricPattern', scale: 20, strength: 3.2 },
})

const loader = new TextureLoader()
const textures = new Map()

// Loads each texture once, so layers that share a map share the GPU copy.
export function getTerrainNormalTexture(name) {
	const source = TERRAIN_NORMAL_TEXTURES[name]
	if (!source) throw new Error(`Unknown terrain normal texture: ${name}`)

	if (!textures.has(name)) {
		const texture = loader.load(source.src)
		texture.wrapS = RepeatWrapping
		texture.wrapT = RepeatWrapping
		textures.set(name, texture)
	}

	return textures.get(name)
}

export function createTerrainNormalSettings(layers = TERRAIN_NORMAL_LAYERS) {
	return Object.fromEntries(
		TERRAIN_BANDS.map((band) => [band, { ...layers[band] }]),
	)
}

// Uniforms for terrain-normal-pars.glsl; arrays are indexed by TERRAIN_BANDS.
export function createTerrainNormalUniforms(settings) {
	const uniforms = {
		uTerrainNormalMaps: {
			value: TERRAIN_BANDS.map((band) =>
				getTerrainNormalTexture(settings[band].texture),
			),
		},
		uTerrainNormalScale: { value: new Array(TERRAIN_BANDS.length).fill(1) },
		// XY multiplier per layer; Y carries the texture's green-channel sign.
		uTerrainNormalStrength: {
			value: TERRAIN_BANDS.map(() => new Vector2()),
		},
	}
	updateTerrainNormalUniforms(uniforms, settings)

	return uniforms
}

export function updateTerrainNormalUniforms(uniforms, settings) {
	TERRAIN_BANDS.forEach((band, index) => {
		const layer = settings[band]
		const green = TERRAIN_NORMAL_TEXTURES[layer.texture].invertGreen ? -1 : 1
		uniforms.uTerrainNormalScale.value[index] = Math.max(layer.scale, 0.001)
		uniforms.uTerrainNormalStrength.value[index].set(
			layer.strength,
			layer.strength * green,
		)
	})
}
