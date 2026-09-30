// Cubic B-spline reconstruction from 4 bilinear taps; hides the blockiness of low-resolution levels.
vec3 sampleBSpline(sampler2D levelMap, vec2 uv) {
  vec2 size = vec2(textureSize(levelMap, 0));
  vec2 st = uv * size - 0.5;
  vec2 i = floor(st);
  vec2 f = st - i;
  vec2 f2 = f * f;
  vec2 f3 = f2 * f;
  vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
  vec2 w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0;
  vec2 w3 = f3 / 6.0;
  vec2 g0 = w0 + w1;
  vec2 g1 = w2 + w3;
  vec2 p0 = (i - 0.5 + w1 / g0) / size;
  vec2 p1 = (i + 1.5 + w3 / g1) / size;

  return g0.y * (g0.x * textureLod(levelMap, p0, 0.0).rgb + g1.x * textureLod(levelMap, vec2(p1.x, p0.y), 0.0).rgb) +
    g1.y * (g0.x * textureLod(levelMap, vec2(p0.x, p1.y), 0.0).rgb + g1.x * textureLod(levelMap, p1, 0.0).rgb);
}
