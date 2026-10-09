import {
	AdditiveBlending,
	BufferAttribute,
	BufferGeometry,
	Color,
	DataTexture,
	DoubleSide,
	LinearFilter,
	Mesh,
	RedFormat,
	ShaderMaterial,
	UnsignedByteType,
	Vector3,
	Vector4,
} from 'three'
import {
	clearAuroraEvent,
	createAuroraState,
	createDiscRegion,
	findIceRegion,
	getAuroraLayout,
	getAuroraWindow,
	refreshAuroraRegion,
	resetAuroraState,
	startAuroraEvent,
	stepAurora,
} from './auroraPolicy'
import auroraVertex from './shaders/aurora.vert.glsl'
import auroraFragment from './shaders/aurora.frag.glsl'

// Before the transparent airplane trails (render order 0), which stay on top.
const AURORA_RENDER_ORDER = -1

// A grid per ribbon slot: `columns` segments along it, `rows` up the curtain.
// Positions hold the column, the height share, and the slot
// (aurora.vert.glsl).
function createAuroraGeometry({ ribbons, columns, rows }) {
	const columnVertices = rows + 1
	const ribbonVertices = (columns + 1) * columnVertices
	const positions = new Float32Array(ribbons * ribbonVertices * 3)
	let offset = 0
	for (let ribbon = 0; ribbon < ribbons; ribbon++) {
		for (let column = 0; column <= columns; column++) {
			for (let row = 0; row <= rows; row++) {
				positions[offset++] = column
				positions[offset++] = row / rows
				positions[offset++] = ribbon
			}
		}
	}
	const vertexCount = ribbons * ribbonVertices
	const IndexArray = vertexCount > 65535 ? Uint32Array : Uint16Array
	const indices = new IndexArray(ribbons * columns * rows * 6)
	offset = 0
	for (let ribbon = 0; ribbon < ribbons; ribbon++) {
		for (let column = 0; column < columns; column++) {
			for (let row = 0; row < rows; row++) {
				const a = ribbon * ribbonVertices + column * columnVertices + row
				const b = a + columnVertices
				indices[offset++] = a
				indices[offset++] = b
				indices[offset++] = a + 1
				indices[offset++] = b
				indices[offset++] = b + 1
				indices[offset++] = a + 1
			}
		}
	}
	const geometry = new BufferGeometry()
	geometry.setAttribute('position', new BufferAttribute(positions, 3))
	geometry.setIndex(new BufferAttribute(indices, 1))
	return geometry
}

function createMaskTexture(columns, rows) {
	const texture = new DataTexture(
		new Uint8Array(columns * rows),
		columns,
		rows,
		RedFormat,
		UnsignedByteType,
	)
	texture.minFilter = LinearFilter
	texture.magFilter = LinearFilter
	texture.needsUpdate = true
	return texture
}

// The aurora over the ice biome: one event at a time (src/auroraPolicy.js
// rolls, places, and times it), drawn as a single mesh of curtains in a
// window around the airplane, masked to the event's ice region. Unlit and
// fog-free like the sky, added onto the scene behind it with the depth test
// on, so terrain, scenery, and clouds hide it.
//
// Ownership: this mesh owns its geometry, material, region mask texture, and
// its uniforms; `uniforms` is the shared object (src/sharedUniforms.js),
// whose uCamera and uCurvature bend the curtains with the world.
// `settings` is params.aurora, `sampleIce(x, z)` the ice field
// (getIceValue() with the live biome offset), and `random()` (0 to 1) the
// randomness of the rolls and events, never the world seed.
export default class Aurora extends Mesh {
	state = createAuroraState()
	placement = { along: 0, ribbon: 0 }
	layout = null

