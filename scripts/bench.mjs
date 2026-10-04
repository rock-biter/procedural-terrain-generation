// Deterministic GPU benchmark (docs/QUALITY.md#comparing-builds). Builds the
// working tree, and with --compare a git ref in a temporary worktree, serves
// each build, and drives headless Chrome through the same flight: the page's
// requestAnimationFrame timestamps and Date.now (gsap) advance exactly 1/60 s
// per frame, so every build renders the same frames, and the real time per
// frame is measured. Needs Node 22+ (global WebSocket) and Chrome.
//
// Usage: pnpm bench [--compare HEAD] [--rounds 2] [--shots <dir>] ...
// Run `pnpm bench --help` for every option.
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { inflateSync } from 'node:zlib'

const root = fileURLToPath(new URL('..', import.meta.url))
const HELP = `Usage: pnpm bench [options]

  --compare <ref>   also measure a git ref (built in a temporary worktree)
  --rounds <n>      alternated runs per build (default 2; 0 with --shots only captures)
  --width <px>      viewport width in CSS pixels (default 1920)
  --height <px>     viewport height in CSS pixels (default 1080)
  --dpr <ratio>     device pixel ratio, pinned in the app with ?dpr= (default 2)
  --warm <frames>   frames after Play before measuring (default 300)
  --frames <n>      measured frames (default 600)
  --query <query>   app URL query (default seed=s762&time=0.35)
  --shots <dir>     save a held capture per build and print the PSNR between builds
  --chrome <path>   Chrome executable (default: CHROME_PATH or the usual install path)
  --verbose         print getRenderStats() and console warnings`

// pnpm forwards a leading `--` to the script.
const args = process.argv.slice(2)
if (args[0] === '--') args.shift()
const { values: options } = parseArgs({
	args,
	options: {
		compare: { type: 'string' },
		rounds: { type: 'string', default: '2' },
		width: { type: 'string', default: '1920' },
		height: { type: 'string', default: '1080' },
		dpr: { type: 'string', default: '2' },
		warm: { type: 'string', default: '300' },
		frames: { type: 'string', default: '600' },
		query: { type: 'string', default: 'seed=s762&time=0.35' },
		shots: { type: 'string' },
		chrome: { type: 'string' },
		verbose: { type: 'boolean', default: false },
		help: { type: 'boolean', default: false },
	},
})
if (options.help) {
	console.log(HELP)
	process.exit(0)
}
if (typeof WebSocket !== 'function') {
	console.error('pnpm bench needs Node 22 or later (global WebSocket).')
	process.exit(1)
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const viewport = { width: Number(options.width), height: Number(options.height), dpr: Number(options.dpr) }
const warm = Number(options.warm)
const frames = Number(options.frames)
// Held captures wait this many frames after Play before stopping time.
const HOLD_FRAMES = 400

function findChrome() {
	const candidates = [
		options.chrome,
		process.env.CHROME_PATH,
		'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
		'/usr/bin/google-chrome',
		'/usr/bin/chromium',
		'/usr/bin/chromium-browser',
		'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
	]
	const found = candidates.find((path) => path && existsSync(path))
	if (!found) throw new Error('Chrome not found: pass --chrome <path> or set CHROME_PATH.')
	return found
}

function getFreePort() {
	return new Promise((done, fail) => {
		const server = createServer()
		server.on('error', fail)
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address()
			server.close(() => done(port))
		})
	})
}

async function waitFor(check, what, timeoutMs = 60000) {
	const start = Date.now()
	while (Date.now() - start < timeoutMs) {
		try {
			if (await check()) return
		} catch {
			// Not up yet.
		}
		await sleep(100)
	}
	throw new Error(`Timed out waiting for ${what}`)
}

const vite = join(root, 'node_modules/vite/bin/vite.js')

function build(sourceDir, outDir) {
	execFileSync(process.execPath, [vite, 'build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'error'], {
		cwd: sourceDir,
		stdio: 'inherit',
	})
}

