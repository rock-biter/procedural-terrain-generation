import { createTerrainSnapshot } from '../chunkGeometry'
import {
	BIOME_MAP_COLORS,
	BIOME_MAP_LABELS,
	BIOME_MAP_SPAN,
	getLandShares,
	getScaleLength,
	hasFollowMoved,
	panView,
	worldToMap,
	zoomView,
} from './biomeMapPolicy'

// The ?gui=1 biome map: a square in the top-left corner showing the biomes
// and the sea around the airplane in flat colors (src/debug/biomeMapPolicy.js),
// to tune the Biomes > Distribution settings. The wheel zooms about the
// pointer, a drag pans (and stops following the airplane), and a double click
// follows the airplane again. While the pointer is over the map, the flight
// input holds a neutral course and no event reaches it. A worker rasterizes
// the map; until a raster arrives, the previous one is drawn moved and scaled
// into the current view, so zoom and pan respond at once.
//
// createDebugGui() owns the map and calls invalidate() whenever a setting the
// map depends on changes (terrain, biomes, frozen sea, seed). It may run
// before World.init(): the map then centers on the origin.

// Raster sizes in pixels (each 2 × 2 samples): a coarse one while the view
// moves, a fine one at rest. The fine desktop raster takes about 100 ms in
// the worker.
const RASTER = Object.freeze({
	desktop: { fine: 160, coarse: 80 },
	mobile: { fine: 100, coarse: 50 },
})
// Rest after the last change before the fine raster is requested.
const SETTLE_MS = 150
const WHEEL_ZOOM = 0.0015

export default class BiomeMap {
	settings = { visible: true, follow: true }

	constructor({ params, world, isMobile = window.innerWidth < 768 }) {
		this.params = params
		this.world = world
		this.cssSize = isMobile ? 160 : 220
		this.raster = isMobile ? RASTER.mobile : RASTER.desktop
		this.view = { centerX: 0, centerZ: 0, span: BIOME_MAP_SPAN.initial }
		// Bumped by every change the map must render; a response renders
		// `requestedVersion`.
		this.version = 0
		this.requestedVersion = -1
		this.requestedFine = false
		this.inFlight = false
		this.changedAt = 0
		this.rendered = null
		this.dragging = null
		this.heldInput = null

		this.createDom()
		this.worker = new Worker(new URL('./biomeMap.worker.js', import.meta.url), { type: 'module' })
		this.worker.addEventListener('message', ({ data }) => this.onRaster(data))
		this.addListeners()
		this.applyVisibility()
		this.frame = this.frame.bind(this)
		requestAnimationFrame(this.frame)
	}

	createDom() {
		const root = document.createElement('div')
		Object.assign(root.style, {
			position: 'fixed',
			top: '8px',
			left: '8px',
			// Just under lil-gui (1001), which it overlaps on narrow screens.
			zIndex: '1000',
			padding: '6px',
			borderRadius: '6px',
			background: 'rgba(17, 17, 17, 0.8)',
			color: '#ebebeb',
			font: '11px/1.35 system-ui, sans-serif',
			userSelect: 'none',
			touchAction: 'none',
			width: `${this.cssSize}px`,
		})
		const canvas = document.createElement('canvas')
		const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
		canvas.width = canvas.height = Math.round(this.cssSize * pixelRatio)
		Object.assign(canvas.style, {
			display: 'block',
			width: `${this.cssSize}px`,
			height: `${this.cssSize}px`,
			cursor: 'grab',
			borderRadius: '3px',
		})
		const legend = document.createElement('div')
		legend.style.marginTop = '4px'
		legend.append(
			...BIOME_MAP_LABELS.map((label, index) => {
				const item = document.createElement('span')
				item.style.marginRight = '7px'
				item.style.whiteSpace = 'nowrap'
				const swatch = document.createElement('span')
				Object.assign(swatch.style, {
					display: 'inline-block',
					width: '8px',
					height: '8px',
					marginRight: '3px',
					borderRadius: '2px',
					background: `rgb(${BIOME_MAP_COLORS[index].join(',')})`,
				})
				item.append(swatch, label)
				return item
			}),
		)
		const shares = document.createElement('div')
		shares.style.opacity = '0.85'
		const hint = document.createElement('div')
		hint.style.opacity = '0.6'
		hint.textContent = 'Wheel: zoom · drag: pan · double click: follow'
		root.append(canvas, legend, shares, hint)
		document.body.append(root)

		this.root = root
		this.canvas = canvas
		this.context = canvas.getContext('2d')
		this.shares = shares
		this.rasterCanvas = document.createElement('canvas')
	}

