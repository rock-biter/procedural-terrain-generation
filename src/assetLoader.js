import { DataTexture, LoadingManager, Mesh, RepeatWrapping, SRGBColorSpace, Vector3 } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { initKTX2Loader, loadKTX2Texture } from './ktx2Textures'
import { loadTerrainNormalTextures } from './terrainNormals'
import woodGrainSrc from './textures/white_oak/white_oak_veneer_diff_1k.ktx2?url'

// Shown by the load-error state (src/intro.js) when the airplane, the one
// asset the app cannot run without, fails to load.
export const AIRPLANE_LOAD_ERROR = 'The airplane could not be loaded.'

// The boat model, from scripts/encode-assets.mjs.
const BOAT_MODEL_PATH = '/boat-toy/boat.glb'

// Requests every startup asset through one LoadingManager, whose callbacks
// drive the loading bar: `onStart()`, `onProgress(loaded, total)`, and
// `onLoad(assets, error)` once every request has settled. `error` is null
// unless the airplane failed. The other assets degrade instead: without the
// wood texture a white one keeps the impostors and near meshes matching,
// without a normal map its flat placeholder stays, without the simplified
// shadow caster the shadow pass draws the full airplane, and without the boat
// model a stand-in boat is baked.
//
// `renderer` must exist first: the KTX2 loader picks its GPU format from it.
// `airplaneModel` is the entry of AIRPLANE_MODELS (src/airplaneModels.js) to
// load, `features` is WORLD_FEATURES.
export function loadStartupAssets({
	renderer,
	uniforms,
	params,
	airplaneModel,
	features,
	onStart,
	onProgress,
	onLoad,
}) {
	const assets = {
		planeModel: null,
		// The model's bounding-box center before centering, and the simplified
		// shadow caster geometry (null if it failed to load).
		planeCenter: null,
		planeShadowGeometry: null,
		// The boat's glTF scene (null without scenery or if it failed to load).
		boatModel: null,
		woodTexture: null,
	}

	const manager = new LoadingManager()
	manager.onStart = onStart
	manager.onProgress = (_url, loaded, total) => onProgress(loaded, total)
	manager.onLoad = () => {
		// The shadow caster shares the model's geometry space, so it is placed
		// like the model once both have arrived.
		if (assets.planeShadowGeometry && assets.planeCenter) {
			placeAirplaneGeometry(assets.planeShadowGeometry, assets.planeCenter, airplaneModel)
		}
		onLoad(assets, assets.planeModel ? null : AIRPLANE_LOAD_ERROR)
	}

	const ktx2Loader = initKTX2Loader(renderer, manager)
	// The airplane and boat GLBs carry meshopt geometry (EXT_meshopt_compression)
	// and KTX2 textures (KHR_texture_basisu), both from scripts/encode-assets.mjs.
	const gltfLoader = new GLTFLoader(manager)
		.setMeshoptDecoder(MeshoptDecoder)
		.setKTX2Loader(ktx2Loader)

	if (features.scenery || features.clouds) {
		// White oak veneer color map (KTX2, sRGB), baked into every impostor's
		// albedo and sampled by the near scenery and cloud meshes. The white
		// placeholder stays if it fails: the detail then leaves colors unchanged.
		assets.woodTexture = createWhiteTexture()
		loadKTX2Texture(woodGrainSrc, (texture) => {
			texture.colorSpace = SRGBColorSpace
			texture.wrapS = RepeatWrapping
			texture.wrapT = RepeatWrapping
			assets.woodTexture = texture
		})
	}

	if (features.scenery) {
		// The boat's two near-mesh levels and color map (meshopt, KTX2), turned
		// into scenery sources by World.init() (src/impostors/boatSources.js).
		// Without it the stand-in boat of impostorArchetypes.js is baked.
		gltfLoader.load(
			BOAT_MODEL_PATH,
			(gltf) => {
				assets.boatModel = gltf.scene
			},
			undefined,
			(error) => console.warn(`Boat not loaded (${BOAT_MODEL_PATH})`, error),
		)
	}

	// `?plane=toy` loads the monoplane; the biplane is the default. The geometry
	// is centered and turned so the nose points to +Z, then the mesh is scaled to
	// the model's wingspan (src/airplaneModels.js).
	gltfLoader.load(
		airplaneModel.path,
		(gltf) => {
			gltf.scene.traverse((el) => {
				if (el instanceof Mesh) {
					el.geometry.computeBoundingBox()
					assets.planeCenter = el.geometry.boundingBox.getCenter(new Vector3())
					placeAirplaneGeometry(el.geometry, assets.planeCenter, airplaneModel)
					el.geometry.computeBoundingBox()
					const { min, max } = el.geometry.boundingBox
					el.scale.setScalar(airplaneModel.wingspan / (max.x - min.x))
					el.name = 'plane'
					assets.planeModel = el
				}
			})
		},
		undefined,
		(error) => console.error(`Airplane not loaded (${airplaneModel.path})`, error),
	)
	gltfLoader.load(
		airplaneModel.shadowPath,
		(gltf) => {
			gltf.scene.traverse((el) => {
				if (el instanceof Mesh) assets.planeShadowGeometry = el.geometry
			})
		},
		undefined,
		(error) =>
			console.warn(`Airplane shadow caster not loaded (${airplaneModel.shadowPath})`, error),
	)

	// Swaps the flat placeholders for the KTX2 maps as they arrive.
	loadTerrainNormalTextures(uniforms, params.terrainNormals)
}

// Centers an airplane geometry on the model's bounding-box `center` and turns
// its nose to +Z.
function placeAirplaneGeometry(geometry, center, airplaneModel) {
	geometry.translate(-center.x, -center.y, -center.z)
	if (airplaneModel.rotationY) geometry.rotateY(airplaneModel.rotationY)
}

// One white texel: the wood detail multiplies by white, which changes nothing.
function createWhiteTexture() {
	const texture = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
	texture.colorSpace = SRGBColorSpace
	texture.needsUpdate = true
	return texture
}
