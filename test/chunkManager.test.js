// The reconcile state machine end to end: real chunk jobs (runChunkJob) in
// fake workers that answer asynchronously, like module workers.
import assert from 'node:assert/strict'
import test from 'node:test'
import { Object3D, Scene, Vector2 } from 'three'
import ChunkManager from '../src/chunkManager.js'
import { CURVATURE } from '../src/worldConstants.js'
import { createTerrainSettings } from '../src/chunkGeometry.js'
import { getChunkKey, getCurvatureDrop } from '../src/chunkPolicy.js'
import { runChunkJob } from '../src/chunkWorkerJob.js'
import { createScenerySettings } from '../src/sceneryPlacement.js'
import { createSceneryShadowSettings } from '../src/shadowPolicy.js'

const CHUNK_SIZE = 256

// `failures` holds chunk keys whose first job fails.
function createJobWorker(failures) {
	const cache = {}
	const worker = new EventTarget()
	worker.postMessage = (request) => {
		setTimeout(() => {
			let { response } = runChunkJob(request, cache)
			if (failures?.delete(request.key)) response = { id: request.id, error: 'test failure' }
			worker.dispatchEvent(Object.assign(new Event('message'), { data: response }))
		}, 0)
	}
	worker.terminate = () => {}
	return worker
}

function createManager({ failures } = {}) {
	const scene = new Scene()
	// The tracked airplane; its local +Z is the flight direction.
	const plane = new Object3D()
	plane.position.set(CHUNK_SIZE / 2, 0, CHUNK_SIZE / 2)
	const params = {
		...createTerrainSettings(),
		scenery: createScenerySettings({ isMobile: true }),
		shadows: createSceneryShadowSettings({ isMobile: true }),
	}
	const manager = new ChunkManager(
		CHUNK_SIZE,
		plane,
		params,
		scene,
		{ uBiomeOffset: { value: new Vector2() }, uCurvature: { value: CURVATURE } },
		{},
		{ scenery: false },
		'reconcile-test',
		{ isMobile: true, createWorker: () => createJobWorker(failures) },
	)
	return { manager, scene, plane }
}

// Runs frames until every desired chunk is live and no work is left.
async function settle(manager, maxFrames = 5000) {
	for (let frame = 0; frame < maxFrames; frame++) {
		manager.updateChunks()
		const stats = manager.getStats()
		if (stats.live === stats.desired && stats.pending === 0 && stats.ready === 0) return stats
		await new Promise((done) => setTimeout(done, 0))
	}
	throw new Error('chunk streaming did not settle')
}

function assertConsistent(manager, scene) {
	const stats = manager.getStats()
	assert.equal(stats.created - stats.disposed, stats.live)
	assert.equal(scene.children.length, stats.live)
	for (const [key, target] of manager.desired) {
		const chunk = manager.chunks.get(key)
		assert.ok(chunk, `missing ${key}`)
		assert.equal(chunk.LOD, target.LOD, `${key} LOD`)
		const [i, j] = target.coords
		assert.equal(chunk.position.x, (i + 0.5) * CHUNK_SIZE)
		assert.equal(chunk.position.z, (j + 0.5) * CHUNK_SIZE)
	}
	for (const key of manager.chunks.keys()) assert.ok(manager.desired.has(key), `leftover ${key}`)
}

test('streams every desired chunk around the airplane', async () => {
	const { manager, scene } = createManager()
	const stats = await settle(manager)
	assert.ok(stats.live > 10)
	assert.equal(stats.disposed, 0)
	assert.equal(stats.failed, 0)
	assert.equal(stats.failedWorkers, 0)
	assert.ok(stats.generated >= stats.created)
	assertConsistent(manager, scene)
})

test('crossing chunk borders disposes what left and streams what entered', async () => {
	const { manager, scene, plane } = createManager()
	await settle(manager)
	plane.position.z += CHUNK_SIZE * 3
	const stats = await settle(manager)
	assert.ok(stats.disposed > 0)
	assertConsistent(manager, scene)
	// Turning around changes the heading sector and the desired set again.
	plane.rotation.y = Math.PI
	plane.updateMatrixWorld()
	await settle(manager)
	assertConsistent(manager, scene)
})

test('results of an older revision are dropped and regenerated', async () => {
	const { manager, scene } = createManager()
	manager.updateChunks()
	// Jobs are in flight; a parameter change makes them stale.
	manager.params.amplitude = 20
	manager.onParamsChange()
	const stats = await settle(manager)
	assert.ok(stats.stale > 0)
	assertConsistent(manager, scene)
})

test('a failed job is retried once', async (t) => {
	t.mock.method(console, 'error', () => {})
	const failures = new Set([getChunkKey(0, 0)])
	const { manager, scene } = createManager({ failures })
	const stats = await settle(manager)
	assert.equal(stats.failed, 1)
	assertConsistent(manager, scene)
})

test('culling spheres follow the curvature drop; geometry spheres stay flat', async () => {
	const { manager, plane } = createManager()
	await settle(manager)
	for (const chunk of manager.chunks.values()) {
		// The flat sphere, read by the flat-world shadow casters.
		const flat = chunk.geometry.boundingSphere
		const curved = chunk.boundingSphere
		assert.notEqual(curved, flat)
		const distance = chunk.position.clone().add(flat.center).distanceTo(plane.position)
		// Lowered by about the drop at its center, never raised.
		assert.ok(curved.center.y <= flat.center.y)
		const centerDrop = getCurvatureDrop(distance, CURVATURE)
		assert.ok(Math.abs(flat.center.y - curved.center.y - centerDrop) < flat.radius)
	}
})
