import { DataTexture, MathUtils, RepeatWrapping, Vector2 } from 'three'
import { loadKTX2Texture } from './ktx2Textures'
import fabricSrc from './textures/normal.ktx2?url'
import curlyTeddySrc from './textures/curly_teddy/curly_teddy_checkered_nor_gl_1k.ktx2?url'
import dirtyCarpetSrc from './textures/dirty_carpet/dirty_carpet_nor_gl_1k.ktx2?url'
import fabricPatternSrc from './textures/fabric_pattern/fabric_pattern_07_nor_gl_1k.ktx2?url'
import hessianSrc from './textures/hessian/hessian_230_nor_gl_1k.ktx2?url'
import ribbedCorduroySrc from './textures/ribbed_corduroy/ribbed_corduroy_nor_gl_1k.ktx2?url'
import wafflePiqueSrc from './textures/waffle_pique/waffle_pique_cotton_nor_gl_1k.ktx2?url'

// Normal maps the terrain layers can use: KTX2 (ETC1S) with the normal's X in
// the color channels and Y in alpha, encoded by scripts/encode-assets.mjs from
// assets-src/textures/. invertGreen flips Y for maps that do not follow the
// OpenGL (+Y) convention.
export const TERRAIN_NORMAL_TEXTURES = Object.freeze({
	fabric: { src: fabricSrc, invertGreen: true },
	curlyTeddy: { src: curlyTeddySrc, invertGreen: false },
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
	sea: {
		texture: 'ribbedCorduroy',
		scale: 85,
		strength: 2,
		rotation: 50,
	},
	sand: { texture: 'hessian', scale: 15, strength: 4.0, rotation: 71 },
	grass: { texture: 'ribbedCorduroy', scale: 50, strength: 3.5, rotation: 137 },
	land: { texture: 'wafflePique', scale: 36, strength: 1.85, rotation: 204 },
	rocks: { texture: 'dirtyCarpet', scale: 35, strength: 2.5, rotation: 256 },
	snow: { texture: 'fabricPattern', scale: 20, strength: 3.2, rotation: 318 },
})

// Distance from the plane (world units) where every layer's normal map starts
// fading (start) and is gone (end). Fine patterns alias into moire if they
// reach too far.
export const TERRAIN_NORMAL_FADE = Object.freeze({ start: 150, end: 500 })

// Flat normal in the same layout (X in red, Y in alpha, both 0 at 128), used
// by every layer until its map is transcoded, and as the terrain material's
// normalMap, which only enables Three's tangent-space path.
export const FLAT_TERRAIN_NORMAL = new DataTexture(new Uint8Array([128, 128, 255, 128]), 1, 1)
FLAT_TERRAIN_NORMAL.needsUpdate = true

// Loads every map the layers of `settings` use, each once, and writes it into
// uTerrainNormalMaps when ready. Needs initKTX2Loader() (main.js).
export function loadTerrainNormalTextures(uniforms, settings) {
	const names = new Set(TERRAIN_BANDS.map((band) => settings[band].texture))
	for (const name of names) {
		const source = TERRAIN_NORMAL_TEXTURES[name]
		if (!source) throw new Error(`Unknown terrain normal texture: ${name}`)
		loadKTX2Texture(source.src, (texture) => {
			texture.wrapS = RepeatWrapping
			texture.wrapT = RepeatWrapping
			TERRAIN_BANDS.forEach((band, index) => {
				if (settings[band].texture === name) {
					uniforms.uTerrainNormalMaps.value[index] = texture
				}
			})
		})
	}
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
		// Flat until loadTerrainNormalTextures() swaps in each map.
		uTerrainNormalMaps: {
			value: TERRAIN_BANDS.map(() => FLAT_TERRAIN_NORMAL),
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
