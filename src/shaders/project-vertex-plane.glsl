#include <project_vertex>
vUV = uv;
vTrailWidths = trailWidths;
vTrailWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
