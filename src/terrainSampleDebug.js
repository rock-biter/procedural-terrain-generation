import { DoubleSide, Group, Mesh, MeshBasicMaterial, Shape, ShapeGeometry } from 'three'
import { replaceChunks } from './shaderChunks.js'
import curvatureDrop from './shaders/curvature-drop.glsl'

// The ?debug=1 terrain corridor markers: a white cross at each of the four
// points the flight samples under and ahead of the airplane
// (getFlightCorridor() in src/flightPolicy.js), on top of everything and
// dropped by the world curvature like the terrain.

const MARKER_COLOR = 0xffffff

function createCrossGeometry() {
	const halfLength = 2.5
	const halfWidth = 0.25
	const shape = new Shape()

	shape.moveTo(-halfWidth, -halfLength)
	shape.lineTo(halfWidth, -halfLength)
	shape.lineTo(halfWidth, -halfWidth)
	shape.lineTo(halfLength, -halfWidth)
	shape.lineTo(halfLength, halfWidth)
	shape.lineTo(halfWidth, halfWidth)
	shape.lineTo(halfWidth, halfLength)
	shape.lineTo(-halfWidth, halfLength)
	shape.lineTo(-halfWidth, halfWidth)
	shape.lineTo(-halfLength, halfWidth)
	shape.lineTo(-halfLength, -halfWidth)
	shape.lineTo(-halfWidth, -halfWidth)
	shape.closePath()

	const geometry = new ShapeGeometry(shape)
	geometry.rotateX(-Math.PI * 0.5)

	return geometry
}

function createMarkerMaterial(color, uniforms) {
	const material = new MeshBasicMaterial({
		color,
		side: DoubleSide,
		depthTest: false,
		depthWrite: false,
		fog: false,
	})

	material.onBeforeCompile = (shader) => {
		shader.uniforms.uCamera = uniforms.uCamera
		shader.uniforms.uCurvature = uniforms.uCurvature
		shader.vertexShader = replaceChunks(shader.vertexShader, {
			common: `#include <common>
			uniform vec3 uCamera;
			uniform float uCurvature;
			${curvatureDrop}`,
			project_vertex: `vec4 mvPosition = vec4(transformed, 1.0);
			vec3 markerWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
			float markerDistance = length(markerWorldPosition - uCamera);
			mvPosition.y -= getCurvatureDrop(markerDistance);
			mvPosition = modelViewMatrix * mvPosition;
			gl_Position = projectionMatrix * mvPosition;`,
		})
	}

	return material
}

export default class TerrainSampleDebug extends Group {
	constructor(uniforms) {
		super()

		this.name = 'terrain-sample-debug'
		const geometry = createCrossGeometry()
		this.markers = Array.from({ length: 4 }, (_, index) => {
			const marker = new Mesh(geometry, createMarkerMaterial(MARKER_COLOR, uniforms))
			marker.name = `terrain-sample-${index}`
			marker.rotation.y = Math.PI * 0.25
			marker.renderOrder = 1000
			marker.visible = false
			this.add(marker)

			return marker
		})
	}

	update(samples) {
		const hasAllSamples = samples?.length === this.markers.length
		this.visible = hasAllSamples
		if (!hasAllSamples) return

		this.markers.forEach((marker, index) => {
			const sample = samples[index]
			marker.position.set(sample.x, sample.height, sample.z)
			marker.visible = true
		})
	}
}
