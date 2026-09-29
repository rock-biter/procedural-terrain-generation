#include <color_fragment>

		// snow
	  float pctLine = step(wPosition.y + sin(wPosition.x * 0.15) * 5. + cos(wPosition.z * 0.15) * 5.,39.);
	  float pct3 = step(wPosition.y + sin(wPosition.x * 0.15) * 5. + cos(wPosition.z * 0.15) * 5.,40.2);
	  // diffuseColor.rgb = mix(vec3(0.,0.,0.),diffuseColor.rgb,pctLine);
	  diffuseColor.rgb = mix(vec3(0.4,0.8,0.9),diffuseColor.rgb,pct3);


    //atmosphere
		diffuseColor.rgb = mix(min(uAtmosphere,diffuseColor.rgb),diffuseColor.rgb,smoothstep(700.,400.,distanceFromCamera));

    diffuseColor.a *= smoothstep(600.,200.,distanceFromCamera);