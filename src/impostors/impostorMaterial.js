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
import impostorVertex from '../shaders/impostor-vertex.glsl'
import impostorParsFragment from '../shaders/impostor-pars-fragment.glsl'
import impostorColorFragment from '../shaders/impostor-color-fragment.glsl'
import impostorNormalFragment from '../shaders/impostor-normal-fragment.glsl'
import { curvedLightsFragment } from '../curvedLights'
import {
	IMPOSTOR_ATLAS_COLUMNS,
	IMPOSTOR_ATLAS_ROWS,
	IMPOSTOR_INSTANCE_STRIDE,
	IMPOSTOR_TYPE_COUNT,
} from './impostorTypes'

// One shared material for every scenery chunk. It owns the atlas uniforms and
// must not be disposed by chunks.
// `variation` holds { amount, frequency } uniforms owned by the caller so the
// GUI can tune them live: `amount.value` is one float per type index.
export function createImpostorMaterial(
	atlas,
	uniforms,
	{ singleFrame = false, variation } = {},
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
		IMPOSTOR_FRAMES: atlas.frames,
		IMPOSTOR_ATLAS_COLUMNS,
		IMPOSTOR_ATLAS_ROWS,
		IMPOSTOR_TYPE_COUNT,
	}
	if (singleFrame) material.defines.IMPOSTOR_SINGLE_FRAME = ''

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

	material.onBeforeCompile = (shader) => {
		shader.uniforms = {
			...shader.uniforms,
			...uniforms,
			...impostorUniforms,
		}

		shader.vertexShader = shader.vertexShader
			.replace(
				'#include <common>',
				`${common}\n${impostorParsVertex}\n${impostorOctahedral}`,
			)
			.replace('#include <project_vertex>', impostorVertex)
		shader.fragmentShader = shader.fragmentShader
			.replace('#include <common>', `${common}\n${impostorParsFragment}`)
			.replace('#include <color_fragment>', impostorColorFragment)
			.replace('#include <normal_fragment_begin>', impostorNormalFragment)
			.replace('#include <lights_fragment_begin>', curvedLightsFragment)
	}

	return material
}

// Builds a chunk's scenery mesh. The geometry (a 4-vertex quad plus the
// instance buffer) is unique to the chunk and disposed with it.
export function createImpostorMesh(instances, material, boundingRadius) {
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
	return mesh
}
