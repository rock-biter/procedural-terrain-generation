import {
	BoxGeometry,
	BufferAttribute,
	CapsuleGeometry,
	Color,
	ConeGeometry,
	CylinderGeometry,
	IcosahedronGeometry,
	QuadraticBezierCurve3,
	SphereGeometry,
	TubeGeometry,
	Vector3,
} from 'three'
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { snoise } from '../noise.js'
import { SCENERY_PAINT_BASE } from '../sceneryPalettePolicy.js'
import { IMPOSTOR_TYPE } from './impostorTypes.js'

// Source models for the impostor baker and the near scenery meshes. They are
// built from Three.js primitives in world units with the base on y = 0. The
// near meshes draw them at runtime (sceneryMeshes.js) in two levels of detail,
// so segment counts are kept low.

const COLORS = {
	// The trees, cacti, and rocks (SCENERY_PAINTED_TYPES) are baked in a
	// neutral linear gray: their colors come from the palette uniforms at
	// runtime (src/sceneryPalettePolicy.js), the rocks' by biome.
	painted: new Color().setScalar(SCENERY_PAINT_BASE),
	// The sea rock's smaller stone, painted like the others but baked darker,
	// so the group keeps two tones under any palette color.
	paintedDark: new Color().setScalar(SCENERY_PAINT_BASE * 0.64),
	// Every other layer of the layered rock, as much darker as its former
	// wood tones (#cfa878 under #e3c9a0).
	paintedLayer: new Color().setScalar(SCENERY_PAINT_BASE * 0.7),
	// The stand-in boat (boat()).
	boatHull: '#b5462f',
	boatCabin: '#efe3c8',
}

// `paint` (0 or 1) fills the part's `paint` attribute: 1 marks a painted part
// (a tree crown, a whole cactus), which takes the instance's palette color
// instead of the trunk color. Every part carries it so mergeGeometries() finds
// the same attributes.
function part(geometry, color, { lumps = 0, lumpScale = 0.8, ribs = 0, paint = 0 } = {}) {
	let smooth = geometry.index ? geometry.toNonIndexed() : geometry
	smooth.deleteAttribute('normal')
	smooth.deleteAttribute('uv')
	smooth = mergeVertices(smooth)
	smooth.computeVertexNormals()

	const position = smooth.attributes.position
	const normal = smooth.attributes.normal
	smooth.computeBoundingBox()
	const { min, max } = smooth.boundingBox
	const center = new Vector3()
	smooth.boundingBox.getCenter(center)

	for (let i = 0; i < position.count; i++) {
		let x = position.getX(i)
		let y = position.getY(i)
		let z = position.getZ(i)

		if (ribs > 0) {
			const angle = Math.atan2(z - center.z, x - center.x)
			const rib = 1 + 0.06 * Math.cos(angle * ribs)
			x = center.x + (x - center.x) * rib
			z = center.z + (z - center.z) * rib
		}

		if (lumps > 0) {
			const n =
				snoise(x * lumpScale + 17.3, (y + z) * lumpScale) * 0.7 +
				snoise((x - z) * lumpScale * 2.1, y * lumpScale * 2.1 - 5.1) * 0.3
			x += normal.getX(i) * n * lumps
			y += normal.getY(i) * n * lumps
			z += normal.getZ(i) * n * lumps
		}

		position.setXYZ(i, x, y, z)
	}
	smooth.computeVertexNormals()

	// Clay-style occlusion: darken the lower part of every piece.
	const base = new Color(color)
	const colors = new Float32Array(position.count * 3)
	const height = Math.max(max.y - min.y, 1e-6)
	for (let i = 0; i < position.count; i++) {
		const t = Math.min(Math.max((position.getY(i) - min.y) / height, 0), 1)
		const occlusion = 0.62 + 0.38 * Math.sqrt(t)
		colors[i * 3] = base.r * occlusion
		colors[i * 3 + 1] = base.g * occlusion
		colors[i * 3 + 2] = base.b * occlusion
	}
	smooth.setAttribute('color', new BufferAttribute(colors, 3))
	smooth.setAttribute('paint', new BufferAttribute(new Float32Array(position.count).fill(paint), 1))

	return smooth
}

