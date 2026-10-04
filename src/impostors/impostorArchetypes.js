import {
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
	// Wood-toy look: darker brown cacti and the lightest woods for rocks. The
	// trees (SCENERY_PAINTED_TYPES) are baked in a neutral linear gray: their
	// trunk and crown colors come from the palette uniforms at runtime
	// (src/sceneryPalettePolicy.js).
	painted: new Color().setScalar(SCENERY_PAINT_BASE),
	cactus: '#8f5f3a',
	boulder: '#dcc29a',
	rockLight: '#e3c9a0',
	rockDark: '#cfa878',
}

// `paint` (0 or 1) fills the part's `paint` attribute: 1 marks a crown, which
// takes the instance's palette color instead of the trunk color. Every part
// carries it so mergeGeometries() finds the same attributes.
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

	return [part(tube, COLORS.cactus), part(tip, COLORS.cactus)]
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
	return part(trunk, COLORS.cactus, { ribs: detail(lod, 9, 0) })
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
	return [part(rock, COLORS.boulder, { lumps: 0.22, lumpScale: 0.9 })]
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
		const color = index % 2 === 0 ? COLORS.rockDark : COLORS.rockLight
		return part(layer, color, { lumps: 0.12, lumpScale: 0.7 })
	})
}

const BUILDERS = {
	[IMPOSTOR_TYPE.ROUND_TREE]: roundTree,
	[IMPOSTOR_TYPE.CONIFER]: conifer,
	[IMPOSTOR_TYPE.CACTUS_ONE_ARM]: cactusOneArm,
	[IMPOSTOR_TYPE.CACTUS_TWO_ARMS]: cactusTwoArms,
	[IMPOSTOR_TYPE.BOULDER]: boulder,
	[IMPOSTOR_TYPE.LAYERED_ROCK]: layeredRock,
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
