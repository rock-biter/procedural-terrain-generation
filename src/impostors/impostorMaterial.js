import {
	BufferAttribute,
	InstancedBufferGeometry,
	InstancedInterleavedBuffer,
	InterleavedBufferAttribute,
	Mesh,
	MeshStandardMaterial,
	Sphere,
	Vector2,
	Vector3,
} from 'three'
import common from '../shaders/common.glsl'
import impostorOctahedral from '../shaders/impostor-octahedral.glsl'
import impostorParsVertex from '../shaders/impostor-pars-vertex.glsl'
import sceneryInstanceParsVertex from '../shaders/scenery-instance-pars-vertex.glsl'
import sceneryDitherParsFragment from '../shaders/scenery-dither-pars-fragment.glsl'
import impostorVertex from '../shaders/impostor-vertex.glsl'
import impostorParsFragment from '../shaders/impostor-pars-fragment.glsl'
import impostorColorFragment from '../shaders/impostor-color-fragment.glsl'
import impostorNormalFragment from '../shaders/impostor-normal-fragment.glsl'
import { createSceneryLighting } from '../curvedLights'
import { replaceChunks } from '../shaderChunks'
import { getCatalogDefines } from './impostorCatalogs'
import { getViewDefines, isSameViews } from './octahedral'
import { IMPOSTOR_INSTANCE_STRIDE } from './impostorTypes'
import { makeSceneryWireframeMaterial, patchSceneryWireframeShader } from './sceneryWireframe'

// Far fade of the scenery impostors: they shrink into the fog between these
// eye distances, before the scenery LOD limit removes their chunk.
export const SCENERY_IMPOSTOR_FAR_FADE = Object.freeze([800, 950])

// One shared material for every instance of the atlas's catalog
// (impostorCatalogs.js), e.g. every scenery chunk. It owns the atlas uniforms
// and must not be disposed by chunks. `uniforms` must include
// `uSceneryMeshRange`, which hands nearby instances over to the real meshes
// (sceneryMeshes.js). `variation` holds { amount, frequency } uniforms owned
// by the caller so the GUI can tune them live: `amount.value` is one float per
// type index. `farFade` is a Vector2 uniform (start, end) of the shrink into
// the fog.
//
// With `receiveShadows` (scenery), `uniforms` must also hold the scenery and
// cloud shadow uniforms (src/sceneryShadows.js, src/cloudShadows.js);
// `shadowTaps` is the PCF sample count of the scenery shadow lookup. Without
// it (clouds), lighting has no shadow and `ambientScale` (a float uniform)
// scales the ambient light.
export function createImpostorMaterial(
	atlas,
	uniforms,
	{
		singleFrame = false,
		variation,
		shadowTaps = 2,
		receiveShadows = true,
		farFade = null,
		ambientScale = null,
	} = {},
) {
	const impostorUniforms = {
		uImpostorVariationAmount: variation?.amount ?? {
			value: new Array(atlas.catalog.typeCount).fill(0),
		},
		uImpostorVariationFrequency: variation?.frequency ?? { value: 1 },
		uImpostorFarFade: farFade ?? { value: new Vector2(...SCENERY_IMPOSTOR_FAR_FADE) },
		uImpostorAlbedo: { value: atlas.albedo },
		uImpostorNormal: { value: atlas.normal },
		uImpostorTypes: {
			value: atlas.types.map(({ frameRadius, centerY }) => new Vector2(frameRadius, centerY)),
		},
	}
	if (ambientScale) impostorUniforms.uSceneryAmbientScale = ambientScale
	const material = buildImpostorMaterial(atlas, uniforms, impostorUniforms, {
		singleFrame,
		shadowTaps,
		receiveShadows,
	})
	return material
}

// Debug wireframe overlay of the impostor quads (sceneryWireframe.js), in
// sRGB hex `color`. It shares `material`'s atlas uniforms, so a re-bake
// reaches both, and never owns or disposes the atlas.
export function createImpostorWireframeMaterial(material, color) {
	const { uniforms, ...options } = material.userData.impostorOptions
	return makeSceneryWireframeMaterial(
		buildImpostorMaterial(
			material.userData.atlas,
			uniforms,
			material.userData.impostorUniforms,
			options,
		),
		color,
	)
}

