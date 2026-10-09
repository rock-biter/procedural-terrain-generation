// One seed drives terrain noise (`seed:octave`), the biome offset
// (`seed:biome`), and scenery placement. It comes from `?seed=` or, per load,
// one of CURATED_SEEDS, and the `?gui=1` World folder can replace it at
// runtime.

const RANDOM_SEED_LENGTH = 8

// Hand-picked worlds: a load without `?seed=` starts from one of them, and the
// ?gui=1 World folder lists them.
export const CURATED_SEEDS = Object.freeze([
	'b7dw4ve2',
	'67o4oab5',
	'3izszjaj',
	'cbhvtsph',
	'3ea1xj3i',
	'qxtk3aqp',
	'0j1a6vo6',
	'ra9tzb0y',
	'329ncxsc',
	'r69ei8qn',
	'81fjd6xv',
	'9r1bk278',
])

// Worlds whose spawn lies in the deep ocean with an archipelago just ahead
// (the airplane starts heading +Z): kept to show the biome at once. Only
// `9r1bk278` is also curated; the ?gui=1 World folder lists them all.
export const DEEP_OCEAN_SEEDS = Object.freeze(['9r1bk278', '693vp4f9', 'rchldejw'])

// Returns the trimmed seed, or null for an empty or blank value.
export function normalizeWorldSeed(value) {
	if (value === null || value === undefined) return null
	const seed = String(value).trim()
	return seed === '' ? null : seed
}

export function parseWorldSeed(urlParams) {
	return normalizeWorldSeed(urlParams.get('seed'))
}

// One of CURATED_SEEDS, picked by `random` (0 to 1).
export function pickCuratedSeed(random = Math.random) {
	const index = Math.floor(random() * CURATED_SEEDS.length)
	return CURATED_SEEDS[Math.min(index, CURATED_SEEDS.length - 1)]
}

// A short base-36 seed that is easy to read, copy, and pass as `?seed=`.
export function createRandomSeed(random = Math.random) {
	let seed = ''
	for (let i = 0; i < RANDOM_SEED_LENGTH; i++) {
		seed += Math.floor(random() * 36).toString(36)
	}
	return seed
}
