// Generates src/textures/wood-grain.png: a tileable grayscale wood grain used
// as detail (brightness and bump) when baking impostors. Run with
// `pnpm texture:wood`. Every noise term is periodic over the image, so the
// texture repeats without seams. No dependencies: PNG encoding uses node:zlib.
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const SIZE = 512
// Growth rings across the image width; grain runs along the height.
const RINGS = 7
const OUTPUT = new URL('../src/textures/wood.jpg', import.meta.url)

function hash(x, y, seed) {
	let h =
		Math.imul(x, 374761393) ^
		Math.imul(y, 668265263) ^
		Math.imul(seed, 2147483647)
	h = Math.imul(h ^ (h >>> 13), 1274126177)
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

// Value noise that repeats every `periodX` by `periodY` lattice cells over
// the unit square.
function periodicNoise(u, v, periodX, periodY, seed) {
	const x = u * periodX
	const y = v * periodY
	const x0 = Math.floor(x)
	const y0 = Math.floor(y)
	const fx = x - x0
	const fy = y - y0
	const sx = fx * fx * (3 - 2 * fx)
	const sy = fy * fy * (3 - 2 * fy)
	const wrap = (value, period) => ((value % period) + period) % period
	const corner = (dx, dy) =>
		hash(wrap(x0 + dx, periodX), wrap(y0 + dy, periodY), seed)
	const top = corner(0, 0) + (corner(1, 0) - corner(0, 0)) * sx
	const bottom = corner(0, 1) + (corner(1, 1) - corner(0, 1)) * sx
	return top + (bottom - top) * sy
}

function fbm(u, v, periodX, periodY, octaves, seed) {
	let sum = 0
	let amplitude = 0.5
	let total = 0
	for (let octave = 0; octave < octaves; octave++) {
		const scale = 2 ** octave
		sum +=
			periodicNoise(u, v, periodX * scale, periodY * scale, seed + octave) *
			amplitude
		total += amplitude
		amplitude *= 0.5
	}
	return sum / total
}

const pixels = new Uint8Array(SIZE * SIZE)
for (let y = 0; y < SIZE; y++) {
	for (let x = 0; x < SIZE; x++) {
		const u = x / SIZE
		const v = y / SIZE

		// Slow warp bends the rings; it stays periodic because it is noise.
		const warp = (fbm(u, v, 3, 2, 4, 11) - 0.5) * 1.6
		const ring = u * RINGS + warp
		// Sawtooth rings eased into soft bands: early wood light, late wood dark.
		const phase = ring - Math.floor(ring)
		const band = Math.pow(Math.sin(phase * Math.PI), 0.6)

		// Long fibres stretched along the grain.
		const fibres = fbm(u, v, 96, 6, 3, 23)
		// Broad patches of lighter and darker wood.
		const patches = fbm(u, v, 4, 4, 3, 37)

		let value =
			0.42 + band * 0.32 + (fibres - 0.5) * 0.28 + (patches - 0.5) * 0.18
		value = Math.min(Math.max(value, 0), 1)
		pixels[y * SIZE + x] = Math.round(value * 255)
	}
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
	let c = n
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
	return c >>> 0
})

function crc32(buffer) {
	let crc = 0xffffffff
	for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
	return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
	const length = Buffer.alloc(4)
	length.writeUInt32BE(data.length)
	const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
	const crc = Buffer.alloc(4)
	crc.writeUInt32BE(crc32(body))
	return Buffer.concat([length, body, crc])
}

// 8-bit grayscale, filter type 0 on every row.
const header = Buffer.alloc(13)
header.writeUInt32BE(SIZE, 0)
header.writeUInt32BE(SIZE, 4)
header[8] = 8
header[9] = 0
const raw = Buffer.alloc(SIZE * (SIZE + 1))
for (let y = 0; y < SIZE; y++) {
	raw[y * (SIZE + 1)] = 0
	raw.set(pixels.subarray(y * SIZE, (y + 1) * SIZE), y * (SIZE + 1) + 1)
}

writeFileSync(
	OUTPUT,
	Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', header),
		chunk('IDAT', deflateSync(raw, { level: 9 })),
		chunk('IEND', Buffer.alloc(0)),
	]),
)
console.log(`Wrote ${OUTPUT.pathname}`)
