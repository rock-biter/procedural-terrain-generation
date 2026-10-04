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
		entry.isDirectory()
			? listFiles(join(directory, entry.name))
			: [join(directory, entry.name)],
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
		assert.ok(json.images.every((image) => image.mimeType === 'image/ktx2'), file)
	}
})
