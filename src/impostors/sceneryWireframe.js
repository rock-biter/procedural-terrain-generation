import { Color } from 'three'
import sceneryWireframeFragment from '../shaders/scenery-wireframe-fragment.glsl'
import { replaceChunks } from '../shaderChunks'

// Debug overlay that outlines the scenery triangles in a flat color per level
// of detail: the near meshes (sceneryMeshes.js) and the impostor quads
// (impostorMaterial.js). Each overlay mesh shares its solid twin's geometry
// and shader patches, so it outlines exactly the triangles drawn, and keeps
// the twin's dither discard, so in a cross-fade each pixel shows only the
// level that covers it. Settings come from createSceneryWireframeSettings()
// (src/sceneryMeshPolicy.js).

// Turns a freshly created scenery material into its wireframe overlay, hidden
// until setSceneryWireframe() enables it. The define keeps its program apart
// from the solid twin, whose onBeforeCompile has the same source and so the
// same default program cache key. Overlay meshes need a renderOrder above the
// solid ones so they draw after them.
export function makeSceneryWireframeMaterial(material, color) {
	material.wireframe = true
	material.alphaTest = 0
	material.alphaToCoverage = false
	material.visible = false
	material.defines = { ...material.defines, SCENERY_WIREFRAME: '' }
	material.userData.wireframeColor = { value: new Color(color) }
	return material
}

// Called at the end of the material's onBeforeCompile; a no-op on solid
// materials.
export function patchSceneryWireframeShader(shader, material) {
	const color = material.userData.wireframeColor
	if (!color) return
	shader.uniforms.uSceneryWireframeColor = color
	shader.fragmentShader = replaceChunks(
		`uniform vec3 uSceneryWireframeColor;\n${shader.fragmentShader}`,
		{ opaque_fragment: `#include <opaque_fragment>\n${sceneryWireframeFragment}` },
	)
}

// Hidden materials are skipped by the renderer, so a disabled overlay draws
// nothing. `color` is sRGB hex.
export function setSceneryWireframe(material, enabled, color) {
	material.visible = enabled
	material.userData.wireframeColor.value.setHex(color)
}