	addListeners() {
		const { root, canvas } = this
		// FlightInput listens on window: nothing over the map reaches it.
		for (const type of ['mousemove', 'touchstart', 'touchmove', 'pointerdown', 'click']) {
			root.addEventListener(type, (event) => event.stopPropagation())
		}
		root.addEventListener(
			'wheel',
			(event) => {
				event.preventDefault()
				event.stopPropagation()
				// Following keeps the airplane in the middle, so it zooms about it.
				const [u, v] = this.settings.follow ? [0.5, 0.5] : this.getMapPoint(event)
				this.view = zoomView(this.view, u, v, Math.exp(event.deltaY * WHEEL_ZOOM))
				this.invalidate()
			},
			{ passive: false },
		)
		canvas.addEventListener('pointerdown', (event) => {
			canvas.setPointerCapture(event.pointerId)
			canvas.style.cursor = 'grabbing'
			this.dragging = { x: event.clientX, y: event.clientY }
		})
		canvas.addEventListener('pointermove', (event) => {
			if (!this.dragging) return
			const du = (event.clientX - this.dragging.x) / this.cssSize
			const dv = (event.clientY - this.dragging.y) / this.cssSize
			if (du === 0 && dv === 0) return
			this.dragging = { x: event.clientX, y: event.clientY }
			this.settings.follow = false
			this.view = panView(this.view, du, dv)
			this.invalidate()
		})
		const endDrag = () => {
			this.dragging = null
			canvas.style.cursor = 'grab'
		}
		canvas.addEventListener('pointerup', endDrag)
		canvas.addEventListener('pointercancel', endDrag)
		canvas.addEventListener('dblclick', () => {
			this.settings.follow = true
			this.invalidate()
		})
		root.addEventListener('pointerenter', () => this.holdFlightInput())
		root.addEventListener('pointerleave', () => this.releaseFlightInput())
	}

	// Neutral flight while the pointer is over the map: its last position would
	// otherwise keep steering toward the corner.
	holdFlightInput() {
		const plane = this.world.plane
		if (!plane || this.heldInput) return
		this.heldInput = { plane, enabled: plane.input.enabled }
		plane.setInputEnabled(false)
		plane.input.center()
	}

	releaseFlightInput() {
		if (!this.heldInput) return
		this.heldInput.plane.setInputEnabled(this.heldInput.enabled)
		this.heldInput = null
	}

	getMapPoint(event) {
		const bounds = this.canvas.getBoundingClientRect()
		return [
			(event.clientX - bounds.left) / bounds.width,
			(event.clientY - bounds.top) / bounds.height,
		]
	}

	// Renders the map again: after a settings change or a view change.
	invalidate() {
		this.version++
		this.changedAt = performance.now()
	}

	resetView() {
		this.view = { centerX: 0, centerZ: 0, span: BIOME_MAP_SPAN.initial }
		this.settings.follow = true
		this.invalidate()
	}

	applyVisibility() {
		this.root.style.display = this.settings.visible ? '' : 'none'
		if (!this.settings.visible) this.releaseFlightInput()
		else this.invalidate()
	}

	frame() {
		requestAnimationFrame(this.frame)
		if (!this.settings.visible) return
		const plane = this.world.plane
		if (this.settings.follow && plane) {
			const { x, z } = plane.position
			// The drawn view tracks the airplane every frame; a new raster only
			// once it has moved a few percent of the span.
			const basis = this.rendered?.view ?? this.view
			this.view = { ...this.view, centerX: x, centerZ: z }
			if (hasFollowMoved(basis, x, z) && this.requestedVersion === this.version) this.version++
		}
		this.requestRaster()
		this.draw(plane)
	}

