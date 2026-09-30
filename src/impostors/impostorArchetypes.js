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
import {
	mergeGeometries,
	mergeVertices,
} from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { snoise } from '../biome'
import { IMPOSTOR_TYPE } from './impostorTypes'

// Source models for the impostor baker. They are built from Three.js
// primitives in world units with the base on y = 0 and are rendered only once,
// so vertex counts here do not affect runtime cost.

const COLORS = {
	trunk: '#7a4a2a',
	// Wood-toy look: light brown round-tree crowns, darker brown conifers
	// and cacti, and the lightest woods for rocks.
	leaves: '#c69c6d',
	needles: '#8f5f3a',
	cactus: '#8f5f3a',
	boulder: '#dcc29a',
	rockLight: '#e3c9a0',
	rockDark: '#cfa878',
}

function part(geometry, color, { lumps = 0, lumpScale = 0.8, ribs = 0 } = {}) {
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

	return smooth
}

function roundTree() {
	const trunk = new CylinderGeometry(0.35, 0.55, 2.8, 10, 2)
	trunk.translate(0, 1.4, 0)

	const crown = new IcosahedronGeometry(2.3, 4)
	crown.scale(1, 0.9, 1)
	crown.translate(0, 4.3, 0)
	const sideBlob = new IcosahedronGeometry(1.45, 3)
	sideBlob.translate(1.55, 3.5, 0.5)
	const backBlob = new IcosahedronGeometry(1.3, 3)
	backBlob.translate(-1.2, 3.6, -1.1)

	return [
		part(trunk, COLORS.trunk),
		part(crown, COLORS.leaves, { lumps: 0.12, lumpScale: 1.1 }),
		part(sideBlob, COLORS.leaves, { lumps: 0.08, lumpScale: 1.4 }),
		part(backBlob, COLORS.leaves, { lumps: 0.08, lumpScale: 1.4 }),
	]
}

function conifer() {
	const trunk = new CylinderGeometry(0.28, 0.4, 1.8, 10, 1)
	trunk.translate(0, 0.9, 0)

	const tiers = [
		[2.1, 3.0, 2.7],
		[1.65, 2.6, 4.2],
		[1.15, 2.2, 5.6],
	].map(([radius, height, y]) => {
		const cone = new ConeGeometry(radius, height, 14, 3)
		cone.translate(0, y, 0)
		return part(cone, COLORS.needles, { lumps: 0.05, lumpScale: 1.6 })
	})

	return [part(trunk, COLORS.trunk), ...tiers]
}

function cactusArm(side, startY, reach, rise, radius) {
	const curve = new QuadraticBezierCurve3(
		new Vector3(0, startY, 0),
		new Vector3(side * reach, startY, 0),
		new Vector3(side * reach, startY + rise, 0),
	)
	const tube = new TubeGeometry(curve, 16, radius, 12, false)
	const tip = new SphereGeometry(radius, 12, 8)
	tip.translate(side * reach, startY + rise, 0)

	return [part(tube, COLORS.cactus), part(tip, COLORS.cactus)]
}

function cactusTrunk() {
	const trunk = new CapsuleGeometry(0.6, 3.8, 6, 20, 6)
	trunk.translate(0, 2.3, 0)
	return part(trunk, COLORS.cactus, { ribs: 9 })
}

function cactusOneArm() {
	return [cactusTrunk(), ...cactusArm(1, 2.2, 1.35, 1.6, 0.38)]
}

function cactusTwoArms() {
	return [
		cactusTrunk(),
		...cactusArm(1, 2.6, 1.3, 1.5, 0.36),
		...cactusArm(-1, 1.7, 1.2, 1.3, 0.34),
	]
}

function boulder() {
	const rock = new IcosahedronGeometry(1.5, 4)
	rock.scale(1.15, 0.72, 1)
	rock.translate(0, 0.85, 0)
	return [part(rock, COLORS.boulder, { lumps: 0.22, lumpScale: 0.9 })]
}

function layeredRock() {
	const layers = [
		[3.0, 3.2, 1.3],
		[2.55, 2.85, 1.2],
		[2.1, 2.4, 1.1],
		[1.5, 1.85, 0.9],
	]
	let y = 0
	return layers.map(([top, bottom, height], index) => {
		const layer = new CylinderGeometry(top, bottom, height, 11, 2)
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

// Returns the merged source geometry. Its bounding sphere is centered on the
// y axis so instance yaw rotates around the base, which stays on y = 0.
export function createImpostorSource(type) {
	const parts = BUILDERS[type]()
	const geometry = mergeGeometries(parts)
	parts.forEach((piece) => piece.dispose())
	geometry.computeBoundingSphere()
	const { center } = geometry.boundingSphere
	geometry.translate(-center.x, 0, -center.z)
	geometry.computeBoundingSphere()
	return geometry
}
