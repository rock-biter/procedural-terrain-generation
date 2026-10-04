// Wing trail ribbon (src/wingTrails.js): per-vertex stripe widths, traveled
// distance, and bank, forwarded to trail-color-fragment.glsl.
attribute vec2 trailWidths;
attribute float trailDistance;
attribute float trailBank;
varying vec2 vTrailWidths;
varying float vTrailDistance;
varying float vTrailBank;
varying vec2 vUV;
