import assert from 'node:assert/strict'
import test from 'node:test'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AIRPLANE_MODELS } from '../src/airplaneModels.js'

const root = fileURLToPath(new URL('..', import.meta.url))
// «KTX 20»\r\n\x1A\n
const KTX2_IDENTIFIER_FULL = Buffer.from([
	0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a,
])

function listFiles(directory) {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
		entry.isDirectory() ? listFiles(join(directory, entry.name)) : [join(directory, entry.name)],
	)
}

test('every texture master has its KTX2 runtime file', () => {
	const masters = listFiles(join(root, 'assets-src/textures'))
	assert.ok(masters.length > 0)
	for (const master of masters) {
		const path = relative(join(root, 'assets-src'), master).replace(/\.\w+$/, '.ktx2')
		const target = join(root, 'src', path)
		assert.ok(existsSync(target), `missing ${path}`)
		assert.ok(readFileSync(target).subarray(0, 12).equals(KTX2_IDENTIFIER_FULL), path)
	}
})

test('every airplane has a small position-only shadow caster', () => {
	for (const model of Object.values(AIRPLANE_MODELS)) {
		const glb = readFileSync(join(root, 'public', model.shadowPath))
		const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString())
		assert.equal(json.meshes.length, 1, model.shadowPath)
		const [primitive] = json.meshes[0].primitives
		assert.deepEqual(Object.keys(primitive.attributes), ['POSITION'], model.shadowPath)
		const triangles = json.accessors[primitive.indices].count / 3
		assert.ok(triangles > 1000 && triangles <= 5000, `${model.shadowPath}: ${triangles} triangles`)
		assert.equal(json.images, undefined, model.shadowPath)
	}
})

test('the airplane models use KTX2 textures', () => {
	for (const file of ['plane-toy.glb', 'plane-toy-2.glb']) {
		const glb = readFileSync(join(root, 'public/plane-toy', file))
		const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString())
		assert.ok(json.extensionsRequired.includes('KHR_texture_basisu'), file)
		assert.ok(
			json.images.every((image) => image.mimeType === 'image/ktx2'),
			file,
		)
	}
})

test('the boat has two simplified levels with only a KTX2 color map', () => {
	const glb = readFileSync(join(root, 'public/boat-toy/boat.glb'))
	const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString())
	assert.deepEqual(
		json.meshes.map((mesh) => mesh.name),
		['boat-lod0', 'boat-lod1'],
	)
	const triangles = json.meshes.map((mesh) => json.accessors[mesh.primitives[0].indices].count / 3)
	assert.ok(triangles[0] > 10000 && triangles[0] <= 17000, `LOD 0: ${triangles[0]} triangles`)
	assert.ok(triangles[1] > 1000 && triangles[1] <= 3500, `LOD 1: ${triangles[1]} triangles`)
	for (const mesh of json.meshes) {
		assert.deepEqual(Object.keys(mesh.primitives[0].attributes).sort(), [
			'NORMAL',
			'POSITION',
			'TEXCOORD_0',
		])
	}
	assert.equal(json.images.length, 1)
	assert.equal(json.images[0].mimeType, 'image/ktx2')
	assert.equal(json.materials.length, 1)
	const [material] = json.materials
	assert.ok(material.pbrMetallicRoughness.baseColorTexture)
	assert.equal(material.pbrMetallicRoughness.metallicRoughnessTexture, undefined)
	assert.equal(material.normalTexture, undefined)
	assert.ok(existsSync(join(root, 'assets-src/boat-toy/boat.glb')), 'the master stays')
})