function buildImpostorMaterial(
	atlas,
	uniforms,
	impostorUniforms,
	{ singleFrame, shadowTaps, receiveShadows },
) {
	const material = new MeshStandardMaterial({
		roughness: 0.9,
		metalness: 0,
		// With MSAA, coverage turns the baked fractional alpha into smooth edges.
		alphaTest: 0.5,
		alphaToCoverage: true,
	})
	material.defines = {
		// Must match the view grid and layout the atlas was baked with.
		...getViewDefines(atlas.views),
		...getCatalogDefines(atlas.catalog),
	}
	if (singleFrame) material.defines.IMPOSTOR_SINGLE_FRAME = ''
	// Its defines keep the unshadowed program apart from the shadowed one.
	const lighting = createSceneryLighting(
		receiveShadows
			? {
					shadows: {
						taps: [shadowTaps, shadowTaps],
						position: 'impostorShadowPosition',
						selfBias: 'vShadowSelfBias',
					},
				}
			: { ambientScale: impostorUniforms.uSceneryAmbientScale },
	)
	Object.assign(material.defines, lighting.defines)

	// Lets a re-bake swap the atlas without recompiling the material.
	material.userData.atlas = atlas
	material.userData.impostorUniforms = impostorUniforms
	material.userData.impostorOptions = {
		uniforms,
		singleFrame,
		shadowTaps,
		receiveShadows,
	}

	material.onBeforeCompile = (shader) => {
		shader.uniforms = {
			...shader.uniforms,
			...uniforms,
			...impostorUniforms,
		}

		shader.vertexShader = replaceChunks(shader.vertexShader, {
			common: `${common}\n${sceneryInstanceParsVertex}\n${impostorParsVertex}\n${impostorOctahedral}`,
			project_vertex: impostorVertex,
		})
		shader.fragmentShader = replaceChunks(shader.fragmentShader, {
			common: `${common}\n${sceneryDitherParsFragment}\n${impostorParsFragment}\n${lighting.parsFragment}`,
			color_fragment: impostorColorFragment,
			normal_fragment_begin: impostorNormalFragment,
			lights_fragment_begin: lighting.lightsFragment,
		})
		patchSceneryWireframeShader(shader, material)
	}

	return material
}

// Installs a newly baked atlas (same catalog and view layout) and disposes the
// old one.
export function setImpostorAtlas(material, atlas) {
	const uniforms = material.userData.impostorUniforms
	const previous = material.userData.atlas
	if (previous.catalog !== atlas.catalog || !isSameViews(previous.views, atlas.views)) {
		throw new Error('A re-bake must keep the impostor catalog and view layout')
	}
	uniforms.uImpostorAlbedo.value = atlas.albedo
	uniforms.uImpostorNormal.value = atlas.normal
	atlas.types.forEach(({ frameRadius, centerY }, type) =>
		uniforms.uImpostorTypes.value[type].set(frameRadius, centerY),
	)
	material.userData.atlas.dispose()
	material.userData.atlas = atlas
}

// Builds a chunk's scenery mesh. The geometry (a 4-vertex quad plus the
// instance buffer) is unique to the chunk and disposed with it. With a
// `wireframeMaterial` (createImpostorWireframeMaterial()), a child mesh draws
// the same quads as the debug overlay.
export function createImpostorMesh(instances, material, boundingRadius, wireframeMaterial = null) {
	const geometry = new InstancedBufferGeometry()
	geometry.setIndex([0, 1, 2, 0, 2, 3])
	geometry.setAttribute(
		'position',
		new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3),
	)
	geometry.setAttribute(
		'normal',
		new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), 3),
	)

	const buffer = new InstancedInterleavedBuffer(instances, IMPOSTOR_INSTANCE_STRIDE)
	geometry.setAttribute('aInstanceA', new InterleavedBufferAttribute(buffer, 4, 0))
	geometry.setAttribute('aInstanceB', new InterleavedBufferAttribute(buffer, 4, 4))
	geometry.instanceCount = instances.length / IMPOSTOR_INSTANCE_STRIDE
	// Positions are generated in the shader, so bounds come from the chunk.
	geometry.boundingSphere = new Sphere(new Vector3(), boundingRadius)

	const mesh = new Mesh(geometry, material)
	mesh.name = 'scenery'
	if (wireframeMaterial) {
		const wireframe = new Mesh(geometry, wireframeMaterial)
		wireframe.name = 'scenery-wireframe'
		wireframe.renderOrder = 1
		mesh.add(wireframe)
	}
	return mesh
}
