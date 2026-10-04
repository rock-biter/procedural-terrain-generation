import assert from 'node:assert/strict'
import test from 'node:test'
import FrameStats, { GpuTimer, MAX_FRAME_INTERVAL, SampleWindow } from '../src/frameStats.js'

// Stand-in for EXT_disjoint_timer_query_webgl2: each query reads `elapsed` ns
// once the test marks it finished.
function createGl({ timer = true } = {}) {
	const ext = { TIME_ELAPSED_EXT: 1, GPU_DISJOINT_EXT: 2 }
	const gl = {
		QUERY_RESULT_AVAILABLE: 3,
		QUERY_RESULT: 4,
		disjoint: false,
		created: 0,
		active: null,
		getExtension: (name) => (timer && name === 'EXT_disjoint_timer_query_webgl2' ? ext : null),
		createQuery: () => ({ id: gl.created++, done: false, elapsed: 0 }),
		beginQuery: (target, query) => {
			gl.active = query
		},
		endQuery: () => {
			gl.active = null
		},
		getParameter: (name) => (name === ext.GPU_DISJOINT_EXT ? gl.disjoint : null),
		getQueryParameter: (query, name) =>
			name === gl.QUERY_RESULT_AVAILABLE ? query.done : query.elapsed,
		drawingBufferWidth: 800,
		drawingBufferHeight: 600,
	}
	return gl
}

function createRenderer(gl = createGl()) {
	const info = {
		autoReset: true,
		resets: 0,
		render: { calls: 0, triangles: 0 },
		memory: { geometries: 3, textures: 2 },
		programs: [{}, {}],
		reset() {
			this.resets++
			this.render.calls = 0
			this.render.triangles = 0
		},
	}
	return { info, getContext: () => gl, getPixelRatio: () => 2 }
}

test('a sample window summarizes the kept samples with nearest-rank percentiles', () => {
	const samples = new SampleWindow(100)
	assert.equal(samples.summarize(), null)
	for (let i = 1; i <= 100; i++) samples.push(i)
	assert.deepEqual(samples.summarize(), {
		samples: 100,
		mean: 50.5,
		p50: 51,
		p95: 96,
		p99: 100,
		max: 100,
	})
})

test('a full sample window keeps only the newest samples', () => {
	const samples = new SampleWindow(3)
	for (const value of [100, 1, 2, 3]) samples.push(value)
	const summary = samples.summarize()
	assert.equal(summary.samples, 3)
	assert.equal(summary.max, 3)
	assert.equal(summary.mean, 2)
})

test('frame stats count every render of a frame and time each stage', () => {
	const renderer = createRenderer()
	const stats = new FrameStats(renderer)
	assert.equal(renderer.info.autoReset, false)

	stats.beginFrame(1000)
	renderer.info.render.calls = 5
	stats.mark('chunks')
	renderer.info.render.calls += 7
	renderer.info.render.triangles = 900
	stats.mark('render')
	stats.endFrame()
	stats.beginFrame(1016)
	assert.equal(renderer.info.resets, 2)

	const result = stats.getStats()
	assert.equal(result.drawCalls, 12)
	assert.equal(result.triangles, 900)
	assert.equal(result.frame.samples, 1)
	assert.equal(result.frame.p50, 16)
	assert.deepEqual(Object.keys(result.stages), ['chunks', 'render'])
	assert.equal(result.stages.chunks.samples, 1)
	assert.equal(result.cpu.samples, 1)
	assert.equal(result.programs, 2)
	assert.deepEqual(result.drawingBuffer, [800, 600])
})

test('intervals of a hidden tab are not frame times', () => {
	const stats = new FrameStats(createRenderer())
	stats.beginFrame(0)
	stats.endFrame()
	stats.beginFrame(MAX_FRAME_INTERVAL + 1)
	stats.endFrame()
	assert.equal(stats.getStats().frame, null)
})

test('GPU timing starts on the first read and drops disjoint results', () => {
	const gl = createGl()
	const stats = new FrameStats(createRenderer(gl))
	stats.beginFrame(0)
	stats.endFrame()
	assert.equal(gl.created, 0)

	const first = stats.getStats()
	assert.equal(first.gpuSupported, true)
	assert.equal(first.gpu, null)

	const queries = []
	for (let frame = 1; frame <= 3; frame++) {
		stats.beginFrame(frame * 16)
		queries.push(gl.active)
		stats.endFrame()
	}
	queries[0].done = true
	queries[0].elapsed = 4e6
	queries[2].done = true
	queries[2].elapsed = 9e6
	stats.beginFrame(64)
	stats.endFrame()
	// The second query is unfinished, so the third waits behind it.
	assert.equal(stats.getStats().gpu.samples, 1)
	assert.equal(stats.getStats().gpu.max, 4)

	queries[1].done = true
	queries[1].elapsed = 6e6
	gl.disjoint = true
	stats.beginFrame(80)
	stats.endFrame()
	assert.equal(stats.getStats().gpu.samples, 1)
})

test('without the timer extension GPU time stays null', () => {
	const timer = new GpuTimer(createGl({ timer: false }))
	assert.equal(timer.supported, false)
	timer.begin()
	timer.end()
	timer.collect(() => assert.fail('no results without the extension'))
	const stats = new FrameStats(createRenderer(createGl({ timer: false })))
	assert.equal(stats.getStats().gpuSupported, false)
	stats.beginFrame(0)
	stats.endFrame()
	assert.equal(stats.getStats().gpu, null)
})
