import {
	Color,
	GLSL3,
	LinearFilter,
	LinearMipmapLinearFilter,
	Mesh,
	NearestFilter,
	OrthographicCamera,
	PlaneGeometry,
	Scene,
	ShaderMaterial,
	Vector2,
	Vector3,
	WebGLRenderTarget,
} from 'three'
import bakeVertexShader from '../shaders/impostor-bake-vertex.glsl'
import bakeFragmentShader from '../shaders/impostor-bake-fragment.glsl'
import fullscreenVertexShader from '../shaders/fullscreen-vertex.glsl'
import resolveFragmentShader from '../shaders/impostor-resolve-fragment.glsl'
import { createImpostorSource } from './impostorArchetypes'
import { getFrameDirection } from './octahedral'
import {
	IMPOSTOR_ATLAS_COLUMNS,
	IMPOSTOR_ATLAS_ROWS,
	IMPOSTOR_FRAMES_DESKTOP,
	IMPOSTOR_TYPE_COUNT,
} from './impostorTypes'

// Extra room around the bounding sphere so silhouettes never touch the frame
// edge, which keeps bilinear and low mip samples inside their own frame.
const FRAME_MARGIN = 1.04
// Transparent texels copy the nearest opaque color within this many texels.
const DILATION_RADIUS = 4
// Frames are rendered at this multiple of their final size, then downsampled.
const SUPERSAMPLE = 2

