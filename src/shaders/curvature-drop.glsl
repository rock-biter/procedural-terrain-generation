// Drop of the curved world at `distance` from the eye; uCurvature must be
// declared before. Mirrors getCurvatureDrop() in src/chunkPolicy.js.
#ifndef CURVATURE_DROP
#define CURVATURE_DROP
float getCurvatureDrop(float distance) {
	return uCurvature * (1.0 - cos(distance / uCurvature));
}
#endif