	constructor({ uniforms, settings, sampleIce, random = Math.random }) {
		const maskTexture = createMaskTexture(1, 1)
		const auroraUniforms = {
			...uniforms,
			uAuroraFrame: { value: new Vector4(0, 0, 1, 0) },
			uAuroraWindow: { value: new Vector4() },
			uAuroraMask: { value: maskTexture },
			uAuroraMaskBounds: { value: new Vector4() },
			uAuroraSeed: { value: 0 },
			uAuroraTime: { value: 0 },
			uAuroraShape: { value: new Vector4() },
			uAuroraFade: { value: new Vector4() },
			uAuroraMeander: { value: new Vector3() },
			uAuroraFold: { value: new Vector3() },
			uAuroraSway: { value: new Vector3() },
			uAuroraPresence: { value: new Vector4() },
			uAuroraColors: { value: [new Color(), new Color(), new Color()] },
			uAuroraProfile: { value: new Vector4() },
			uAuroraRays: { value: new Vector4() },
			uAuroraPulse: { value: new Vector3() },
			uAuroraIntensity: { value: 1 },
			uAuroraVisibility: { value: 0 },
			uHorizonDipAngle: { value: 0 },
		}
		super(
			new BufferGeometry(),
			new ShaderMaterial({
				uniforms: auroraUniforms,
				vertexShader: auroraVertex,
				fragmentShader: auroraFragment,
				transparent: true,
				blending: AdditiveBlending,
				depthWrite: false,
				side: DoubleSide,
				fog: false,
			}),
		)
		this.name = 'aurora'
		this.uniforms = auroraUniforms
		this.maskTexture = maskTexture
		this.settings = settings
		this.sampleIce = sampleIce
		this.random = random
		this.revision = this.state.revision
		this.renderOrder = AURORA_RENDER_ORDER
		// The vertex shader places every vertex.
		this.frustumCulled = false
		// Visible until the first update(), so World.precompileShaders(), which
		// runs before it and compiles visible objects only, compiles it too.
		this.visible = true
		this.applySettings()
	}

	// Re-reads the live settings: uniforms, and the geometry when its counts
	// change.
	applySettings() {
		const { settings, uniforms } = this
		const layout = getAuroraLayout(settings)
		const previous = this.layout
		if (
			!previous ||
			layout.ribbons !== previous.ribbons ||
			layout.columns !== previous.columns ||
			layout.rows !== previous.rows
		) {
			this.geometry.dispose()
			this.geometry = createAuroraGeometry(layout)
		}
		this.layout = layout

		const { area, meander, fold, sway, presence, look, rays, pulse, colors } = settings
		uniforms.uAuroraShape.value.set(area.altitude, area.height, area.heightVariation, area.jitter)
		uniforms.uAuroraFade.value.set(
			area.radius * area.fadeStart,
			area.radius,
			look.horizonFade,
			look.edgeFade,
		)
		uniforms.uAuroraMeander.value.set(meander.amplitude, 1 / meander.wavelength, meander.speed)
		uniforms.uAuroraFold.value.set(fold.amplitude, 1 / fold.wavelength, fold.speed)
		uniforms.uAuroraSway.value.set(sway.amplitude, 1 / sway.wavelength, sway.speed)
		uniforms.uAuroraPresence.value.set(
			1 / presence.wavelength,
			presence.threshold,
			presence.softness,
			presence.speed,
		)
		const [bottom, middle, top] = uniforms.uAuroraColors.value
		bottom.set(colors.bottom)
		middle.set(colors.middle)
		top.set(colors.top)
		uniforms.uAuroraProfile.value.set(
			Math.min(Math.max(look.middleStop, 0.01), 0.99),
			look.bottomSoftness,
			look.topSoftness,
			look.falloff,
		)
		uniforms.uAuroraRays.value.set(1 / rays.wavelength, rays.speed, rays.sharpness, rays.strength)
		uniforms.uAuroraPulse.value.set(1 / pulse.wavelength, pulse.speed, pulse.strength)
		uniforms.uAuroraIntensity.value = look.intensity
	}