// Segment counts per level of detail: LOD 0 is baked into the atlas and drawn
// near the eye; LOD 1 keeps the same shapes with about a third of the
// triangles for the meshes farther out (sceneryMeshes.js).
function detail(lod, full, reduced) {
	return lod === 0 ? full : reduced
}

function roundTree(lod) {
	const trunk = new CylinderGeometry(0.35, 0.55, 2.8, detail(lod, 10, 6), detail(lod, 2, 1))
	trunk.translate(0, 1.4, 0)

	const crown = new IcosahedronGeometry(2.3, detail(lod, 3, 2))
	crown.scale(1, 0.9, 1)
	crown.translate(0, 4.3, 0)
	const sideBlob = new IcosahedronGeometry(1.45, detail(lod, 2, 1))
	sideBlob.translate(1.55, 3.5, 0.5)
	const backBlob = new IcosahedronGeometry(1.3, detail(lod, 2, 1))
	backBlob.translate(-1.2, 3.6, -1.1)

	return [
		part(trunk, COLORS.painted),
		part(crown, COLORS.painted, { lumps: 0.12, lumpScale: 1.1, paint: 1 }),
		part(sideBlob, COLORS.painted, { lumps: 0.08, lumpScale: 1.4, paint: 1 }),
		part(backBlob, COLORS.painted, { lumps: 0.08, lumpScale: 1.4, paint: 1 }),
	]
}

function conifer(lod) {
	const trunk = new CylinderGeometry(0.28, 0.4, 1.8, detail(lod, 10, 6), 1)
	trunk.translate(0, 0.9, 0)

	const tiers = [
		[2.1, 3.0, 2.7],
		[1.65, 2.6, 4.2],
		[1.15, 2.2, 5.6],
	].map(([radius, height, y]) => {
		const cone = new ConeGeometry(radius, height, detail(lod, 14, 9), detail(lod, 3, 1))
		cone.translate(0, y, 0)
		return part(cone, COLORS.painted, { lumps: 0.05, lumpScale: 1.6, paint: 1 })
	})

	return [part(trunk, COLORS.painted), ...tiers]
}

function cactusArm(lod, side, startY, reach, rise, radius) {
	const curve = new QuadraticBezierCurve3(
		new Vector3(0, startY, 0),
		new Vector3(side * reach, startY, 0),
		new Vector3(side * reach, startY + rise, 0),
	)
	const tube = new TubeGeometry(curve, detail(lod, 10, 6), radius, detail(lod, 8, 5), false)
	const tip = new SphereGeometry(radius, detail(lod, 8, 5), detail(lod, 6, 3))
	tip.translate(side * reach, startY + rise, 0)

	return [part(tube, COLORS.painted, { paint: 1 }), part(tip, COLORS.painted, { paint: 1 })]
}

function cactusTrunk(lod) {
	// Two radial segments per rib keep the 9 ribs from aliasing. LOD 1 is too
	// coarse for ribs and keeps a plain 9-sided trunk.
	const trunk = new CapsuleGeometry(
		0.6,
		3.8,
		detail(lod, 4, 2),
		detail(lod, 18, 9),
		detail(lod, 3, 1),
	)
	trunk.translate(0, 2.3, 0)
	return part(trunk, COLORS.painted, { ribs: detail(lod, 9, 0), paint: 1 })
}

function cactusOneArm(lod) {
	return [cactusTrunk(lod), ...cactusArm(lod, 1, 2.2, 1.35, 1.6, 0.38)]
}

function cactusTwoArms(lod) {
	return [
		cactusTrunk(lod),
		...cactusArm(lod, 1, 2.6, 1.3, 1.5, 0.36),
		...cactusArm(lod, -1, 1.7, 1.2, 1.3, 0.34),
	]
}

function boulder(lod) {
	const rock = new IcosahedronGeometry(1.5, detail(lod, 3, 2))
	rock.scale(1.15, 0.72, 1)
	rock.translate(0, 0.85, 0)
	return [part(rock, COLORS.painted, { lumps: 0.22, lumpScale: 0.9, paint: 1 })]
}

