import assert from 'node:assert/strict'
import test from 'node:test'
import ChunkWorkerPool from '../src/chunkWorkerPool.js'

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

// A controllable stand-in for a module worker.
class FakeWorker extends EventTarget {
	posted = []
	terminated = false

	postMessage(data) {
		this.posted.push(data)
	}

	terminate() {
		this.terminated = true
	}

	reply(data) {
		this.dispatchEvent(Object.assign(new Event('message'), { data }))
	}

	crash(message = 'worker crashed') {
		this.dispatchEvent(Object.assign(new Event('error'), { message, error: new Error(message) }))
	}
}

function createPool(size, restarts = { max: 2, delayMs: 1 }) {
	const created = []
	const pool = new ChunkWorkerPool(size, {
		createWorker: () => {
			const worker = new FakeWorker()
			created.push(worker)
			return worker
		},
		restarts,
	})
	return { pool, created }
}

test('requests go to idle workers and free them on reply', async () => {
	const { pool, created } = createPool(2)
	const first = pool.run({ key: 'a' })
	const second = pool.run({ key: 'b' })
	assert.equal(pool.run({ key: 'c' }), null)
	assert.equal(created[0].posted[0].key, 'a')
	assert.equal(created[1].posted[0].key, 'b')
	created[0].reply({ key: 'a', ok: true })
	assert.deepEqual(await first, { key: 'a', ok: true })
	assert.notEqual(pool.run({ key: 'c' }), null)
	created[1].reply({ key: 'b' })
	await second
})

test('a job error rejects without restarting the worker', async () => {
	const { pool, created } = createPool(1)
	const job = pool.run({ key: 'a' })
	created[0].reply({ error: 'bad request' })
	await assert.rejects(job, /bad request/)
	assert.equal(created.length, 1)
	assert.equal(created[0].terminated, false)
})

test('a crashed worker rejects its job and restarts after a delay', async () => {
	const { pool, created } = createPool(1)
	const job = pool.run({ key: 'a' })
	created[0].crash()
	await assert.rejects(job, /worker crashed/)
	assert.equal(created[0].terminated, true)
	// Restarting: no worker available yet.
	assert.equal(pool.run({ key: 'b' }), null)
	await sleep(5)
	assert.equal(created.length, 2)
	assert.notEqual(pool.run({ key: 'b' }), null)
})

test('repeated crashes stop the restarts; a reply resets the count', async (t) => {
	t.mock.method(console, 'error', () => {})
	const { pool, created } = createPool(1, { max: 2, delayMs: 1 })
	created[0].crash()
	await sleep(5)
	// A healthy reply resets the consecutive-failure count.
	const job = pool.run({ key: 'a' })
	created[1].reply({ key: 'a' })
	await job
	for (let crash = 0; crash < 3; crash++) {
		created.at(-1).crash()
		await sleep(10)
	}
	assert.equal(pool.failedCount, 1)
	assert.equal(created.length, 4)
	assert.equal(pool.run({ key: 'b' }), null)
	await sleep(20)
	assert.equal(created.length, 4)
})

test('dispose rejects pending jobs and stops every worker', async () => {
	const { pool, created } = createPool(1)
	const job = pool.run({ key: 'a' })
	pool.dispose()
	await assert.rejects(job, /disposed/)
	assert.equal(created[0].terminated, true)
	assert.equal(pool.size, 0)
})
