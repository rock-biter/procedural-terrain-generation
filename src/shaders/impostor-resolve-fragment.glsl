// Resolves the supersampled impostor bake into the final atlas (see
// src/impostors/impostorBaker.js). SUPERSAMPLE and DILATION_RADIUS are defines.
layout(location = 0) out vec4 gAlbedo;
layout(location = 1) out vec4 gNormal;
layout(location = 2) out vec4 gPaint;
uniform sampler2D tAlbedo;
uniform sampler2D tNormal;
uniform sampler2D tPaint;
uniform int uFrameSize;
// Atlas pixel where the current type's block starts.
uniform vec2 uBlockOrigin;

void main() {
	// Texel inside the type block; the bake target holds only this type.
	ivec2 texel = ivec2(gl_FragCoord.xy - uBlockOrigin);
	ivec2 source = texel * SUPERSAMPLE;

	// Box-downsample the supersampled bake: alpha becomes fractional coverage,
	// so the runtime alpha test finds a smooth sub-texel silhouette.
	vec4 colorSum = vec4(0.0);
	vec3 normalSum = vec3(0.0);
	float depthSum = 0.0;
	float paintSum = 0.0;
	for (int y = 0; y < SUPERSAMPLE; y++) {
		for (int x = 0; x < SUPERSAMPLE; x++) {
			vec4 albedo = texelFetch(tAlbedo, source + ivec2(x, y), 0);
			vec4 normal = texelFetch(tNormal, source + ivec2(x, y), 0);
			colorSum += vec4(albedo.rgb * albedo.a, albedo.a);
			normalSum += (normal.xyz * 2.0 - 1.0) * albedo.a;
			depthSum += normal.a * albedo.a;
			paintSum += texelFetch(tPaint, source + ivec2(x, y), 0).r * albedo.a;
		}
	}

	if (colorSum.a > 0.0) {
		gAlbedo = vec4(colorSum.rgb / colorSum.a, colorSum.a / float(SUPERSAMPLE * SUPERSAMPLE));
		gNormal = vec4(normalize(normalSum) * 0.5 + 0.5, depthSum / colorSum.a);
		// The paint mask is premultiplied by coverage, so filtering and every
		// mip average it correctly against the coverage the impostor divides by.
		gPaint = vec4(paintSum / float(SUPERSAMPLE * SUPERSAMPLE), 0.0, 0.0, 1.0);
		return;
	}

	// Empty texel: copy the nearest covered color and normal inside the same
	// frame so bilinear filtering and mipmaps do not pull in black halos. The
	// premultiplied paint mask stays 0.
	vec4 albedo = vec4(0.0);
	vec4 normal = vec4(0.5, 1.0, 0.5, 0.5);
	ivec2 cellMin = (texel / uFrameSize) * uFrameSize;
	ivec2 cellMax = cellMin + ivec2(uFrameSize - 1);
	int best = 1 << 20;
	for (int y = -DILATION_RADIUS; y <= DILATION_RADIUS; y++) {
		for (int x = -DILATION_RADIUS; x <= DILATION_RADIUS; x++) {
			ivec2 neighbour = texel + ivec2(x, y);
			if (any(lessThan(neighbour, cellMin)) || any(greaterThan(neighbour, cellMax))) continue;
			ivec2 neighbourSource = neighbour * SUPERSAMPLE + SUPERSAMPLE / 2;
			vec4 candidate = texelFetch(tAlbedo, neighbourSource, 0);
			int distanceSquared = x * x + y * y;
			if (candidate.a >= 0.5 && distanceSquared < best) {
				best = distanceSquared;
				albedo.rgb = candidate.rgb;
				normal = texelFetch(tNormal, neighbourSource, 0);
			}
		}
	}

	gAlbedo = albedo;
	gNormal = normal;
	gPaint = vec4(0.0, 0.0, 0.0, 1.0);
}
