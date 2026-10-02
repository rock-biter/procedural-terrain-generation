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
import sceneryShadowParsFragment from '../shaders/scenery-shadow-pars-fragment.glsl'
import { createShadowedLightsFragment } from '../curvedLights'
import {
	IMPOSTOR_ATLAS_COLUMNS,
	IMPOSTOR_ATLAS_ROWS,
	IMPOSTOR_INSTANCE_STRIDE,
	IMPOSTOR_TYPE_COUNT,
} from './impostorTypes'
import {
	makeSceneryWireframeMaterial,
	patchSceneryWireframeShader,
} from './sceneryWireframe'

// One shared material for every scenery chunk. It owns the atlas uniforms and
// must not be disposed by chunks. `uniforms` must include `uSceneryMeshRange`,
// which hands nearby instances over to the real meshes (sceneryMeshes.js).
// `variation` holds { amount, frequency } uniforms owned by the caller so the
// GUI can tune them live: `amount.value` is one float per type index.
// `uniforms` must also hold the scenery shadow uniforms
// (createSceneryShadowUniforms() in src/sceneryShadows.js); `shadowTaps` is
// the PCF sample count of the shadow lookup.
export function createImpostorMaterial(
	atlas,
	uniforms,
	{ singleFrame = false, variation, shadowTaps = 2 } = {},
) {
	const impostorUniforms = {
		uImpostorVariationAmount:
			variation?.amount ?? { value: new Array(IMPOSTOR_TYPE_COUNT).fill(0) },
		uImpostorVariationFrequency: variation?.frequency ?? { value: 1 },
		uImpostorAlbedo: { value: atlas.albedo },
		uImpostorNormal: { value: atlas.normal },
		uImpostorTypes: {
			value: atlas.types.map(
				({ frameRadius, centerY }) => new Vector2(frameRadius, centerY),
			),
		},
	}
	const material = buildImpostorMaterial(atlas.frames, uniforms, impostorUniforms, {
		singleFrame,
		shadowTaps,
	})
	material.userData.atlas = atlas
	return material
}

// Debug wireframe overlay of the impostor quads (sceneryWireframe.js), in
// sRGB hex `color`. It shares `material`'s atlas uniforms, so a re-bake
// reaches both, and never owns or disposes the atlas.
export function createImpostorWireframeMaterial(material, color) {
	const { uniforms, ...options } = material.userData.impostorOptions
	return makeSceneryWireframeMaterial(
		buildImpostorMaterial(
			material.defines.IMPOSTOR_FRAMES,
			uniforms,
			material.userData.impostorUniforms,
			options,
		),
		color,
	)
}

function buildImpostorMaterial(
	frames,
	uniforms,
	impostorUniforms,
	{ singleFrame, shadowTaps },
) {
	const material = new MeshStandardMaterial({
		roughness: 0.9,
		metalness: 0,
		// With MSAA, coverage turns the baked fractional alpha into smooth edges.
		alphaTest: 0.5,
		alphaToCoverage: true,
	})
	material.defines = {
		// Must match the grid the atlas was baked with.
		IMPOSTOR_FRAMES: frames,
		IMPOSTOR_ATLAS_COLUMNS,
		IMPOSTOR_ATLAS_ROWS,
		IMPOSTOR_TYPE_COUNT,
	}
	if (singleFrame) material.defines.IMPOSTOR_SINGLE_FRAME = ''

	// Lets a re-bake swap the atlas without recompiling the material.
	material.userData.impostorUniforms = impostorUniforms
	material.userData.impostorOptions = { uniforms, singleFrame, shadowTaps }

	material.onBeforeCompile = (shader) => {
		shader.uniforms = {
			...shader.uniforms,
			...uniforms,
			...impostorUniforms,
		}

		shader.vertexShader = shader.vertexShader
			.replace(
				'#include <common>',
				`${common}\n${sceneryInstanceParsVertex}\n${impostorParsVertex}\n${impostorOctahedral}`,
			)
			.replace('#include <project_vertex>', impostorVertex)
		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <common>',
				`${common}\n${sceneryDitherParsFragment}\n${impostorParsFragment}\n${sceneryShadowParsFragment}`,
			)
			.replace('#include <color_fragment>', impostorColorFragment)
			.replace('#include <normal_fragment_begin>', impostorNormalFragment)
			.replace(
				'#include <lights_fragment_begin>',
				createShadowedLightsFragment(
					`getSceneryShadow(impostorShadowPosition, vShadowSelfBias, ${shadowTaps}, ${shadowTaps})`,
				),
			)
		patchSceneryWireframeShader(shader, material)
	}

	return material
}

// Installs a newly baked atlas (same frame count) and disposes the old one.
export function setImpostorAtlas(material, atlas) {
	const uniforms = material.userData.impostorUniforms
	if (material.defines.IMPOSTOR_FRAMES !== atlas.frames) {
		throw new Error('A re-bake must keep the impostor frame count')
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
export function createImpostorMesh(
	instances,
	material,
	boundingRadius,
	wireframeMaterial = null,
) {
	const geometry = new InstancedBufferGeometry()
	geometry.setIndex([0, 1, 2, 0, 2, 3])
	geometry.setAttribute(
		'position',
		new BufferAttribute(
			new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]),
			3,
		),
	)
	geometry.setAttribute(
		'normal',
		new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), 3),
	)

	const buffer = new InstancedInterleavedBuffer(
		instances,
		IMPOSTOR_INSTANCE_STRIDE,
	)
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
