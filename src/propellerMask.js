// Pure propeller selection for the airplane mesh (src/plane.js). The toy
// airplane's propeller is fused into its single mesh, and near the blade roots
// the blades and the cowl overlap in position, so no coordinate threshold
// separates them. Its UV charts do: every triangle belongs to one
// index-connected component (a chart), and the blade and spinner charts are
// the only ones that reach in front of the cowl.

// Returns one byte per vertex: 1 for vertices of every index-connected
// component whose maximum Z exceeds `minZ`, 0 elsewhere. `zValues` holds each
// vertex's Z and `index` is a flat triangle index array.
export function getPropellerMask(zValues, index, minZ) {
	const vertexCount = zValues.length
	const parent = new Int32Array(vertexCount)
	for (let i = 0; i < vertexCount; i++) parent[i] = i
	const find = (vertex) => {
		while (parent[vertex] !== vertex) {
			parent[vertex] = parent[parent[vertex]]
			vertex = parent[vertex]
		}
		return vertex
	}
	for (let i = 0; i < index.length; i += 3) {
		const a = find(index[i])
		const b = find(index[i + 1])
		const c = find(index[i + 2])
		parent[a] = c
		parent[b] = c
	}

	const reachesFront = new Uint8Array(vertexCount)
	for (let i = 0; i < vertexCount; i++) {
		if (zValues[i] > minZ) reachesFront[find(i)] = 1
	}
	const mask = new Uint8Array(vertexCount)
	for (let i = 0; i < vertexCount; i++) mask[i] = reachesFront[find(i)]
	return mask
}
