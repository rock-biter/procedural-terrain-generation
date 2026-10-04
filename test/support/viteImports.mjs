// Node module hooks that let tests import source modules written for Vite:
// - relative imports without an extension resolve to the `.js` file;
// - `.glsl` files load as their source string (vite-plugin-glsl's default
//   export), with its file includes (`#include ./other.glsl`) resolved;
// - `?url` imports load as the file's path.
import { readFile } from 'node:fs/promises'

export async function resolve(specifier, context, nextResolve) {
	if (specifier.endsWith('?url')) {
		const resolved = await nextResolve(specifier.slice(0, -'?url'.length), context)
		return { ...resolved, url: `${resolved.url}?url`, shortCircuit: true }
	}
	const isRelative = specifier.startsWith('./') || specifier.startsWith('../')
	if (isRelative && !/\.[a-z0-9]+$/i.test(specifier)) {
		return nextResolve(`${specifier}.js`, context)
	}
	return nextResolve(specifier, context)
}

// vite-plugin-glsl's file include; three's `#include <chunk>` stays as is.
const FILE_INCLUDE = /^[ \t]*#include\s+([^\s<>;]+);?[ \t]*$/gm

async function readGlsl(url) {
	const source = await readFile(url, 'utf8')
	const parts = []
	let last = 0
	for (const match of source.matchAll(FILE_INCLUDE)) {
		parts.push(source.slice(last, match.index), await readGlsl(new URL(match[1], url)))
		last = match.index + match[0].length
	}
	parts.push(source.slice(last))
	return parts.join('')
}

export async function load(url, context, nextLoad) {
	if (url.endsWith('?url')) {
		const path = new URL(url).pathname
		return {
			format: 'module',
			source: `export default ${JSON.stringify(path)}`,
			shortCircuit: true,
		}
	}
	if (url.endsWith('.glsl')) {
		const source = await readGlsl(new URL(url))
		return {
			format: 'module',
			source: `export default ${JSON.stringify(source)}`,
			shortCircuit: true,
		}
	}
	return nextLoad(url, context)
}
