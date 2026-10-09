import { Quaternion, Vector3 } from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
import { isFlightPauseShortcut } from './debugPolicy'

/**
 * Debug-only flight pause (`?debug=1`). Freezes the airplane while global
 * time, uniforms, chunk streaming, and rendering keep running, and hands the
 * camera to OrbitControls until the flight resumes.
 */
export default class FlightPauseDebug {
	#paused = false
	canPause = false
	savedCameraPosition = new Vector3()
	savedCameraQuaternion = new Quaternion()
	savedCameraFov = 0

	controls = null

	constructor({ plane, camera, scene, domElement }) {
		this.plane = plane
		this.camera = camera
		this.scene = scene
		this.domElement = domElement

		this.onKeyDown = (event) => {
			if (!isFlightPauseShortcut(event)) return
			event.preventDefault()
			this.toggle()
		}
		window.addEventListener('keydown', this.onKeyDown)
	}

	// OrbitControls calls lookAt() in its constructor, so it must be created only
	// after the camera leaves the plane; otherwise it tilts the follow camera.
	#getControls() {
		if (!this.controls) {
			this.controls = new OrbitControls(this.camera, this.domElement)
			this.controls.enableDamping = true
			// Map-style pan: drag across the horizontal world plane (orthogonal
			// to camera.up), so panning never changes the camera height.
			this.controls.screenSpacePanning = false
			this.controls.minDistance = 2
			// Keep the orbit inside the fog range so the loaded terrain stays readable.
			this.controls.maxDistance = 600
		}

		return this.controls
	}

	get paused() {
		return this.#paused
	}

	toggle() {
		if (this.#paused) this.resume()
		else this.pause()
	}

	pause() {
		if (this.#paused || !this.canPause) return
		this.#paused = true

		// Also drops a held wheel request, so the speed effect stays frozen.
		this.plane.setInputEnabled(false)

		this.savedCameraPosition.copy(this.camera.position)
		this.savedCameraQuaternion.copy(this.camera.quaternion)
		this.savedCameraFov = this.camera.fov

		// OrbitControls expects a world-space camera, so detach it from the plane.
		this.scene.attach(this.camera)
		const controls = this.#getControls()
		this.plane.getWorldPosition(controls.target)
		controls.enabled = true
		controls.update()
	}

	resume() {
		if (!this.#paused) return
		this.#paused = false

		this.controls.enabled = false
		this.plane.addCamera(this.camera)
		this.camera.position.copy(this.savedCameraPosition)
		this.camera.quaternion.copy(this.savedCameraQuaternion)
		this.camera.fov = this.savedCameraFov
		this.camera.updateProjectionMatrix()

		this.plane.setInputEnabled(true)
	}

	// Keeps the paused orbit around the airplane after it moves by `offset`
	// without flying (World.teleportPlane()).
	moveBy(offset) {
		if (!this.#paused) return
		this.camera.position.add(offset)
		this.controls.target.add(offset)
	}

	update() {
		if (!this.#paused) return

		this.controls.update()
		// Keep trail GUI tuning live without recording a new flight pose.
		this.plane.refreshTrails()
	}

	getStats() {
		return { paused: this.#paused, canPause: this.canPause }
	}

	dispose() {
		if (this.#paused) this.resume()
		window.removeEventListener('keydown', this.onKeyDown)
		this.controls?.dispose()
	}
}
