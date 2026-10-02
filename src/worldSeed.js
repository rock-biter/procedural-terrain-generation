// One seed drives terrain noise (`seed:octave`), the biome offset
// (`seed:biome`), and scenery placement. It comes from `?seed=` or a random
// per-load value, and the `?gui=1` World folder can replace it at runtime.

const RANDOM_SEED_LENGTH = 8

// Returns the trimmed seed, or null for an empty or blank value.
export function normalizeWorldSeed(value) {
	if (value === null || value === undefined) return null
	const seed = String(value).trim()
	return seed === '' ? null : seed
}

export function parseWorldSeed(urlParams) {
	return normalizeWorldSeed(urlParams.get('seed'))
}

// A short base-36 seed that is easy to read, copy, and pass as `?seed=`.
export function createRandomSeed(random = Math.random) {
	let seed = ''
	for (let i = 0; i < RANDOM_SEED_LENGTH; i++) {
		seed += Math.floor(random() * 36).toString(36)
	}
	return seed
}
