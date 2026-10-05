// Encodes the asset masters in assets-src/ into the runtime files with fixed
// settings. Requires `basisu` (Basis Universal) on PATH, for example
// `brew install basis_universal`. Usage: pnpm assets:encode
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Document, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS, EXTMeshoptCompression, KHRTextureBasisu } from '@gltf-transform/extensions'
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'

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
	'-etc1s',
	'-q',
	'255',
	'-normal_map',
	'-separate_rg_to_color_alpha',
	'-mip_filter',
	'box',
	'-mip_linear',
	'-resample',
	'1024',
	'1024',
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

// Shadow casters: each airplane simplified to about this many triangles,
// positions only, written next to the model as `<name>-shadow.glb`. The error
// bound is a share of the model's extent; the penumbra (0.6 world units, about
// 8% of the wingspan) hides far more than that.
const SHADOW_CASTER_TRIANGLES = 4000
const SHADOW_CASTER_ERROR = 0.02

// Simplified copy of the first primitive of `document` for the shadow pass,
// in the same geometry space as the model. Vertices split only by uv or normal
// seams are welded first, so the simplifier sees one connected surface. The
// fused parts leave non-manifold vertices, which the simplifier locks by
// default (both airplanes stalled near 24k and 36k triangles); `Permissive`
// lets it collapse them, and only positions matter for a shadow.
function createShadowCaster(document) {
	const primitive = document.getRoot().listMeshes()[0].listPrimitives()[0]
	const positions = Float32Array.from(primitive.getAttribute('POSITION').getArray())
	const remap = MeshoptSimplifier.generatePositionRemap(positions, 3)
	const indices = Uint32Array.from(primitive.getIndices().getArray(), (index) => remap[index])
	const [simplified, error] = MeshoptSimplifier.simplify(
		indices,
		positions,
		3,
		SHADOW_CASTER_TRIANGLES * 3,
		SHADOW_CASTER_ERROR,
		['Permissive'],
	)
	const [vertexRemap, vertexCount] = MeshoptSimplifier.compactMesh(simplified)
	const compact = new Float32Array(vertexCount * 3)
	vertexRemap.forEach((target, source) => {
		if (target < vertexCount)
			compact.set(positions.subarray(source * 3, source * 3 + 3), target * 3)
	})

	const caster = new Document()
	const buffer = caster.createBuffer()
	const casterPrimitive = caster
		.createPrimitive()
		.setAttribute(
			'POSITION',
			caster.createAccessor().setType('VEC3').setArray(compact).setBuffer(buffer),
		)
		.setIndices(
			caster
				.createAccessor()
				.setType('SCALAR')
				.setArray(Uint16Array.from(simplified))
				.setBuffer(buffer),
		)
	const mesh = caster.createMesh('shadow-caster').addPrimitive(casterPrimitive)
	caster.createScene().addChild(caster.createNode('shadow-caster').setMesh(mesh))
	return { caster, triangles: simplified.length / 3, vertices: vertexCount, error }
}

// The boat, a scenery type drawn as an impostor and two near-mesh levels
// (src/impostors/boatSources.js): each level is the master simplified to about
// `triangles`, keeping its uv (the simplifier only collapses along the uv
// seams), with the base color alone, resampled to 1024 px. The master's
// metallic-roughness and normal maps are dropped: the scenery is matte. The
// node names are the contract with boatSources.js.
const BOAT = {
	path: 'boat-toy/boat.glb',
	levels: [
		{ name: 'boat-lod0', triangles: 16000 },
		{ name: 'boat-lod1', triangles: 3000 },
	],
	error: 0.01,
	color: [...COLOR, '-resample', '1024', '1024'],
}

// One attribute of `primitive` as floats (normalized integers decoded),
// moved into its node's space by `matrix` for `w` 1 (points) or turned by it
// for `w` 0 (directions, renormalized).
function readAttribute(primitive, semantic, matrix = null, w = 1) {
	const accessor = primitive.getAttribute(semantic)
	const size = accessor.getElementSize()
	const array = new Float32Array(accessor.getCount() * size)
	const element = []
	for (let i = 0; i < accessor.getCount(); i++) {
		accessor.getElement(i, element)
		if (matrix) {
			const [x, y, z] = element
			for (let axis = 0; axis < 3; axis++) {
				element[axis] =
					matrix[axis] * x + matrix[4 + axis] * y + matrix[8 + axis] * z + matrix[12 + axis] * w
			}
			if (w === 0) {
				const length = Math.hypot(element[0], element[1], element[2]) || 1
				for (let axis = 0; axis < 3; axis++) element[axis] /= length
			}
		}
		array.set(element.slice(0, size), i * size)
	}
	return array
}

