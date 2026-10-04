import { DoubleSide, Matrix4, OrthographicCamera, ShaderMaterial, Vector3 } from 'three'
import casterVertexShader from './shaders/scenery-shadow-caster-vertex.glsl'
import casterFragmentShader from './shaders/scenery-shadow-caster-fragment.glsl'
import { getCatalogDefines } from './impostors/impostorCatalogs'
import { getViewDefines } from './impostors/octahedral'
import { snapToTexel } from './shadowPolicy'

// Light-space helpers shared by the scenery shadow cascades
// (src/sceneryShadows.js) and the cloud shadow map (src/cloudShadows.js).

// Maps clip space [-1, 1] to map UV and depth [0, 1].
const CLIP_TO_TEXTURE = new Matrix4().set(
	0.5,
	0,
	0,
	0.5,
	0,
	0.5,
	0,
	0.5,
	0,
	0,
	0.5,
	0.5,
	0,
	0,
	0,
	1,
)
const WORLD_UP = new Vector3(0, 1, 0)
const WORLD_FORWARD = new Vector3(0, 0, 1)

// An orthographic frame looking along a light, for the shadow cameras.
export class LightBasis {
	// The [x, y, z] direction (toward the light) last set, or null.
	direction = null
	vector = new Vector3()
	right = new Vector3()
	up = new Vector3()
	forward = new Vector3()
	orientation = new OrthographicCamera()

	// Orients the basis toward the unit `direction`. A near-vertical light would
	// make world up degenerate as the camera's up, so it uses world forward.
	setDirection(direction) {
		this.direction = [...direction]
		this.vector.fromArray(direction).normalize()
		this.orientation.position.copy(this.vector)
		this.orientation.up.copy(Math.abs(this.vector.y) > 0.999 ? WORLD_FORWARD : WORLD_UP)
		this.orientation.lookAt(0, 0, 0)
		this.orientation.updateMatrixWorld()
		this.orientation.matrixWorld.extractBasis(this.right, this.up, this.forward)
	}

	// Fits an orthographic `camera` to a square of half-size `radius` around
	// `center`, with clip depths `near` and `far` from a position `offset` world
	// units toward the light. The center snaps to whole texels (`texel` world
	// units) in light space, so the map does not shimmer as it moves; `center`
	// receives the snapped point.
	fit(camera, center, radius, texel, near, far, offset = 0) {
		const x = snapToTexel(center.dot(this.right), texel)
		const y = snapToTexel(center.dot(this.up), texel)
		const z = center.dot(this.forward)
		center
			.copy(this.right)
			.multiplyScalar(x)
			.addScaledVector(this.up, y)
			.addScaledVector(this.forward, z)

		camera.left = -radius
		camera.right = radius
		camera.top = radius
		camera.bottom = -radius
		camera.near = near
		camera.far = far
		camera.updateProjectionMatrix()
		camera.position.copy(center).addScaledVector(this.vector, offset)
		camera.quaternion.copy(this.orientation.quaternion)
		camera.updateMatrixWorld()
		camera.matrixWorldInverse.copy(camera.matrixWorld).invert()
	}
}

// Writes the world-to-map matrix of `camera` that receivers sample with.
export function writeShadowMatrix(target, camera) {
	return target
		.copy(CLIP_TO_TEXTURE)
		.multiply(camera.projectionMatrix)
		.multiply(camera.matrixWorldInverse)
}

// Impostor shadow caster (scenery-shadow-caster-*.glsl) for an atlas of
// `catalog` baked with `views`. `albedo` and `types` are uniform objects
// (shared with the impostor material when its re-bake must reach the caster),
// `light` the LightBasis vector, and `singleFrame` matches the drawn
// impostors. `uniforms`, `defines`, and other material options are added.
export function createImpostorCasterMaterial({
	catalog,
	views,
	albedo,
	types,
	light,
	singleFrame = false,
	uniforms = {},
	defines = {},
	...options
}) {
	return new ShaderMaterial({
		vertexShader: casterVertexShader,
		fragmentShader: casterFragmentShader,
		uniforms: {
			uImpostorAlbedo: albedo,
			uImpostorTypes: types,
			uShadowCasterLight: { value: light },
			...uniforms,
		},
		defines: {
			...getViewDefines(views),
			...getCatalogDefines(catalog),
			...(singleFrame ? { IMPOSTOR_SINGLE_FRAME: '' } : {}),
			...defines,
		},
		side: DoubleSide,
		...options,
	})
}
