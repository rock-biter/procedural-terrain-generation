import { BufferAttribute, BufferGeometry, Color, ExtrudeGeometry, Shape, Vector2 } from 'three'
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { CLOUD_TYPE } from './impostorTypes.js'

// Source models for the cloud impostors and the near cloud meshes, in the
// carved-wood style of docs/style-references/cloud-reference.png: every
// cloud is two or three slabs, each a flat cloud outline extruded along Z with
// rounded (bevelled) edges, so the flat faces look along ±Z. The front face
// (-Z) is the one the shaders turn toward the airplane (scenery-facing.glsl).
// World units, base (the flat bottom) on y = 0.

const COLORS = {
	front: '#ffeac2',
	back: '#f3d9aa',
}

// Per level of detail: samples per full circle along the bumps, segments of
// each rounded notch and bottom corner, spacing of the flat bottom edge, and
// bevel segments. LOD 0 is baked into the atlas and drawn near the eye; LOD 1
// keeps the same outline with about a fifth of the triangles.
const DETAIL = [
	{ circleSegments: 48, filletSegments: 4, bottomSpacing: 4, bevelSegments: 4 },
	{ circleSegments: 16, filletSegments: 2, bottomSpacing: 10, bevelSegments: 2 },
]

// Bevel radius, and the length each notch between two bumps and each bottom
// corner is rounded over, in world units.
const BEVEL = 1.6
const FILLET = 2.2

// Each slab: bumps [x, y, radius] from left to right (consecutive bumps must
// intersect, and the outer ones must reach y = 0), extrusion depth, z offset
// of its front face, and color. The first slab is the front one (lowest z,
// toward the airplane); the others sit behind it, offset sideways like the
// reference.
const CLOUD_SLABS = {
	// Long and low.
	[CLOUD_TYPE.BANK]: [
		{
			bumps: [
				[-24, 7, 8],
				[-11, 11, 11],
				[4, 12, 12],
				[19, 9, 9],
				[30, 5, 6],
			],
			depth: 8,
			z: 0,
			color: COLORS.front,
		},
		{
			bumps: [
				[-31, 6, 7],
				[-19, 12, 11],
				[-4, 13, 10],
				[9, 8, 8],
				[18, 5, 6],
			],
			depth: 7,
			z: 9,
			color: COLORS.back,
		},
	],
	// One tall central bump.
	[CLOUD_TYPE.HEAP]: [
		{
			bumps: [
				[-20, 6, 7],
				[-8, 12, 11],
				[7, 15, 14],
				[21, 7, 8],
			],
			depth: 9,
			z: 0,
			color: COLORS.front,
		},
		{
			bumps: [
				[-28, 6, 7],
				[-17, 12, 10],
				[-3, 14, 11],
				[10, 6, 8],
			],
			depth: 8,
			z: 10,
			color: COLORS.back,
		},
	],
	// Small and compact.
	[CLOUD_TYPE.PUFF]: [
		{
			bumps: [
				[-9, 5, 6],
				[2, 8, 8],
				[11, 4, 5],
			],
			depth: 6,
			z: 0,
			color: COLORS.front,
		},
		{
			bumps: [
				[-12, 5, 6],
				[-3, 8, 7],
				[6, 5, 6],
			],
			depth: 5,
			z: 7,
			color: COLORS.back,
		},
	],
}

// Upper intersection of two circles [x, y, r].
function intersectBumps([ax, ay, ar], [bx, by, br]) {
	const dx = bx - ax
	const dy = by - ay
	const d = Math.hypot(dx, dy)
	if (d >= ar + br || d <= Math.abs(ar - br)) {
		throw new Error('Consecutive cloud bumps must intersect')
	}
	const a = (ar * ar - br * br + d * d) / (2 * d)
	const h = Math.sqrt(Math.max(ar * ar - a * a, 0))
	const px = ax + (a * dx) / d
	const py = ay + (a * dy) / d
	const first = [px - (h * dy) / d, py + (h * dx) / d]
	const second = [px + (h * dy) / d, py - (h * dx) / d]
	return first[1] >= second[1] ? first : second
}

