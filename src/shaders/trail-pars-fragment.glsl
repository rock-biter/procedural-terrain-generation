// Wing trail ribbon (src/wingTrails.js); the uniforms follow params.trails.
varying vec2 vTrailWidths;
varying float vTrailDistance;
varying float vTrailBank;
varying vec2 vUV;
uniform float uTrailRibbonWidth;
uniform float uTrailLineWidth;
uniform float uTrailBorderWidth;
uniform float uTrailOuterFrequency;
uniform float uTrailOuterAmplitude;
uniform float uTrailInnerFrequency;
uniform float uTrailInnerAmplitude;
uniform float uTrailOscillationFrequency;
uniform float uTrailOscillationAmplitude;
uniform vec3 uTrailTint;
// The ribbon's length (src/wingTrails.js): uv.y spans `uTrailMaxLength`, the
// current one ends at `uTrailLength`, and `uTrailTaperLength` is how far the
// stripes take to grow from the wings and to fade before the end.
uniform float uTrailMaxLength;
uniform float uTrailLength;
uniform float uTrailTaperLength;
