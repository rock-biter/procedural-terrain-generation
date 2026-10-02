// Frame telemetry read by window.__INFINITE_WORLD__.getRenderStats(): the
// interval between frames, the main-thread time of the frame loop and of each
// of its stages, the draw calls and triangles of every render pass of the
// last frame, and the GPU time per frame where the browser exposes
// EXT_disjoint_timer_query_webgl2. Each frame only writes numbers into fixed
// ring buffers; percentiles are computed when the stats are read.

// Samples kept per series: 10 s at 60 fps.
export const FRAME_STATS_CAPACITY = 600
// Longer intervals come from a hidden tab, not from a slow frame.
export const MAX_FRAME_INTERVAL = 1000
// GPU queries in flight at once; a frame is left untimed when all are busy.
const MAX_PENDING_QUERIES = 8

const round = (value) => Math.round(value * 1000) / 1000

// Ring buffer of the last `capacity` samples.
export class SampleWindow {
	constructor(capacity = FRAME_STATS_CAPACITY) {
		this.values = new Float64Array(capacity)
		this.count = 0
		this.next = 0
	}

	push(value) {
		this.values[this.next] = value
		this.next = (this.next + 1) % this.values.length
		this.count = Math.min(this.count + 1, this.values.length)
	}

	// { samples, mean, p50, p95, p99, max } over the kept samples (nearest
	// rank), or null when there are none.
	summarize() {
		if (this.count === 0) return null
		const sorted = this.values.slice(0, this.count).sort()
		const at = (q) => sorted[Math.min(this.count - 1, Math.floor(q * this.count))]
		let sum = 0
		for (const value of sorted) sum += value
		return {
			samples: this.count,
			mean: round(sum / this.count),
			p50: round(at(0.5)),
			p95: round(at(0.95)),
			p99: round(at(0.99)),
			max: round(sorted[this.count - 1]),
		}
	}
}

// GPU time of the commands between begin() and end(), read back a few frames
// later without stalling. Results of disjoint periods (for example a GPU
// frequency change) are dropped.
export class GpuTimer {
	constructor(gl) {
		this.gl = gl
		this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2')
		this.free = []
		this.pending = []
		this.active = null
	}

	get supported() {
		return this.ext !== null
	}

	begin() {
		if (!this.ext || this.active || this.pending.length >= MAX_PENDING_QUERIES) return
		this.active = this.free.pop() ?? this.gl.createQuery()
		this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, this.active)
	}

	end() {
		if (!this.active) return
		this.gl.endQuery(this.ext.TIME_ELAPSED_EXT)
		this.pending.push(this.active)
		this.active = null
	}

	// Calls onResult(ms) for each finished query, oldest first. Queries finish
	// in order, so the first unfinished one ends the scan.
	collect(onResult) {
		if (this.pending.length === 0) return
		const { gl, ext } = this
		const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT)
		while (this.pending.length > 0) {
			const query = this.pending[0]
			if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) break
			this.pending.shift()
			if (!disjoint) onResult(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6)
			this.free.push(query)
		}
	}
}

// Call beginFrame() first in the frame loop, mark(stage) after each stage,
// and endFrame() after the last render. Draw counters cover every render of
// the frame (shadow maps, scene, post-processing), so it turns off the
// renderer's per-render reset. GPU timing starts on the first getStats()
// call, so a page nobody profiles never issues a query.
export default class FrameStats {
	constructor(renderer, { capacity = FRAME_STATS_CAPACITY } = {}) {
		this.renderer = renderer
		this.capacity = capacity
		renderer.info.autoReset = false
		this.interval = new SampleWindow(capacity)
		this.cpu = new SampleWindow(capacity)
		this.gpu = new SampleWindow(capacity)
		this.stages = new Map()
		this.gpuTimer = null
		this.lastTimestamp = null
		this.frameStart = 0
		this.markTime = 0
		this.drawCalls = 0
		this.triangles = 0
	}

	// `timestamp` is the requestAnimationFrame time.
	beginFrame(timestamp) {
		if (this.lastTimestamp !== null) {
			const interval = timestamp - this.lastTimestamp
			if (interval <= MAX_FRAME_INTERVAL) this.interval.push(interval)
		}
		this.lastTimestamp = timestamp
		this.renderer.info.reset()
		this.gpuTimer?.begin()
		this.frameStart = this.markTime = performance.now()
	}

	// Attributes the main-thread time since the previous mark (or beginFrame)
	// to `stage`.
	mark(stage) {
		const now = performance.now()
		let samples = this.stages.get(stage)
		if (!samples) {
			samples = new SampleWindow(this.capacity)
			this.stages.set(stage, samples)
		}
		samples.push(now - this.markTime)
		this.markTime = now
	}

	endFrame() {
		this.cpu.push(performance.now() - this.frameStart)
		if (this.gpuTimer) {
			this.gpuTimer.end()
			this.gpuTimer.collect((ms) => this.gpu.push(ms))
		}
		const { render } = this.renderer.info
		this.drawCalls = render.calls
		this.triangles = render.triangles
	}

	// Times in milliseconds. `gpu` stays null until the first queries finish,
	// and always without EXT_disjoint_timer_query_webgl2 (`gpuSupported`).
	getStats() {
		const gl = this.renderer.getContext()
		this.gpuTimer ??= new GpuTimer(gl)
		const { info } = this.renderer
		return {
			frame: this.interval.summarize(),
			cpu: this.cpu.summarize(),
			gpu: this.gpu.summarize(),
			gpuSupported: this.gpuTimer.supported,
			stages: Object.fromEntries(
				[...this.stages].map(([stage, samples]) => [stage, samples.summarize()]),
			),
			drawCalls: this.drawCalls,
			triangles: this.triangles,
			programs: info.programs?.length ?? 0,
			geometries: info.memory.geometries,
			textures: info.memory.textures,
			pixelRatio: this.renderer.getPixelRatio(),
			drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
		}
	}
}
