// Patches for shader source in onBeforeCompile. Each replaces an
// `#include <name>` line and throws when it is missing, so a three.js upgrade
// that renames or drops a chunk fails loudly instead of silently skipping the
// patch (test/shaderPatches.test.js applies every patch to the installed
// three.js shaders).

// `replacements` maps chunk names to their replacement source, applied in
// order to the first occurrence of each include.
export function replaceChunks(source, replacements) {
	let result = source
	for (const [name, replacement] of Object.entries(replacements)) {
		const include = `#include <${name}>`
		if (!result.includes(include)) throw new Error(`Shader chunk not found: ${include}`)
		// A function, so `$` sequences in the GLSL are not replacement patterns.
		result = result.replace(include, () => replacement)
	}
	return result
}