function layeredRock(lod) {
	const layers = [
		[3.0, 3.2, 1.3],
		[2.55, 2.85, 1.2],
		[2.1, 2.4, 1.1],
		[1.5, 1.85, 0.9],
	]
	let y = 0
	return layers.map(([top, bottom, height], index) => {
		const layer = new CylinderGeometry(top, bottom, height, detail(lod, 11, 7), detail(lod, 2, 1))
		layer.translate(0.15 * index, y + height / 2, -0.1 * index)
		y += height * 0.94
		const color = index % 2 === 0 ? COLORS.paintedLayer : COLORS.painted
		return part(layer, color, { lumps: 0.12, lumpScale: 0.7, paint: 1 })
	})
}

// A group of three stones for the coast: tapered cones, wide at the base and
// narrower at the blunt top, leaning slightly and roughened by the lumps so
// their faces stay irregular. Painted whole: the color comes from the sea
// rock palette (src/sceneryPalettePolicy.js). Placement sinks the base below the water
// surface (src/sceneryPlacement.js), so the stones rise from the sea; their
// bottoms reach slightly below y = 0.
function seaRock(lod) {
	// [base radius, height, x, z, lean around x, lean around z, color]
	const stones = [
		[1.5, 2.0, 0, 0, 0.06, -0.08, COLORS.painted],
		[1.05, 1.35, 1.65, -0.5, -0.05, -0.18, COLORS.paintedDark],
		[0.8, 1.05, -1.15, 1.1, 0.16, 0.1, COLORS.painted],
	]
	return stones.map(([radius, height, x, z, leanX, leanZ, color]) => {
		const stone = new CylinderGeometry(
			radius * 0.42,
			radius,
			height,
			detail(lod, 10, 6),
			detail(lod, 5, 2),
		)
		stone.translate(0, height / 2 - 0.03, 0)
		stone.rotateX(leanX)
		stone.rotateZ(leanZ)
		stone.translate(x, 0, z)
		return part(stone, color, { lumps: 0.2, lumpScale: 0.85, paint: 1 })
	})
}

// A stand-in toy boat with the model's length and beam (SCENERY_CONFIG.boat in
// src/sceneryPlacement.js): an oval tub and a cabin. The boat is drawn from its
// model (src/impostors/boatSources.js, set with setCatalogSources()); this one
// is baked only if the model fails to load, and lets the Node tests build
// every type.
function boat(lod) {
	const hull = new CylinderGeometry(1, 0.8, 2.6, detail(lod, 16, 8), 1)
	hull.scale(3.6, 1, 6)
	hull.translate(0, 1.3, 0)
	const cabin = new BoxGeometry(3.2, 2, 4)
	cabin.translate(0, 3.6, -0.8)
	return [part(hull, COLORS.boatHull), part(cabin, COLORS.boatCabin)]
}

const BUILDERS = {
	[IMPOSTOR_TYPE.ROUND_TREE]: roundTree,
	[IMPOSTOR_TYPE.CONIFER]: conifer,
	[IMPOSTOR_TYPE.CACTUS_ONE_ARM]: cactusOneArm,
	[IMPOSTOR_TYPE.CACTUS_TWO_ARMS]: cactusTwoArms,
	[IMPOSTOR_TYPE.BOULDER]: boulder,
	[IMPOSTOR_TYPE.LAYERED_ROCK]: layeredRock,
	[IMPOSTOR_TYPE.SEA_ROCK]: seaRock,
	[IMPOSTOR_TYPE.BOAT]: boat,
}

function buildSource(type, lod) {
	const parts = BUILDERS[type](lod)
	const geometry = mergeGeometries(parts)
	parts.forEach((piece) => piece.dispose())
	return geometry
}

// Returns [LOD 0, LOD 1] geometries of one type. Both are shifted by the LOD 0
// recentering: the bounding sphere is centered on the y axis, so instance yaw
// rotates around the base, which stays on y = 0, and the levels and the
// impostor (baked from LOD 0) share one local frame.
export function createScenerySources(type, lodCount = 1) {
	const sources = []
	for (let lod = 0; lod < lodCount; lod++) sources.push(buildSource(type, lod))
	const lod0 = sources[0]
	lod0.computeBoundingSphere()
	const { x, z } = lod0.boundingSphere.center
	for (const geometry of sources) {
		geometry.translate(-x, 0, -z)
		geometry.computeBoundingSphere()
	}
	return sources
}
