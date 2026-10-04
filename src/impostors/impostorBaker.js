import {
	Color,
	GLSL3,
	LinearFilter,
	LinearMipmapLinearFilter,
	Mesh,
	NearestFilter,
	OrthographicCamera,
	PlaneGeometry,
	RedFormat,
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
import sceneryDetailParsFragment from '../shaders/scenery-detail-pars-fragment.glsl'
import { replaceChunks } from '../shaderChunks'
import { SCENERY_IMPOSTORS, getCatalogSources } from './impostorCatalogs'
import {
	createHemiOctViews,
	getAtlasLayout,
	getMaxImpostorFrameSize,
	getViewFrameDirection,
} from './octahedral'
import { IMPOSTOR_FRAMES_DESKTOP } from './impostorTypes'

// Extra room around the bounding sphere so silhouettes never touch the frame
// edge, which keeps bilinear and low mip samples inside their own frame.
const FRAME_MARGIN = 1.04
// Transparent texels copy the nearest opaque color within this many texels.
const DILATION_RADIUS = 4
// Frames are rendered at this multiple of their final size, then downsampled.
const SUPERSAMPLE = 2

// The resolve pass is the same for every bake, so its material (and compiled
// program) and quad are kept across bakes instead of being rebuilt each time.
let resolvePass = null

function getResolvePass() {
	if (!resolvePass) {
		const material = new ShaderMaterial({
			glslVersion: GLSL3,
			defines: { SUPERSAMPLE, DILATION_RADIUS },
			uniforms: {
				tAlbedo: { value: null },
				tNormal: { value: null },
				tPaint: { value: null },
				uFrameSize: { value: 1 },
				uBlockOrigin: { value: new Vector2() },
			},
			vertexShader: fullscreenVertexShader,
			fragmentShader: resolveFragmentShader,
			depthTest: false,
			depthWrite: false,
		})
		const quad = new Mesh(new PlaneGeometry(2, 2), material)
		quad.frustumCulled = false
		const scene = new Scene()
		scene.add(quad)
		resolvePass = { material, scene }
	}
	return resolvePass
}

// Renders every type of an impostor `catalog` (impostorCatalogs.js) from the
// grid directions of a view layout (`views`, octahedral.js) into one albedo,
// one normal/depth, and one single-channel crown-mask atlas (the sources'
// `paint` attribute with SCENERY_PALETTE, 0 otherwise). Without `views`, the
// layout is a frames x frames hemi-octahedral grid of the catalog's
// hemisphere. `detail` optionally multiplies the albedo by a tileable color
// texture: { texture, types }, where types[type] is that type's { scale
// (repeats per unit), color (strength), normalized } (see applyDetail() in
// scenery-detail-pars-fragment.glsl). `frameSize` shrinks when the atlas
// would exceed the GPU limit.
export function bakeImpostorAtlas(
	renderer,
	{
		catalog = SCENERY_IMPOSTORS,
		frames = IMPOSTOR_FRAMES_DESKTOP,
		views = createHemiOctViews(frames, catalog.hemisphere),
		frameSize: requestedFrameSize = 64,
		detail = null,
	} = {},
) {
	const frameSize = Math.min(
		requestedFrameSize,
		getMaxImpostorFrameSize(renderer.capabilities.maxTextureSize, views, catalog, SUPERSAMPLE),
	)
	const { blockWidth, blockHeight, width, height } = getAtlasLayout(views, catalog, frameSize)

	// One type block at a time keeps the supersampled target small enough for
	// mobile texture limits (2048 px for 16 frames of 64 px).
	const bakeWidth = blockWidth * SUPERSAMPLE
	const bakeHeight = blockHeight * SUPERSAMPLE
	const bakeTarget = new WebGLRenderTarget(bakeWidth, bakeHeight, {
		count: 3,
		minFilter: NearestFilter,
		magFilter: NearestFilter,
		generateMipmaps: false,
	})
	const atlasTarget = new WebGLRenderTarget(width, height, {
		count: 3,
		depthBuffer: false,
		minFilter: LinearMipmapLinearFilter,
		magFilter: LinearFilter,
		generateMipmaps: true,
	})
	// The crown mask needs one channel; three sets every attachment up from
	// its own texture's format.
	bakeTarget.textures[2].format = RedFormat
	atlasTarget.textures[2].format = RedFormat

	const previousTarget = renderer.getRenderTarget()
	const previousClearColor = renderer.getClearColor(new Color())
	const previousClearAlpha = renderer.getClearAlpha()
	const previousAutoClear = renderer.autoClear

	const bakeMaterial = new ShaderMaterial({
		glslVersion: GLSL3,
		vertexColors: true,
		// The catalog defines select the detail projection the near meshes use.
		defines: {
			...catalog.defines,
			...(detail?.texture ? { USE_DETAIL: '' } : {}),
		},
		uniforms: {
			uForward: { value: new Vector3() },
			uCenter: { value: new Vector3() },
			uFrameRadius: { value: 1 },
			uDetail: { value: detail?.texture ?? null },
			uDetailSettings: { value: new Vector3() },
		},
		vertexShader: bakeVertexShader,
		// The near meshes sample the same detail function (sceneryMeshes.js).
		fragmentShader: replaceChunks(bakeFragmentShader, {
			scenery_detail_pars_fragment: sceneryDetailParsFragment,
		}),
	})
	const { material: resolveMaterial, scene: resolveScene } = getResolvePass()
	resolveMaterial.uniforms.tAlbedo.value = bakeTarget.textures[0]
	resolveMaterial.uniforms.tNormal.value = bakeTarget.textures[1]
	resolveMaterial.uniforms.tPaint.value = bakeTarget.textures[2]
	resolveMaterial.uniforms.uFrameSize.value = frameSize
	const bakeScene = new Scene()
	const camera = new OrthographicCamera()
	const types = []

	renderer.setClearColor(0x000000, 0)
	renderer.autoClear = false

	for (let type = 0; type < catalog.typeCount; type++) {
		// Shared with the near meshes: not disposed here.
		const geometry = getCatalogSources(catalog, type)[0]
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
		// Every render() re-uploads the material's uniforms, so the type's wood
		// settings reach all of its frames.
		const typeDetail = detail?.types?.[type]
		if (typeDetail) {
			bakeMaterial.uniforms.uDetailSettings.value.set(
				typeDetail.scale,
				typeDetail.color,
				typeDetail.normalized ? 1 : 0,
			)
		} else {
			bakeMaterial.uniforms.uDetailSettings.value.set(1, 0, 0)
		}

		bakeTarget.viewport.set(0, 0, bakeWidth, bakeHeight)
		bakeTarget.scissorTest = false
		renderer.setRenderTarget(bakeTarget)
		renderer.clear()
		bakeTarget.scissorTest = true

		const bakeFrameSize = frameSize * SUPERSAMPLE
		for (let frameY = 0; frameY < views.framesY; frameY++) {
			for (let frameX = 0; frameX < views.framesX; frameX++) {
				const direction = getViewFrameDirection(frameX, frameY, views)
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
		types.push({ frameRadius, centerY: center.y })

		// Resolve this type into its block of the atlas.
		const blockX = (type % catalog.columns) * blockWidth
		const blockY = Math.floor(type / catalog.columns) * blockHeight
		resolveMaterial.uniforms.uBlockOrigin.value.set(blockX, blockY)
		atlasTarget.viewport.set(blockX, blockY, blockWidth, blockHeight)
		renderer.setRenderTarget(atlasTarget)
		// Three regenerates the mipmaps after every render into a target. The
		// mip storage is allocated on the first setRenderTarget(), so only the
		// last block's render generates them, once for the whole atlas.
		const lastBlock = type === catalog.typeCount - 1
		for (const texture of atlasTarget.textures) texture.generateMipmaps = lastBlock
		renderer.render(resolveScene, camera)
	}

	renderer.setRenderTarget(previousTarget)
	renderer.setClearColor(previousClearColor, previousClearAlpha)
	renderer.autoClear = previousAutoClear
	atlasTarget.viewport.set(0, 0, width, height)

	resolveMaterial.uniforms.tAlbedo.value = null
	resolveMaterial.uniforms.tNormal.value = null
	resolveMaterial.uniforms.tPaint.value = null
	bakeMaterial.dispose()
	bakeTarget.dispose()

	return {
		target: atlasTarget,
		albedo: atlasTarget.textures[0],
		normal: atlasTarget.textures[1],
		paint: atlasTarget.textures[2],
		catalog,
		views,
		frameSize,
		types,
		dispose: () => atlasTarget.dispose(),
	}
}
