import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'

// One KTX2 loader for the app: it owns the Basis transcoder workers. Its
// detectSupport() picks the GPU format from the renderer, so it is created
// once the renderer exists. Without a transcoder path it loads three's own
// basis_transcoder.js and .wasm, which Vite bundles as hashed assets, so they
// always match the installed three.
let loader = null

export function initKTX2Loader(renderer, manager) {
	loader = new KTX2Loader(manager).detectSupport(renderer)
	return loader
}

// Loads a KTX2 texture and keeps it in the loading manager until `onLoad` has
// run: KTX2Loader ends its own manager item when the download finishes,
// before the texture is transcoded.
export function loadKTX2Texture(url, onLoad) {
	if (!loader) throw new Error('initKTX2Loader() must run first')
	const { manager } = loader
	manager.itemStart(url)
	loader.load(
		url,
		(texture) => {
			onLoad(texture)
			manager.itemEnd(url)
		},
		undefined,
		(error) => {
			console.error(`Failed to load ${url}`, error)
			manager.itemError(url)
			manager.itemEnd(url)
		},
	)
}