function pointOnBump([x, y, r], angle) {
	return new Vector2(x + Math.cos(angle) * r, y + Math.sin(angle) * r)
}

function pushQuadratic(points, from, control, to, segments) {
	for (let i = 1; i <= segments; i++) {
		const t = i / segments
		const a = (1 - t) * (1 - t)
		const b = 2 * (1 - t) * t
		const c = t * t
		points.push(
			new Vector2(a * from.x + b * control.x + c * to.x, a * from.y + b * control.y + c * to.y),
		)
	}
}

// Closed cloud outline: from the bottom-left corner up and over the bumps
// (walking each circle clockwise between its neighbours) and back along the
// flat bottom. Notches between bumps and the bottom corners are rounded with a
// quadratic fillet. The bottom edge is subdivided so the smooth normals of the
// rounded corners do not tint the whole flat underside.
function createOutline(bumps, { circleSegments, filletSegments, bottomSpacing }) {
	const last = bumps.length - 1
	const first = bumps[0]
	const end = bumps[last]
	if (first[1] >= first[2] || end[1] >= end[2]) {
		throw new Error('The outer cloud bumps must reach the base')
	}

	// Arc of each bump between the previous and next junction (angles walk
	// down, so start > end).
	const junctions = []
	for (let i = 0; i < last; i++) junctions.push(intersectBumps(bumps[i], bumps[i + 1]))
	const arcs = bumps.map((bump, i) => {
		const [x, y, r] = bump
		const start =
			i === 0
				? Math.PI + Math.asin(y / r)
				: Math.atan2(junctions[i - 1][1] - y, junctions[i - 1][0] - x)
		let finish =
			i === last ? -Math.asin(y / r) : Math.atan2(junctions[i][1] - y, junctions[i][0] - x)
		while (finish >= start) finish -= Math.PI * 2
		const trim = Math.min(FILLET / r, (start - finish) * 0.3)
		return { start, finish, trim }
	})

	const points = []
	const bottomLeft = new Vector2(first[0] - Math.sqrt(first[2] ** 2 - first[1] ** 2), 0)
	const bottomRight = new Vector2(end[0] + Math.sqrt(end[2] ** 2 - end[1] ** 2), 0)
	const leftFoot = new Vector2(bottomLeft.x + FILLET, 0)
	const rightFoot = new Vector2(bottomRight.x - FILLET, 0)

	points.push(leftFoot.clone())
	bumps.forEach((bump, i) => {
		const { start, finish, trim } = arcs[i]
		const arcStart = pointOnBump(bump, start - trim)
		const control = i === 0 ? bottomLeft : new Vector2(...junctions[i - 1])
		pushQuadratic(points, points[points.length - 1], control, arcStart, filletSegments)

		const arcFinish = finish + trim
		const steps = Math.max(
			1,
			Math.ceil(((start - trim - arcFinish) / (Math.PI * 2)) * circleSegments),
		)
		for (let step = 1; step <= steps; step++) {
			const angle = start - trim - ((start - trim - arcFinish) * step) / steps
			points.push(pointOnBump(bump, angle))
		}
	})
	pushQuadratic(points, points[points.length - 1], bottomRight, rightFoot, filletSegments)

	// The shape closes from the last point back to leftFoot.
	const bottomSteps = Math.max(1, Math.ceil((rightFoot.x - leftFoot.x) / bottomSpacing))
	for (let step = 1; step < bottomSteps; step++) {
		points.push(new Vector2(rightFoot.x - ((rightFoot.x - leftFoot.x) * step) / bottomSteps, 0))
	}
	return points
}