// Renders every impostor type from frames x frames hemi-octahedral directions
// into one albedo and one normal/depth atlas. `detail` optionally adds a
// tileable grayscale texture as brightness and bump:
// { texture, scale (repeats per unit), color, bump }.
export function bakeImpostorAtlas(
	renderer,
	{ frames = IMPOSTOR_FRAMES_DESKTOP, frameSize = 64, detail = null } = {},
) {
	if (frames < 2 || frames % 2 !== 0) {
		throw new Error(`Impostor frame count ${frames} must be even`)
	}
	const cellSize = frames * frameSize
	const width = cellSize * IMPOSTOR_ATLAS_COLUMNS
	const height = cellSize * IMPOSTOR_ATLAS_ROWS

	// One type block at a time keeps the supersampled target small enough for
	// mobile texture limits (2048 px for 16 frames of 64 px).
	const bakeSize = cellSize * SUPERSAMPLE
	const bakeTarget = new WebGLRenderTarget(bakeSize, bakeSize, {
		count: 2,
		minFilter: NearestFilter,
		magFilter: NearestFilter,
		generateMipmaps: false,
	})
	const atlasTarget = new WebGLRenderTarget(width, height, {
		count: 2,
		depthBuffer: false,
		minFilter: LinearMipmapLinearFilter,
		magFilter: LinearFilter,
		generateMipmaps: true,
	})

	const previousTarget = renderer.getRenderTarget()
	const previousClearColor = renderer.getClearColor(new Color())
	const previousClearAlpha = renderer.getClearAlpha()
	const previousAutoClear = renderer.autoClear

	const bakeMaterial = new ShaderMaterial({
		glslVersion: GLSL3,
		vertexColors: true,
		defines: detail?.texture ? { USE_DETAIL: '' } : {},
		uniforms: {
			uForward: { value: new Vector3() },
			uCenter: { value: new Vector3() },
			uFrameRadius: { value: 1 },
			uDetail: { value: detail?.texture ?? null },
			uDetailScale: { value: detail?.scale ?? 1 },
			uDetailColor: { value: detail?.color ?? 0 },
			uDetailBump: { value: detail?.bump ?? 0 },
		},
		vertexShader: bakeVertexShader,
		fragmentShader: bakeFragmentShader,
	})
	const resolveMaterial = new ShaderMaterial({
		glslVersion: GLSL3,
		defines: { SUPERSAMPLE, DILATION_RADIUS },
		uniforms: {
			tAlbedo: { value: bakeTarget.textures[0] },
			tNormal: { value: bakeTarget.textures[1] },
			uFrameSize: { value: frameSize },
			uBlockOrigin: { value: new Vector2() },
		},
		vertexShader: fullscreenVertexShader,
		fragmentShader: resolveFragmentShader,
		depthTest: false,
		depthWrite: false,
	})
	const bakeScene = new Scene()
	const resolveScene = new Scene()
	const quad = new Mesh(new PlaneGeometry(2, 2), resolveMaterial)
	quad.frustumCulled = false
	resolveScene.add(quad)
	const camera = new OrthographicCamera()
	const types = []

	renderer.setClearColor(0x000000, 0)
	renderer.autoClear = false

	for (let type = 0; type < IMPOSTOR_TYPE_COUNT; type++) {
		const geometry = createImpostorSource(type)
		const { center, radius } = geometry.boundingSphere
		const frameRadius = radius * FRAME_MARGIN
		const mesh = new Mesh(geometry, bakeMaterial)
		bakeScene.add(mesh)

		camera.left = -frameRadius
		camera.right = frameRadius
		camera.top = frameRadius
		camera.bottom = -frameRadius
		camera.near = 0
		camera.far = frameRadius * 4
		camera.updateProjectionMatrix()

		bakeMaterial.uniforms.uCenter.value.copy(center)
		bakeMaterial.uniforms.uFrameRadius.value = frameRadius

		bakeTarget.viewport.set(0, 0, bakeSize, bakeSize)
		bakeTarget.scissorTest = false
		renderer.setRenderTarget(bakeTarget)
		renderer.clear()
		bakeTarget.scissorTest = true

		const bakeFrameSize = frameSize * SUPERSAMPLE
		for (let frameY = 0; frameY < frames; frameY++) {
			for (let frameX = 0; frameX < frames; frameX++) {
				const direction = getFrameDirection(frameX, frameY, frames)
				bakeMaterial.uniforms.uForward.value.set(...direction)
				// lookAt() with world up builds the same basis as getFrameBasis().
				camera.position
					.set(...direction)
					.multiplyScalar(frameRadius * 2)
					.add(center)
				camera.up.set(0, 1, 0)
				camera.lookAt(center)
				camera.updateMatrixWorld()

				const x = frameX * bakeFrameSize
				const y = frameY * bakeFrameSize
				bakeTarget.viewport.set(x, y, bakeFrameSize, bakeFrameSize)
				bakeTarget.scissor.set(x, y, bakeFrameSize, bakeFrameSize)
				renderer.setRenderTarget(bakeTarget)
				renderer.render(bakeScene, camera)
			}
		}

		bakeScene.remove(mesh)
		geometry.dispose()
		types.push({ frameRadius, centerY: center.y })

		// Resolve this type into its block of the atlas.
		const blockX = (type % IMPOSTOR_ATLAS_COLUMNS) * cellSize
		const blockY = Math.floor(type / IMPOSTOR_ATLAS_COLUMNS) * cellSize
		resolveMaterial.uniforms.uBlockOrigin.value.set(blockX, blockY)
		atlasTarget.viewport.set(blockX, blockY, cellSize, cellSize)
		renderer.setRenderTarget(atlasTarget)
		renderer.render(resolveScene, camera)
	}

	renderer.setRenderTarget(previousTarget)
	renderer.setClearColor(previousClearColor, previousClearAlpha)
	renderer.autoClear = previousAutoClear
	atlasTarget.viewport.set(0, 0, width, height)

	quad.geometry.dispose()
	resolveMaterial.dispose()
	bakeMaterial.dispose()
	bakeTarget.dispose()

	return {
		target: atlasTarget,
		albedo: atlasTarget.textures[0],
		normal: atlasTarget.textures[1],
		frames,
		frameSize,
		types,
		dispose: () => atlasTarget.dispose(),
	}
}
