// Encodes the asset masters in assets-src/ into the runtime files with fixed
// settings. Requires `basisu` (Basis Universal) on PATH, for example
// `brew install basis_universal`. Usage: pnpm assets:encode
import { execFileSync } from 'node:child_process'
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS, KHRTextureBasisu } from '@gltf-transform/extensions'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'

const root = fileURLToPath(new URL('..', import.meta.url))

// Terrain normal maps: X in the color channels and Y in alpha (two ETC1S
// slices; terrain-normal-pars.glsl rebuilds Z), resampled to a square 1024
// tile. The shader maps the whole image onto one square tile, so the resample
// keeps the mapping, and compressed formats need sides that are multiples of 4.
// Mipmaps are box-filtered in linear space without renormalization, like the
// GPU-generated mipmaps of the former JPEG maps: averaged normals get shorter
// with distance, so the strongly scaled fabric detail flattens instead of
// turning into noise.
const TERRAIN_NORMAL = [
	'-etc1s', '-q', '255', '-normal_map', '-separate_rg_to_color_alpha',
	'-mip_filter', 'box', '-mip_linear', '-resample', '1024', '1024',
]
// sRGB color.
const COLOR = ['-etc1s', '-q', '255']

const TEXTURES = [
	['textures/normal.jpg', TERRAIN_NORMAL],
	['textures/curly_teddy/curly_teddy_checkered_nor_gl_1k.jpg', TERRAIN_NORMAL],
	['textures/dirty_carpet/dirty_carpet_nor_gl_1k.jpg', TERRAIN_NORMAL],
	['textures/fabric_pattern/fabric_pattern_07_nor_gl_1k.jpg', TERRAIN_NORMAL],
	['textures/hessian/hessian_230_nor_gl_1k.jpg', TERRAIN_NORMAL],
	['textures/ribbed_corduroy/ribbed_corduroy_nor_gl_1k.jpg', TERRAIN_NORMAL],
	['textures/waffle_pique/waffle_pique_cotton_nor_gl_1k.jpg', TERRAIN_NORMAL],
	['textures/white_oak/white_oak_veneer_diff_1k.jpg', COLOR],
]

// Airplane textures per glTF slot, at their source size. The meshopt
// geometry is written back unchanged (checked below).
const MODEL_SLOTS = {
	baseColor: COLOR,
	metallicRoughness: ['-etc1s', '-q', '255', '-linear'],
	normal: ['-etc1s', '-q', '255', '-normal_map'],
}
const MODELS = ['plane-toy/plane-toy.glb', 'plane-toy/plane-toy-2.glb']

function encode(source, target, args) {
	mkdirSync(dirname(target), { recursive: true })
	execFileSync(
		'basisu',
		[...args, '-mipmap', '-ktx2', '-output_file', target, source],
		{ stdio: 'ignore' },
	)
}

for (const [path, args] of TEXTURES) {
	const target = join(root, 'src', path.replace(/\.\w+$/, '.ktx2'))
	encode(join(root, 'assets-src', path), target, args)
	console.log(`${path} -> ${target.slice(root.length)}`)
}

await MeshoptDecoder.ready
await MeshoptEncoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
	'meshopt.decoder': MeshoptDecoder,
	'meshopt.encoder': MeshoptEncoder,
})
const work = mkdtempSync(join(tmpdir(), 'encode-assets-'))
try {
	for (const path of MODELS) {
		const source = join(root, 'assets-src', path)
		const target = join(root, 'public', path)
		const document = await io.read(source)
		for (const material of document.getRoot().listMaterials()) {
			const slots = {
				baseColor: material.getBaseColorTexture(),
				metallicRoughness: material.getMetallicRoughnessTexture(),
				normal: material.getNormalTexture(),
			}
			for (const [slot, texture] of Object.entries(slots)) {
				if (!texture) continue
				const extension = texture.getMimeType() === 'image/png' ? 'png' : 'jpg'
				const image = join(work, `${slot}.${extension}`)
				const encoded = join(work, `${slot}.ktx2`)
				writeFileSync(image, texture.getImage())
				encode(image, encoded, MODEL_SLOTS[slot])
				texture.setImage(readFileSync(encoded)).setMimeType('image/ktx2')
			}
		}
		document.createExtension(KHRTextureBasisu).setRequired(true)
		await io.write(target, document)

		const before = (await io.read(source)).getRoot().listAccessors()
		const after = (await io.read(target)).getRoot().listAccessors()
		const unchanged =
			before.length === after.length &&
			before.every((accessor, index) => {
				const a = accessor.getArray()
				const b = after[index].getArray()
				return a.length === b.length && a.every((value, i) => value === b[i])
			})
		if (!unchanged) throw new Error(`${path}: geometry changed while re-encoding`)
		console.log(`${path} -> public/${path}`)
	}
} finally {
	rmSync(work, { recursive: true, force: true })
}
