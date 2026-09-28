uniform sampler2D blurLevel1;
uniform sampler2D blurLevel2;
uniform sampler2D blurLevel3;
uniform sampler2D blurLevel4;
uniform sampler2D blurLevel5;
uniform sampler2D blurLevel6;
uniform float intensity;
// x = strength, y = start radius, z = end radius, w = curve exponent.
uniform vec4 blurParams;
uniform vec4 aberrationParams;

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

vec3 sampleLevel(int level, vec2 uv) {
  if(level <= 0)
    return textureLod(inputBuffer, uv, 0.0).rgb;
  if(level == 1)
    return sampleBSpline(blurLevel1, uv);
  if(level == 2)
    return sampleBSpline(blurLevel2, uv);
  if(level == 3)
    return sampleBSpline(blurLevel3, uv);
  if(level == 4)
    return sampleBSpline(blurLevel4, uv);
  if(level == 5)
    return sampleBSpline(blurLevel5, uv);
  return sampleBSpline(blurLevel6, uv);
}

vec3 sampleBlur(vec2 uv, float lod) {
  float level = floor(lod);
  float blend = lod - level;
  vec3 color = sampleLevel(int(level), uv);

  if(blend > 0.0) {
    color = mix(color, sampleLevel(int(level) + 1, uv), blend);
  }

  return color;
}

float getMask(vec4 params, float radius) {
  return intensity * pow(smoothstep(params.y, params.z, radius), params.w);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 fromCenter = uv - 0.5;
	// 0 at the center and 1 at the corners; elliptical so every edge gets the same falloff.
  float radius = length(fromCenter) * 1.41421356;

	// Level k of the pyramid blurs by roughly 2^k pixels.
  float blurPixels = blurParams.x * getMask(blurParams, radius) * resolution.y;
  float lod = min(log2(max(blurPixels, 1.0)), float(LEVELS));
  vec2 dispersion = fromCenter * (2.0 * aberrationParams.x * getMask(aberrationParams, radius));
  vec2 dispersionPixels = dispersion * resolution;
  bool hasAberration = dot(dispersionPixels, dispersionPixels) > 0.25;

  if(lod <= 0.0 && !hasAberration) {
    outputColor = inputColor;
    return;
  }

  vec3 color = hasAberration ? vec3(sampleBlur(uv + dispersion, lod).r, sampleBlur(uv, lod).g, sampleBlur(uv - dispersion, lod).b) : sampleBlur(uv, lod);

  outputColor = vec4(color, inputColor.a);
}
