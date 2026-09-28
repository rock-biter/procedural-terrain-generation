#include <project_vertex>
vUV = uv;
vTrailWidths = trailWidths;
vTrailDistance = trailDistance;
vTrailBank = trailBank;
vTrailWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