	// Advances the event with the airplane at `position` and the day/night
	// state (DayNight.update()), then places the window around the airplane.
	update(deltaSeconds, position, dayNightState) {
		const { state, uniforms, layout } = this
		const { x, z } = position
		stepAurora(
			state,
			{
				dt: deltaSeconds,
				paletteTime: dayNightState.paletteTime,
				x,
				z,
				ice: this.sampleIce(x, z),
				sampleIce: this.sampleIce,
			},
			this.settings,
			this.random,
		)
		if (state.revision !== this.revision) this.applyEvent()

		const { event } = state
		this.visible = event !== null && state.visibility > 0
		if (!this.visible) return
		getAuroraWindow(event, x, z, layout, this.placement)
		uniforms.uAuroraWindow.value.set(
			this.placement.along,
			this.placement.ribbon,
			layout.step,
			layout.spacing,
		)
		uniforms.uAuroraTime.value = event.time
		uniforms.uAuroraVisibility.value = state.visibility
		uniforms.uHorizonDipAngle.value = dayNightState.horizonDip
	}

	// Uploads the event's region and frame after it changes.
	applyEvent() {
		this.revision = this.state.revision
		const { event } = this.state
		if (!event) return
		const { region } = event
		const { uniforms } = this
		const { image } = this.maskTexture
		if (image.width !== region.columns || image.height !== region.rows) {
			this.maskTexture.dispose()
			this.maskTexture = createMaskTexture(region.columns, region.rows)
			uniforms.uAuroraMask.value = this.maskTexture
		}
		this.maskTexture.image.data.set(region.mask)
		this.maskTexture.needsUpdate = true
		uniforms.uAuroraMaskBounds.value.set(
			region.minX,
			region.minZ,
			1 / (region.columns * region.cellSize),
			1 / (region.rows * region.cellSize),
		)
		uniforms.uAuroraFrame.value.set(
			region.center[0],
			region.center[1],
			region.axis[0],
			region.axis[1],
		)
		uniforms.uAuroraSeed.value = event.seed
	}

	// Debug: replaces the aurora with a new one over (x, z), whatever the
	// chance. Away from the ice it covers a disc twice the window radius.
	// `instant` skips the fade-in.
	spawnAt(x, z, { instant = false } = {}) {
		const { settings } = this
		let region = findIceRegion(x, z, this.sampleIce, settings.region)
		const synthetic = region === null
		if (synthetic) {
			const angle = this.random() * Math.PI
			region = createDiscRegion(x, z, settings.area.radius * 2, angle, settings.region)
		}
		const age = instant ? settings.fadeIn : 0
		startAuroraEvent(this.state, region, [x, z], this.random, { age, synthetic })
	}

	// Debug: plays the current aurora's fade-in again.
	replayFadeIn() {
		if (this.state.event) this.state.event.age = 0
	}

	clear() {
		clearAuroraEvent(this.state)
	}

	// After a seed change: no aurora, and the airplane's ice presence is read
	// again (a roll if it is in the ice).
	reset() {
		resetAuroraState(this.state)
	}

	// After a biome distribution change: the event's region follows the ice.
	refreshRegion() {
		refreshAuroraRegion(this.state, this.sampleIce, this.settings)
	}

	getStats() {
		const { state, layout } = this
		const { event } = state
		let status = 'none'
		if (event) status = state.visibility > 0 ? 'visible' : 'waiting'
		return {
			state: status,
			inIce: state.inIce,
			chance: this.settings.chance,
			rolls: state.rolls,
			successes: state.successes,
			nightVisibility: state.nightVisibility,
			visibility: state.visibility,
			region: event
				? {
						cells: event.region.cellCount,
						capped: event.region.capped,
						synthetic: event.synthetic,
						center: [...event.region.center],
						axis: [...event.region.axis],
					}
				: null,
			ribbons: layout.ribbons,
			columns: layout.columns,
			rows: layout.rows,
			vertices: this.geometry.getAttribute('position').count,
		}
	}

	dispose() {
		this.removeFromParent()
		this.geometry.dispose()
		this.material.dispose()
		this.maskTexture.dispose()
	}
}
