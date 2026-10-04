import './style.css'
// Patches the fog shader chunk before any material compiles.
import './src/radialFog'
import { AIRPLANE_MODELS, getAirplaneModelKey } from './src/airplaneModels'
import { createAppParams } from './src/appParams'
import { loadStartupAssets } from './src/assetLoader'
import { isDebugEnabled } from './src/debugPolicy'
import Intro from './src/intro'
import RenderSetup from './src/renderSetup'
import { createSharedUniforms } from './src/sharedUniforms'
import Soundtrack from './src/soundtrack'
import World from './src/world'
import { WORLD_FEATURES } from './src/worldConstants'
import { createRandomSeed, parseWorldSeed } from './src/worldSeed'
import audioSrc from './src/audio/epic-soundtrack.mp3'

// The bootstrap: reads the URL flags, creates the shared params and uniforms,
// the renderer (src/renderSetup.js), the world (src/world.js), and the startup
// flow (src/intro.js), then requests the assets (src/assetLoader.js). Once
// they load, the intro builds the world and its frame loop starts.

const isMobile = window.innerWidth < 768
const urlParams = new URLSearchParams(window.location.search)
const debug = isDebugEnabled(urlParams)
const showGui = urlParams.get('gui') === '1'
// Debug-only modules load only behind their URL flags, so the default bundle
// carries neither lil-gui nor OrbitControls (used by the flight pause). They
// load before any asset request: an await between two requests could let the
// loading manager finish (and build the world) before the later ones register.
const FlightPauseDebug = debug ? (await import('./src/flightPauseDebug')).default : null
const debugGui = showGui ? await import('./src/debug/debugGui') : null

const params = createAppParams({ urlParams, isMobile })
const seed = parseWorldSeed(urlParams) ?? createRandomSeed()
const uniforms = createSharedUniforms(params, seed)
const setup = new RenderSetup({ params, urlParams, isMobile })

// Streamed when Play is pressed instead of being loaded with the startup
// assets, so it never delays the first frame. The ?gui=1 tuning mode never
// plays it, so it does not preload either.
const soundtrack = new Soundtrack(audioSrc, { volume: 0.1, preload: !showGui })
const intro = new Intro({
	canvas: setup.renderer.domElement,
	soundtrack,
	playMusic: !showGui,
	isMobile,
})

// `?plane=toy` loads the monoplane; the biplane is the default.
const airplaneModel = AIRPLANE_MODELS[getAirplaneModelKey(urlParams)]
const world = new World({
	setup,
	params,
	uniforms,
	seed,
	airplaneModel,
	features: WORLD_FEATURES,
	isMobile,
	terrainSamples: debug,
	FlightPauseDebug,
})
window.__INFINITE_WORLD__ = world.createStatsApi()
debugGui?.createDebugGui({ params, uniforms, setup, world })

loadStartupAssets({
	renderer: setup.renderer,
	uniforms,
	params,
	airplaneModel,
	features: WORLD_FEATURES,
	onStart: () => intro.showLoader(),
	onProgress: (loaded, total) => intro.setProgress(loaded, total),
	onLoad: (assets, error) => {
		if (error) {
			intro.showError(error)
			return
		}
		intro.start(world, () => {
			world.init(assets)
			world.precompileShaders()
		})
	},
})
