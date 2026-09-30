import { MathUtils, RepeatWrapping, TextureLoader, Vector2 } from 'three'
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
// scale is the size of one texture tile in world units, strength multiplies
// the normal-map XY, and rotation turns the texture on the ground in degrees
// (counter-clockwise seen from above). The debug GUI edits all three.
// Rotations are arbitrary, but consecutive layers differ by at least 15
// degrees even modulo 90, so neighbouring bands never line up their patterns.
export const TERRAIN_NORMAL_LAYERS = Object.freeze({
	sea: { texture: 'fabric', scale: 256 / 12, strength: 2, rotation: 23 },
	sand: { texture: 'hessian', scale: 15, strength: 4.0, rotation: 71 },
	grass: { texture: 'ribbedCorduroy', scale: 33, strength: 3.5, rotation: 137 },
	land: { texture: 'wafflePique', scale: 36, strength: 1.85, rotation: 204 },
	rocks: { texture: 'dirtyCarpet', scale: 35, strength: 2.5, rotation: 256 },
	snow: { texture: 'fabricPattern', scale: 20, strength: 3.2, rotation: 318 },
})

// Distance from the plane (world units) where every layer's normal map starts
// fading (start) and is gone (end). Fine patterns alias into moire if they
// reach too far.
export const TERRAIN_NORMAL_FADE = Object.freeze({ start: 50, end: 300 })

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

export function createTerrainNormalSettings(
	layers = TERRAIN_NORMAL_LAYERS,
	fade = TERRAIN_NORMAL_FADE,
) {
	return {
		...Object.fromEntries(
			TERRAIN_BANDS.map((band) => [band, { ...layers[band] }]),
		),
		fade: { ...fade },
	}
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
		// (cos, sin) of each layer's rotation.
		uTerrainNormalRotation: {
			value: TERRAIN_BANDS.map(() => new Vector2(1, 0)),
		},
		// x = fade start, y = fade end, in world units from the plane.
		uTerrainNormalFade: { value: new Vector2() },
	}
	updateTerrainNormalUniforms(uniforms, settings)

	return uniforms
}

export function updateTerrainNormalUniforms(uniforms, settings) {
	// smoothstep() is undefined unless start < end.
	const { start, end } = settings.fade
	uniforms.uTerrainNormalFade.value.set(start, Math.max(end, start + 1))
	TERRAIN_BANDS.forEach((band, index) => {
		const layer = settings[band]
		const green = TERRAIN_NORMAL_TEXTURES[layer.texture].invertGreen ? -1 : 1
		uniforms.uTerrainNormalScale.value[index] = Math.max(layer.scale, 0.001)
		uniforms.uTerrainNormalStrength.value[index].set(
			layer.strength,
			layer.strength * green,
		)
		const angle = MathUtils.degToRad(layer.rotation ?? 0)
		uniforms.uTerrainNormalRotation.value[index].set(
			Math.cos(angle),
			Math.sin(angle),
		)
	})
}