// The boat's levels from the master `source`, with `image` (KTX2 bytes) as the
// base color they share.
function createBoatLevels(source, image) {
	const node = source
		.getRoot()
		.listNodes()
		.find((candidate) => candidate.getMesh())
	const primitive = node.getMesh().listPrimitives()[0]
	const matrix = node.getWorldMatrix()
	const positions = readAttribute(primitive, 'POSITION', matrix, 1)
	const normals = readAttribute(primitive, 'NORMAL', matrix, 0)
	const uvs = readAttribute(primitive, 'TEXCOORD_0')
	const indices = Uint32Array.from(primitive.getIndices().getArray())

	const boat = new Document()
	const buffer = boat.createBuffer()
	const texture = boat.createTexture('boat-color').setImage(image).setMimeType('image/ktx2')
	const material = boat
		.createMaterial('boat')
		.setBaseColorTexture(texture)
		.setMetallicFactor(0)
		.setRoughnessFactor(1)
	const scene = boat.createScene()
	const stats = []
	for (const { name, triangles } of BOAT.levels) {
		const [simplified, error] = MeshoptSimplifier.simplify(
			indices,
			positions,
			3,
			triangles * 3,
			BOAT.error,
		)
		const [vertexRemap, vertexCount] = MeshoptSimplifier.compactMesh(simplified)
		const compact = (values, size) => {
			const array = new Float32Array(vertexCount * size)
			vertexRemap.forEach((target, index) => {
				if (target < vertexCount) {
					array.set(values.subarray(index * size, index * size + size), target * size)
				}
			})
			return boat.createAccessor().setType(`VEC${size}`).setArray(array).setBuffer(buffer)
		}
		const levelPrimitive = boat
			.createPrimitive()
			.setAttribute('POSITION', compact(positions, 3))
			.setAttribute('NORMAL', compact(normals, 3))
			.setAttribute('TEXCOORD_0', compact(uvs, 2))
			.setIndices(
				boat
					.createAccessor()
					.setType('SCALAR')
					.setArray(vertexCount > 65535 ? simplified : Uint16Array.from(simplified))
					.setBuffer(buffer),
			)
			.setMaterial(material)
		const mesh = boat.createMesh(name).addPrimitive(levelPrimitive)
		scene.addChild(boat.createNode(name).setMesh(mesh))
		stats.push({ name, triangles: simplified.length / 3, vertices: vertexCount, error })
	}
	boat.createExtension(KHRTextureBasisu).setRequired(true)
	boat.createExtension(EXTMeshoptCompression).setRequired(true)
	return { boat, stats }
}

function encode(source, target, args) {
	mkdirSync(dirname(target), { recursive: true })
	execFileSync('basisu', [...args, '-mipmap', '-ktx2', '-output_file', target, source], {
		stdio: 'ignore',
	})
}

for (const [path, args] of TEXTURES) {
	const target = join(root, 'src', path.replace(/\.\w+$/, '.ktx2'))
	encode(join(root, 'assets-src', path), target, args)
	console.log(`${path} -> ${target.slice(root.length)}`)
}

await MeshoptDecoder.ready
await MeshoptEncoder.ready
await MeshoptSimplifier.ready
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

		const shadowPath = path.replace(/\.glb$/, '-shadow.glb')
		const { caster, triangles, vertices, error } = createShadowCaster(await io.read(source))
		await io.write(join(root, 'public', shadowPath), caster)
		console.log(
			`${path} -> public/${shadowPath} (${triangles} triangles, ${vertices} vertices, error ${error.toFixed(4)})`,
		)
	}

	const boatSource = await io.read(join(root, 'assets-src', BOAT.path))
	const boatColor = boatSource.getRoot().listMaterials()[0].getBaseColorTexture()
	const boatImage = join(
		work,
		`boat-color.${boatColor.getMimeType() === 'image/png' ? 'png' : 'jpg'}`,
	)
	const boatEncoded = join(work, 'boat-color.ktx2')
	writeFileSync(boatImage, boatColor.getImage())
	encode(boatImage, boatEncoded, BOAT.color)
	const { boat, stats } = createBoatLevels(boatSource, readFileSync(boatEncoded))
	await io.write(join(root, 'public', BOAT.path), boat)
	for (const { name, triangles, vertices, error } of stats) {
		console.log(
			`${BOAT.path} -> public/${BOAT.path} ${name} (${triangles} triangles, ${vertices} vertices, error ${error.toFixed(4)})`,
		)
	}
} finally {
	rmSync(work, { recursive: true, force: true })
}
