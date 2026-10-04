// Deterministic randomness shared by scenery and cloud placement (three-free,
// so it also runs in the chunk workers).

// FNV-1a hash of a seed string.
export function hashSeed(seed) {
	let hash = 0x811c9dc5
	const text = String(seed)
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i)
		hash = Math.imul(hash, 0x01000193)
	}
	return hash >>> 0
}

// Stateless per-cell random number in [0, 1).
export function cellRandom(seedHash, cellX, cellZ, salt) {
	let h = seedHash ^ Math.imul(cellX | 0, 0x27d4eb2d)
	h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
	h ^= Math.imul(cellZ | 0, 0x165667b1)
	h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
	h ^= Math.imul(salt + 1, 0x9e3779b9)
	h = Math.imul(h ^ (h >>> 16), 0x7feb352d)
	h ^= h >>> 15
	return (h >>> 0) / 4294967296
}

// The key of `table` ([key, weight] pairs) at `value` in [0, 1) of the total weight.
export function pickWeighted(table, value) {
	let total = 0
	for (const [, weight] of table) total += weight
	let threshold = value * total
	for (const [type, weight] of table) {
		threshold -= weight
		if (threshold < 0) return type
	}
	return table[table.length - 1][0]
}
