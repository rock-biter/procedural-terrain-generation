#include <color_fragment>

		float biomes = snoise(wPosition.xz * 0.001) * 0.3 + 0.6 + snoise(wPosition.xz * 0.01) * 0.3;
		vec3 grassBiomes = mix(uGrass,vec3(0.33,0.2,0.),biomes * 0.5);
		vec3 landBiomes = mix(uLand,vec3(.1,.25,.1),biomes * 0.5);
		vec3 rocksBiomes = mix(uRocks,vec3(0.01,.0,0.01), biomes );

		float pctDeep = smoothstep(-24.,-40.,wPosition.y);
		diffuseColor.rgb = mix(vec3(0.0,0.,0.5),vec3(0.0,0.,0.02),pctDeep);
	  float pctSea = smoothstep(-6.,-16.,wPosition.y);
	  diffuseColor.rgb = mix(vec3(0.,0.2,.6),diffuseColor.rgb,pctSea);
		diffuseColor.rgb = mix(vec3(0.,0.,0.),diffuseColor.rgb,step(wPosition.y,0.));
		float pctSand = step(wPosition.y,0.1);
	  diffuseColor.rgb = mix(vec3(0.9,0.8,0.5),diffuseColor.rgb,pctSand);
	  
		// green
	  float pctLine = step(wPosition.y + sin(wPosition.x * 0.3) * 0.6 + cos(wPosition.z * 0.3) * 0.6,1.6);
		float pct = step(wPosition.y + sin(wPosition.x * 0.3) * 0.6 + cos(wPosition.z * 0.3) * 0.6,1.7);

	  diffuseColor.rgb = mix(vec3(0.,0.,0.),diffuseColor.rgb,pctLine);
	  // diffuseColor.rgb = mix(vec3(0.1,0.4,0.),diffuseColor.rgb,pct);
	  diffuseColor.rgb = mix(grassBiomes,diffuseColor.rgb,pct);

		// orange
		pctLine = step(wPosition.y + sin(wPosition.x * 0.1) * 1.6 + cos(wPosition.z * 0.1) * 1.6 ,14.);
	  float pct2 = step(wPosition.y + sin(wPosition.x * 0.1) * 1.6 + cos(wPosition.z * 0.1) * 1.6 ,14.1);
		diffuseColor.rgb = mix(vec3(0.,0.,0.),diffuseColor.rgb,pctLine);
	  // diffuseColor.rgb = mix(vec3(0.8,0.3,0.),diffuseColor.rgb,pct2);
	  diffuseColor.rgb = mix(landBiomes,diffuseColor.rgb,pct2);

		// brown
		pctLine = step(wPosition.y + sin(wPosition.x * 0.15) * 2.5 + cos(wPosition.z * 0.15) * 2.5,22.);
		float pctRock = step(wPosition.y + sin(wPosition.x * 0.15) * 2.5 + cos(wPosition.z * 0.15) * 2.5,22.2);
	  diffuseColor.rgb = mix(vec3(0.0,0.0,0.0),diffuseColor.rgb,pctLine);
	  // diffuseColor.rgb = mix(vec3(0.09,0.05,0.01),diffuseColor.rgb,pctRock);
	  diffuseColor.rgb = mix(rocksBiomes,diffuseColor.rgb,pctRock);

		// snow
	  pctLine = step(wPosition.y + sin(wPosition.x * 0.15) * 5. + cos(wPosition.z * 0.15) * 5.,40.);
	  float pct3 = step(wPosition.y + sin(wPosition.x * 0.15) * 5. + cos(wPosition.z * 0.15) * 5.,40.2);
	  diffuseColor.rgb = mix(vec3(0.,0.,0.),diffuseColor.rgb,pctLine);
	  diffuseColor.rgb = mix(vec3(0.4,0.8,0.9),diffuseColor.rgb,pct3);

	
		float onda = sin(wPosition.y * 8. - uTime * 4. + sin(wPosition.x * 0.5) + sin(wPosition.z * 0.5)) * 0.5 + 0.5;
		onda *= onda * onda * onda;
		float d = -3.5;
		onda *= smoothstep(d,d -1.5,wPosition.y) - smoothstep(d - 3.,d - 4., wPosition.y) ;
		// float dash = sin(wPosition.x * .35) * 0.5 + 0.5;
		// onda = mix(onda,0.,sin(wPosition.y * 0.2 + sin(wPosition.x * 0.02) * 5. + sin(wPosition.z * 0.02) * 5.) * 0.5 + 0.5);
		onda = mix(onda * 0.5,0.,sin(wPosition.y + wPosition.x * 0.2) );
		diffuseColor.rgb = mix(vec3(onda),diffuseColor.rgb,1. - onda);

		diffuseColor.rgb = mix(vec3(min(0.1,diffuseColor.r),min(0.015,diffuseColor.g),min(0.02,diffuseColor.b)),diffuseColor.rgb,smoothstep(700.,200.,distanceFromCamera));