// Copies one draw group of a non-indexed geometry (ExtrudeGeometry: 0 caps,
// 1 sides) into a position-only geometry.
function extractGroup(geometry, materialIndex) {
	const position = geometry.getAttribute('position')
	const ranges = geometry.groups.filter((group) => group.materialIndex === materialIndex)
	const count = ranges.reduce((sum, group) => sum + group.count, 0)
	const array = new Float32Array(count * 3)
	let offset = 0
	for (const { start, count: groupCount } of ranges) {
		array.set(position.array.subarray(start * 3, (start + groupCount) * 3), offset)
		offset += groupCount * 3
	}
	const part = new BufferGeometry()
	part.setAttribute('position', new BufferAttribute(array, 3))
	return part
}

function paint(geometry, color) {
	const base = new Color(color)
	const colors = new Float32Array(geometry.getAttribute('position').count * 3)
	for (let i = 0; i < colors.length; i += 3) {
		colors[i] = base.r
		colors[i + 1] = base.g
		colors[i + 2] = base.b
	}
	geometry.setAttribute('color', new BufferAttribute(colors, 3))
}

// One slab: flat caps keep their exact ±Z normal, while the bevel and the
// side wall share smooth normals, so the faces read as flat carved wood with
// rounded edges.
function createSlab({ bumps, depth, z, color }, detail) {
	const extruded = new ExtrudeGeometry(new Shape(createOutline(bumps, detail)), {
		depth,
		steps: 1,
		curveSegments: 1,
		bevelEnabled: true,
		bevelThickness: BEVEL,
		bevelSize: BEVEL,
		bevelOffset: 0,
		bevelSegments: detail.bevelSegments,
	})

	const caps = extractGroup(extruded, 0)
	caps.computeVertexNormals()
	const sides = mergeVertices(extractGroup(extruded, 1))
	sides.computeVertexNormals()
	extruded.dispose()

	const parts = [caps, sides.toNonIndexed()]
	sides.dispose()
	for (const part of parts) paint(part, color)
	const slab = mergeGeometries(parts)
	parts.forEach((part) => part.dispose())
	// The bevel starts BEVEL in front of the extrusion.
	slab.translate(0, 0, z + BEVEL)
	return slab
}

// Gentle clay-style occlusion toward the flat underside, softer than on
// scenery so the clouds stay light.
function applyOcclusion(geometry) {
	geometry.computeBoundingBox()
	const { min, max } = geometry.boundingBox
	const position = geometry.getAttribute('position')
	const color = geometry.getAttribute('color')
	const height = Math.max(max.y - min.y, 1e-6)
	for (let i = 0; i < position.count; i++) {
		const t = Math.min(Math.max((position.getY(i) - min.y) / height, 0), 1)
		const occlusion = 0.8 + 0.2 * Math.sqrt(t)
		color.setXYZ(i, color.getX(i) * occlusion, color.getY(i) * occlusion, color.getZ(i) * occlusion)
	}
}

function buildCloud(type, lod) {
	const slabs = CLOUD_SLABS[type].map((slab) => createSlab(slab, DETAIL[lod]))
	const merged = mergeGeometries(slabs)
	slabs.forEach((slab) => slab.dispose())
	applyOcclusion(merged)
	// Indexed, with split vertices along the cap edges.
	const geometry = mergeVertices(merged)
	merged.dispose()
	return geometry
}

// Returns [LOD 0, LOD 1, ...] geometries of one cloud type, indexed, with
// position, normal, and color. Every level is shifted by the LOD 0 placement:
// flat bottom on y = 0 and bounding-sphere center on the y axis, so the levels
// and the impostor share one local frame.
export function createCloudSources(type, lodCount = 1) {
	if (!CLOUD_SLABS[type]) throw new Error(`Unknown cloud type: ${type}`)
	const sources = []
	for (let lod = 0; lod < lodCount; lod++)
		sources.push(buildCloud(type, Math.min(lod, DETAIL.length - 1)))
	const lod0 = sources[0]
	lod0.computeBoundingBox()
	lod0.computeBoundingSphere()
	const { x, z } = lod0.boundingSphere.center
	const y = lod0.boundingBox.min.y
	for (const geometry of sources) {
		geometry.translate(-x, -y, -z)
		geometry.computeBoundingBox()
		geometry.computeBoundingSphere()
	}
	return sources
}
