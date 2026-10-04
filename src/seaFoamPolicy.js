import { IMPOSTOR_TYPE, IMPOSTOR_TYPE_COUNT } from './impostors/impostorTypes.js'

// Pure rules of the sea foam map (src/seaFoam.js): the ripples that circle the
// coast, drawn by getSeaRipple() in src/shaders/sea-ripple-pars-fragment.glsl
// from the sea depth, also circle the sea rocks. The map stores, around the
// airplane, how close every flat world point is to the nearest rock; the
// terrain shader fuses that distance with the raw sea height into one height
// (getSeaFoamHeight()) and draws the ripples on it. Three-free.

// Instance types that raise ripples: the rocks standing in the sea.
export const SEA_FOAM_TYPES = Object.freeze([IMPOSTOR_TYPE.SEA_ROCK])

// Share of a source's height, from its base, whose horizontal reach is the
// footprint: the part around the waterline, not the overhanging top.
export const SEA_FOAM_FOOTPRINT_HEIGHT = 0.4

// enabled gates the rocks' share of the sea height, and strength (0 to 1)
// weighs it. `reach` is how far, in world units from a rock's edge, the map
// holds a distance: farther, the sea is free of the rock. Next to a rock the
// sea height is `edgeDepth`; away from it, it may move back toward the raw
// height by `slope` per world unit. The ripples fill the heights from -3.5 to
// -7.5 (as on the coast): over deep water the defaults draw them from the
// rock's edge out to about 6 units, over shallow water out to about 4.
// `blend` is the height range over which the coast and the rocks merge. The
// rocks' weight fades over the outer quarter of the reach, where the cone
// (edgeDepth ± 0.75 * reach * slope: -8.6 and -1.4) is wider than the lines
// and the blend, so the fade never shows. The map renders again once the
// airplane has moved `recenterShare` of the radius.
export const SEA_FOAM_DEFAULTS = Object.freeze({
	enabled: true,
	strength: 1,
	reach: 12,
	edgeDepth: -5,
	slope: 0.4,
	blend: 1.5,
	recenterShare: 0.02,
})

// Half-size of the covered square (world units) and map resolution (texels
// per side): about one unit per texel on desktop, 1.4 on mobile.
export const SEA_FOAM_PRESETS = Object.freeze({
	desktop: Object.freeze({ radius: 600, mapSize: 1024 }),
	mobile: Object.freeze({ radius: 360, mapSize: 512 }),
})

export function createSeaFoamSettings({ isMobile = false } = {}) {
	const preset = isMobile ? SEA_FOAM_PRESETS.mobile : SEA_FOAM_PRESETS.desktop
	return { ...SEA_FOAM_DEFAULTS, radius: preset.radius, mapSize: preset.mapSize }
}

// Horizontal radius of a source around its vertical axis: the farthest
// position (x, y, z triplets) within SEA_FOAM_FOOTPRINT_HEIGHT of its height
// from the base.
export function getFootprintRadius(positions) {
	let minY = Infinity
	let maxY = -Infinity
	for (let index = 1; index < positions.length; index += 3) {
		minY = Math.min(minY, positions[index])
		maxY = Math.max(maxY, positions[index])
	}
	const top = minY + (maxY - minY) * SEA_FOAM_FOOTPRINT_HEIGHT
	let radius = 0
	for (let index = 0; index < positions.length; index += 3) {
		if (positions[index + 1] > top) continue
		radius = Math.max(radius, Math.hypot(positions[index], positions[index + 2]))
	}
	return radius
}

// Footprint radius per instance type at scale 1, 0 for types without
// ripples. `getPositions(type)` returns a type's LOD 0 source positions.
export function getSeaFoamRadii(getPositions, types = SEA_FOAM_TYPES) {
	const radii = new Array(IMPOSTOR_TYPE_COUNT).fill(0)
	for (const type of types) radii[type] = getFootprintRadius(getPositions(type))
	return radii
}

// The covered square around (x, z): its center snapped to whole texels, so
// maps rendered from nearby points share the texel grid and the ripples do
// not jump when the map re-centers.
export function getSeaFoamWindow(x, z, settings, target = {}) {
	const texel = (settings.radius * 2) / settings.mapSize
	target.x = Math.round(x / texel) * texel
	target.z = Math.round(z / texel) * texel
	target.halfSize = settings.radius
	target.texel = texel
	return target
}

// True when a square chunk centered on (centerX, centerZ) can hold a
// footprint reaching into the window. `margin` covers the footprints beyond
// a rock's base: its radius, the reach, and satellites across the chunk edge.
export function chunkIntersectsSeaFoamWindow(centerX, centerZ, halfSize, window, margin) {
	const reach = halfSize + window.halfSize + margin
	return Math.abs(centerX - window.x) <= reach && Math.abs(centerZ - window.z) <= reach
}

// True when the map must render again around (x, z). `center` is the [x, z]
// of the last render, or null before the first one; `castersChanged` is set
// when the drawn rock chunks differ from the last render.
export function shouldRenderSeaFoam({
	center,
	x,
	z,
	recenterDistance,
	castersChanged = false,
	forced = false,
}) {
	if (forced || castersChanged || !center) return true
	return Math.hypot(x - center[0], z - center[1]) > recenterDistance
}

// Number of instances of a foam type in an IMPOSTOR_INSTANCE_STRIDE array.
export function countSeaFoamInstances(instances, stride, radii) {
	let count = 0
	for (let index = 5; index < instances.length; index += stride) {
		if (radii[Math.round(instances[index])] > 0) count++
	}
	return count
}