async function serve(outDir, children) {
	const port = await getFreePort()
	const child = spawn(
		process.execPath,
		[vite, 'preview', '--outDir', outDir, '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
		{ cwd: root, stdio: 'ignore' },
	)
	children.push(child)
	const url = `http://127.0.0.1:${port}/`
	await waitFor(async () => (await fetch(url)).ok, `vite preview on port ${port}`)
	return url
}

// One CDP session on the browser's first page.
async function connect(port) {
	const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
	const socket = new WebSocket(targets.find((target) => target.type === 'page').webSocketDebuggerUrl)
	await new Promise((done) => socket.addEventListener('open', done, { once: true }))
	let nextId = 0
	const pending = new Map()
	const session = { errors: [], warnings: [] }
	socket.addEventListener('message', ({ data }) => {
		const message = JSON.parse(data)
		if (message.id && pending.has(message.id)) {
			pending.get(message.id)(message)
			pending.delete(message.id)
		} else if (message.method === 'Runtime.consoleAPICalled') {
			const text = message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' ')
			if (message.params.type === 'error') session.errors.push(text.slice(0, 300))
			if (message.params.type === 'warning') session.warnings.push(text.slice(0, 300))
		} else if (message.method === 'Runtime.exceptionThrown') {
			const details = message.params.exceptionDetails
			session.errors.push(details.exception?.description ?? details.text)
		}
	})
	session.send = (method, params = {}) => {
		const id = ++nextId
		socket.send(JSON.stringify({ id, method, params }))
		return new Promise((done) => pending.set(id, done))
	}
	session.evaluate = async (expression) =>
		(await session.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value
	session.close = () => socket.close()
	await session.send('Runtime.enable')
	await session.send('Page.enable')
	await session.send('Emulation.setDeviceMetricsOverride', {
		width: viewport.width,
		height: viewport.height,
		deviceScaleFactor: viewport.dpr,
		mobile: false,
	})
	return session
}

// Injected before any page script. `config.mode` is 'measure' (click Play,
// start GPU timing after `warm` frames, freeze after `warm + frames`) or
// 'shot' (stop time `holdAt` frames after Play; Node then waits for the
// streaming to settle and asks for an in-frame canvas capture).
function createShim(config) {
	return `(() => {
	const config = ${JSON.stringify(config)}
	const realNow = performance.now.bind(performance)
	const realRAF = window.requestAnimationFrame.bind(window)
	const step = 1000 / 60
	let lastReal = -1
	let virtual = realNow()
	const virtualStart = virtual
	const dateBase = Date.now()
	const bench = (window.__bench = { frame: 0, marks: [], waiters: [] })
	window.requestAnimationFrame = (callback) => realRAF((time) => {
		const newFrame = time !== lastReal
		// Frozen: callbacks are held, so the canvas keeps the last frame.
		if (bench.frozen || (newFrame && bench.freezeAt !== undefined && bench.frame >= bench.freezeAt)) {
			bench.frozen = true
			return
		}
		if (newFrame) {
			lastReal = time
			if (!bench.hold) virtual += step
			bench.frame++
			bench.marks.push(realNow())
			for (const waiter of bench.waiters.splice(0)) waiter()
		}
		callback(virtual)
		// After the last callback of the final frame the canvas holds that frame;
		// read it before it is presented and cleared.
		if (bench.capture && bench.frame === bench.freezeAt) {
			bench.shot = document.querySelector('canvas').toDataURL('image/png')
		}
	})
	// Exact frame steps from a fixed base, fractions included, so gsap tweens
	// reach the same progress on the same frame in every run.
	Date.now = () => dateBase + (virtual - virtualStart)
	const keepAlive = () => window.requestAnimationFrame(keepAlive)
	keepAlive()
	const poll = () => {
		const play = document.getElementById('play')
		const ready = window.__INFINITE_WORLD__?.getFlightStats() != null
		if (bench.clickFrame === undefined && ready && play && getComputedStyle(play).opacity === '1') {
			play.click()
			bench.clickFrame = bench.frame
			bench.clickMark = bench.marks.length
			if (config.mode === 'measure') bench.freezeAt = bench.frame + config.warm + config.frames + 1
		}
		if (bench.clickFrame !== undefined) {
			if (config.mode === 'measure' && !bench.statsStarted && bench.frame >= bench.clickFrame + config.warm) {
				bench.statsStarted = true
				window.__INFINITE_WORLD__.getRenderStats?.()
			}
			if (config.mode === 'shot' && !bench.hold && bench.frame >= bench.clickFrame + config.holdAt) {
				bench.hold = true
			}
		}
		bench.waiters.push(poll)
	}
	bench.waiters.push(poll)
})()`
}

async function load(session, url, config) {
	const { identifier } = (await session.send('Page.addScriptToEvaluateOnNewDocument', { source: createShim(config) })).result
	// Leave the previous, possibly frozen, page before loading the next one.
	await session.send('Page.navigate', { url: 'about:blank' })
	await waitFor(async () => (await session.evaluate('location.href')) === 'about:blank', 'about:blank')
	session.errors.length = 0
	session.warnings.length = 0
	await session.send('Page.navigate', { url })
	await waitFor(
		async () => await session.evaluate(`location.href === ${JSON.stringify(url)} && !!window.__bench`),
		'the app page',
	)
	await session.send('Page.removeScriptToEvaluateOnNewDocument', { identifier })
}

async function measure(session, url) {
	await load(session, url, { mode: 'measure', warm, frames })
	await waitFor(async () => await session.evaluate('window.__bench.frozen === true'), 'the measured frames', 300000)
	return JSON.parse(
		await session.evaluate(`(() => {
			const start = window.__bench.clickMark + ${warm}
			const marks = window.__bench.marks.slice(start, start + ${frames} + 1)
			const intervals = marks.slice(1).map((mark, index) => mark - marks[index])
			const sorted = intervals.slice().sort((a, b) => a - b)
			const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
			return JSON.stringify({
				mean: intervals.reduce((sum, value) => sum + value, 0) / intervals.length,
				p50: at(0.5),
				p95: at(0.95),
				render: window.__INFINITE_WORLD__.getRenderStats?.() ?? null,
			})
		})()`),
	)
}

async function capture(session, url, path) {
	await load(session, url, { mode: 'shot', holdAt: HOLD_FRAMES })
	await waitFor(async () => await session.evaluate('window.__bench.hold === true'), 'the held frame', 300000)
	// Streaming converged twice in a row, half a second apart.
	let stable = 0
	while (stable < 2) {
		await sleep(500)
		const chunks = JSON.parse(await session.evaluate('JSON.stringify(window.__INFINITE_WORLD__.getChunkStats())'))
		const settled =
			chunks.live === chunks.desired &&
			chunks.pending === 0 &&
			chunks.queued === 0 &&
			chunks.inFlight === 0 &&
			chunks.ready === 0
		stable = settled ? stable + 1 : 0
	}
	await session.evaluate('void (window.__bench.capture = true, window.__bench.freezeAt = window.__bench.frame + 10)')
	await waitFor(async () => await session.evaluate('!!window.__bench.shot'), 'the capture')
	const dataUrl = await session.evaluate('window.__bench.shot')
	writeFileSync(path, Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'))
	return JSON.parse(await session.evaluate('JSON.stringify(window.__INFINITE_WORLD__.getFlightStats().position)'))
}

// 8-bit RGB or RGBA PNG to { width, height, channels, pixels }.
function decodePng(path) {
	const file = readFileSync(path)
	let offset = 8
	let width = 0
	let height = 0
	let colorType = 0
	const data = []
	while (offset < file.length) {
		const length = file.readUInt32BE(offset)
		const type = file.toString('ascii', offset + 4, offset + 8)
		const chunk = file.subarray(offset + 8, offset + 8 + length)
		if (type === 'IHDR') {
			width = chunk.readUInt32BE(0)
			height = chunk.readUInt32BE(4)
			colorType = chunk[9]
		} else if (type === 'IDAT') data.push(chunk)
		offset += 12 + length
	}
	const channels = colorType === 6 ? 4 : 3
	const raw = inflateSync(Buffer.concat(data))
	const stride = width * channels
	const pixels = Buffer.alloc(height * stride)
	for (let y = 0; y < height; y++) {
		const filter = raw[y * (stride + 1)]
		const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
		for (let x = 0; x < stride; x++) {
			const left = x >= channels ? pixels[y * stride + x - channels] : 0
			const up = y > 0 ? pixels[(y - 1) * stride + x] : 0
			const upLeft = x >= channels && y > 0 ? pixels[(y - 1) * stride + x - channels] : 0
			let value = line[x]
			if (filter === 1) value += left
			else if (filter === 2) value += up
			else if (filter === 3) value += (left + up) >> 1
			else if (filter === 4) {
				const estimate = left + up - upLeft
				const dLeft = Math.abs(estimate - left)
				const dUp = Math.abs(estimate - up)
				const dUpLeft = Math.abs(estimate - upLeft)
				value += dLeft <= dUp && dLeft <= dUpLeft ? left : dUp <= dUpLeft ? up : upLeft
			}
			pixels[y * stride + x] = value & 255
		}
	}
	return { width, height, channels, pixels }
}

// PSNR over RGB and the share of pixels whose largest channel differs by more than 16.
function compareImages(pathA, pathB) {
	const a = decodePng(pathA)
	const b = decodePng(pathB)
	if (a.width !== b.width || a.height !== b.height) return null
	let squared = 0
	let changed = 0
	for (let i = 0; i < a.width * a.height; i++) {
		let largest = 0
		for (let c = 0; c < 3; c++) {
			const d = a.pixels[i * a.channels + c] - b.pixels[i * b.channels + c]
			squared += d * d
			largest = Math.max(largest, Math.abs(d))
		}
		if (largest > 16) changed++
	}
	const mse = squared / (a.width * a.height * 3)
	return { psnr: 10 * Math.log10((255 * 255) / mse), changed: changed / (a.width * a.height) }
}

const children = []
const work = mkdtempSync(join(tmpdir(), 'bench-'))
let worktree = null
try {
	const builds = [{ name: 'working tree', source: root }]
	if (options.compare) {
		worktree = join(work, 'ref-source')
		execFileSync('git', ['worktree', 'add', '--detach', '--quiet', worktree, options.compare], { cwd: root })
		symlinkSync(join(root, 'node_modules'), join(worktree, 'node_modules'))
		builds.push({ name: options.compare, source: worktree })
	}
	for (const [index, entry] of builds.entries()) {
		console.log(`Building ${entry.name}...`)
		entry.outDir = join(work, `dist-${index}`)
		build(entry.source, entry.outDir)
		entry.url = `${await serve(entry.outDir, children)}?${options.query}&dpr=${viewport.dpr}`
		entry.runs = []
	}

	const chromePort = await getFreePort()
	const chrome = spawn(
		findChrome(),
		[
			'--headless=new',
			`--remote-debugging-port=${chromePort}`,
			`--user-data-dir=${join(work, 'chrome')}`,
			'--ignore-gpu-blocklist',
			'--disable-gpu-vsync',
			'--disable-frame-rate-limit',
			'--autoplay-policy=no-user-gesture-required',
			`--window-size=${viewport.width},${viewport.height}`,
			'--no-first-run',
			'--no-default-browser-check',
			'about:blank',
		],
		{ stdio: 'ignore' },
	)
	children.push(chrome)
	await waitFor(async () => (await fetch(`http://127.0.0.1:${chromePort}/json/version`)).ok, 'Chrome')
	const session = await connect(chromePort)

	const canvas = `${viewport.width * viewport.dpr} × ${viewport.height * viewport.dpr}`
	if (Number(options.rounds) > 0) {
		console.log(`Measuring frames ${warm}–${warm + frames} after Play, ${canvas} canvas, ${options.rounds} round(s)...`)
	}
	for (let round = 0; round < Number(options.rounds); round++) {
		for (const entry of builds) {
			const run = await measure(session, entry.url)
			entry.runs.push(run)
			const errors = session.errors.length ? `, ${session.errors.length} console error(s)` : ''
			console.log(`  ${entry.name}: ${run.mean.toFixed(2)} ms mean, p50 ${run.p50.toFixed(2)}, p95 ${run.p95.toFixed(2)}${errors}`)
			for (const error of session.errors) console.log(`    error: ${error}`)
			if (options.verbose) {
				for (const warning of session.warnings) console.log(`    warning: ${warning}`)
				console.log(JSON.stringify(run.render, null, 1))
			}
		}
	}

	if (Number(options.rounds) > 0) {
		console.log('\nBuild                 Mean ms   p50 ms   p95 ms   Draw calls   Triangles   Change')
		const baseline = builds.at(-1)
		const average = (entry, key) => entry.runs.reduce((sum, run) => sum + run[key], 0) / entry.runs.length
		for (const entry of builds) {
			const mean = average(entry, 'mean')
			const last = entry.runs.at(-1).render
			const change = entry === baseline || builds.length === 1
				? ''
				: `${(((mean - average(baseline, 'mean')) / average(baseline, 'mean')) * 100).toFixed(1)}%`
			console.log(
				`${entry.name.padEnd(20)} ${mean.toFixed(2).padStart(8)} ${average(entry, 'p50').toFixed(2).padStart(8)} ${average(entry, 'p95').toFixed(2).padStart(8)} ${String(last?.drawCalls ?? '-').padStart(12)} ${last ? `${(last.triangles / 1e6).toFixed(2)}M`.padStart(11) : '-'.padStart(11)}   ${change}`,
			)
		}
	}

	if (options.shots) {
		const shots = resolve(options.shots)
		mkdirSync(shots, { recursive: true })
		console.log(`\nHeld captures in ${shots}:`)
		for (const [index, entry] of builds.entries()) {
			entry.shot = join(shots, `build-${index}.png`)
			const position = await capture(session, entry.url, entry.shot)
			console.log(`  ${entry.name}: build-${index}.png at z ${position.z.toFixed(3)}`)
		}
		if (builds.length > 1) {
			const result = compareImages(builds[0].shot, builds[1].shot)
			if (result) {
				console.log(`  PSNR ${result.psnr.toFixed(1)} dB, ${(result.changed * 100).toFixed(3)}% of pixels off by more than 16`)
			}
		}
	}
	session.close()
} finally {
	for (const child of children) child.kill()
	if (worktree) {
		try {
			execFileSync('git', ['worktree', 'remove', '--force', worktree], { cwd: root, stdio: 'ignore' })
		} catch {
			execFileSync('git', ['worktree', 'prune'], { cwd: root, stdio: 'ignore' })
		}
	}
	// Chrome may still be writing its profile while it exits.
	rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}