	requestRaster() {
		if (this.inFlight) return
		const settled = performance.now() - this.changedAt > SETTLE_MS
		const stale = this.requestedVersion !== this.version
		if (!stale && (this.requestedFine || !settled)) return
		const size = settled ? this.raster.fine : this.raster.coarse
		this.inFlight = true
		this.requestedVersion = this.version
		this.requestedFine = settled
		this.worker.postMessage({
			id: this.version,
			view: { ...this.view },
			size,
			seed: this.world.seed,
			params: createTerrainSnapshot(this.params),
			seaIce: { ...this.params.seaIce },
		})
	}

	onRaster({ view, size, pixels, counts }) {
		this.inFlight = false
		const raster = this.rasterCanvas
		raster.width = raster.height = size
		raster.getContext('2d').putImageData(new ImageData(pixels, size, size), 0, 0)
		this.rendered = { view }
		const shares = getLandShares(counts)
		const percent = (share) => `${Math.round(share * 100)}%`
		this.shares.textContent = shares
			? `Land: desert ${percent(shares.desert)} · forest ${percent(shares.forest)} · ice ${percent(shares.ice)}`
			: 'Land: none in view'
	}

	draw(plane) {
		const { context, canvas, view } = this
		const size = canvas.width
		context.fillStyle = `rgb(${BIOME_MAP_COLORS[0].join(',')})`
		context.fillRect(0, 0, size, size)
		if (this.rendered) {
			// The last raster, placed where its view falls in the current one.
			const rendered = this.rendered.view
			const [u, v] = worldToMap(
				view,
				rendered.centerX - rendered.span / 2,
				rendered.centerZ - rendered.span / 2,
			)
			const scale = rendered.span / view.span
			context.imageSmoothingEnabled = false
			context.drawImage(this.rasterCanvas, u * size, v * size, scale * size, scale * size)
		}

		// Scale bar: a round length of at most a third of the map.
		const pixelRatio = size / this.cssSize
		const length = getScaleLength(view.span / 3)
		const barWidth = (length / view.span) * size
		const x = 8 * pixelRatio
		const y = size - 8 * pixelRatio
		context.strokeStyle = '#111'
		context.lineWidth = 3 * pixelRatio
		context.beginPath()
		context.moveTo(x, y)
		context.lineTo(x + barWidth, y)
		context.stroke()
		context.strokeStyle = '#fff'
		context.lineWidth = 1.5 * pixelRatio
		context.stroke()
		context.font = `${10 * pixelRatio}px system-ui, sans-serif`
		context.fillStyle = '#fff'
		context.strokeStyle = 'rgba(0, 0, 0, 0.7)'
		context.lineWidth = 3 * pixelRatio
		const label = length >= 1000 ? `${length / 1000} km` : `${length} m`
		context.strokeText(label, x, y - 5 * pixelRatio)
		context.fillText(label, x, y - 5 * pixelRatio)

		if (plane) this.drawAirplane(plane, size)
	}

	// An arrow at the airplane, along its heading (local +Z, turned by its yaw).
	drawAirplane(plane, size) {
		const { context, view } = this
		const [u, v] = worldToMap(view, plane.position.x, plane.position.z)
		if (u < 0 || u > 1 || v < 0 || v > 1) return
		const pixelRatio = size / this.cssSize
		const yaw = plane.rotation.y
		context.save()
		context.translate(u * size, v * size)
		// Screen x follows world +X and screen y world +Z.
		context.rotate(Math.atan2(Math.cos(yaw), Math.sin(yaw)))
		context.scale(pixelRatio, pixelRatio)
		context.beginPath()
		context.moveTo(7, 0)
		context.lineTo(-5, 4.5)
		context.lineTo(-2.5, 0)
		context.lineTo(-5, -4.5)
		context.closePath()
		context.fillStyle = '#ff3b30'
		context.strokeStyle = '#fff'
		context.lineWidth = 1.5
		context.fill()
		context.stroke()
		context.restore()
	}
}
