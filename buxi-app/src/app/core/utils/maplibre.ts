import * as maplibregl from 'maplibre-gl';
import { environment } from '../../../environments/environment';

// `dataviz-dark` es plano y minimal: sirve para paneles donde el mapa es sólo
// un fondo de datos. `streets-v2-dark` trae edificios, relieve y agua, que es
// lo que necesita el mapa del pasajero para verse 3D.
export type MapStyleName = 'dataviz-dark' | 'streets-v2-dark';

export function mapStyleUrl(style: MapStyleName = 'dataviz-dark'): string {
  return `https://api.maptiler.com/maps/${style}/style.json?key=${environment.maptilerKey}`;
}

// DEM de MapTiler: cada píxel codifica altura en su color. Es lo que MapLibre
// usa para levantar el relieve del terreno.
const TERRAIN_DEM_URL = () =>
  `https://api.maptiler.com/tiles/terrain-rgb-v2/tiles.json?key=${environment.maptilerKey}`;

// MapLibre es asíncrono: no se pueden agregar sources/layers hasta que el
// estilo terminó de cargar. Este helper devuelve el mapa ya "load" para que
// el código llamador pueda dibujar de una sin manejar el evento cada vez.
// Nota: MapLibre usa [lng, lat] (invertido respecto a Leaflet).
export function createMap(opts: {
  container: string | HTMLElement;
  center: [number, number];
  zoom: number;
  style?: MapStyleName;
  pitch?: number;
  bearing?: number;
  // Relieve + edificios extruidos + cielo. Cuesta GPU, así que sólo lo pide
  // el mapa del pasajero; el del chofer y los dashboards siguen planos.
  threeD?: boolean;
}): Promise<maplibregl.Map> {
  const map = new maplibregl.Map({
    container: opts.container,
    style: mapStyleUrl(opts.style ?? (opts.threeD ? 'streets-v2-dark' : 'dataviz-dark')),
    center: opts.center,
    zoom: opts.zoom,
    pitch: opts.pitch ?? 0,
    bearing: opts.bearing ?? 0,
    attributionControl: false,
    // Rotar con dos dedos: sin esto el gesto de rotación no existe en móvil y
    // el 3D queda sin manera de mirarse desde otro ángulo.
    pitchWithRotate: true,
    dragRotate: true,
    maxPitch: 70,
  });

  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve(map);
    };

    map.on('load', () => {
      if (opts.threeD) {
        try { enable3D(map); } catch { /* el mapa sigue siendo usable en 2D */ }
      }
      done();
    });

    // Si el estilo no carga (key vencida, sin red, 403 del proveedor), 'load'
    // no dispara NUNCA. Sin esta salida la promesa queda pendiente para
    // siempre, la página nunca apaga su bandera de "cargando" y el overlay
    // de carga bloquea la pantalla entera: la app queda inutilizable por un
    // fallo de un tercero. Mejor devolver el mapa vacío y dejar que el resto
    // de la interfaz funcione.
    map.on('error', done);
    setTimeout(done, 8000);
  });
}

// El id de la fuente vectorial cambia según el estilo de MapTiler, así que en
// vez de hardcodearlo se busca la capa que ya dibuja edificios y se reusa su
// fuente. Si el estilo cambia, esto sigue funcionando.
function findBuildingSource(map: maplibregl.Map): { source: string; sourceLayer: string } | null {
  const layers = map.getStyle().layers || [];
  for (const layer of layers) {
    const sourceLayer = (layer as any)['source-layer'];
    if (sourceLayer === 'building' && (layer as any).source) {
      return { source: (layer as any).source, sourceLayer };
    }
  }
  return null;
}

// Las etiquetas (nombres de calles, ciudades) deben quedar por encima de los
// edificios; si no, los edificios altos las tapan.
function firstSymbolLayerId(map: maplibregl.Map): string | undefined {
  return (map.getStyle().layers || []).find(l => l.type === 'symbol')?.id;
}

export function enable3D(map: maplibregl.Map): void {
  // ---- Relieve ----
  if (!map.getSource('terrain-dem')) {
    map.addSource('terrain-dem', {
      type: 'raster-dem',
      url: TERRAIN_DEM_URL(),
      tileSize: 256,
    });
  }
  // Exageración moderada: Costa Rica ya es montañosa, pasarse de 1.5 la vuelve
  // una caricatura.
  map.setTerrain({ source: 'terrain-dem', exaggeration: 1.4 });

  // ---- Cielo ----
  try {
    map.setSky({
      'sky-color': '#0b1a2e',
      'horizon-color': '#1b3358',
      'fog-color': '#0a1626',
      'sky-horizon-blend': 0.6,
      'horizon-fog-blend': 0.7,
      'fog-ground-blend': 0.4,
    });
  } catch { /* setSky no existe en versiones viejas de MapLibre */ }

  // ---- Edificios 3D ----
  const building = findBuildingSource(map);
  if (building && !map.getLayer('buxi-buildings-3d')) {
    map.addLayer(
      {
        id: 'buxi-buildings-3d',
        type: 'fill-extrusion',
        source: building.source,
        'source-layer': building.sourceLayer,
        minzoom: 13,
        paint: {
          // Más altos = un poco más claros, para que se lean unos de otros.
          'fill-extrusion-color': [
            'interpolate', ['linear'], ['get', 'render_height'],
            0, '#1a2434',
            50, '#243248',
            200, '#2e3f5c',
          ],
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 8],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          'fill-extrusion-opacity': 0.85,
        },
      },
      firstSymbolLayerId(map),
    );
  }
}

export function set3DEnabled(map: maplibregl.Map, enabled: boolean): void {
  if (enabled) {
    enable3D(map);
    map.easeTo({ pitch: 55, duration: 600 });
  } else {
    map.setTerrain(null);
    if (map.getLayer('buxi-buildings-3d')) map.setLayoutProperty('buxi-buildings-3d', 'visibility', 'none');
    map.easeTo({ pitch: 0, bearing: 0, duration: 600 });
  }
  if (enabled && map.getLayer('buxi-buildings-3d')) {
    map.setLayoutProperty('buxi-buildings-3d', 'visibility', 'visible');
  }
}

// Desliza un marcador de su posición actual a una nueva en vez de saltar de
// golpe, para que el movimiento del bus se vea fluido. target es [lng, lat].
// Si se pasa `targetRotation`, el ícono además gira hacia el nuevo rumbo.
export function animateMarkerTo(
  marker: maplibregl.Marker,
  target: [number, number],
  duration = 1000,
  targetRotation?: number,
): void {
  const start = marker.getLngLat();
  const [endLng, endLat] = target;
  const startRotation = marker.getRotation();
  // Camino angular más corto: girar de 350° a 10° son 20° a la derecha, no
  // 340° a la izquierda. Sin esto el bus da una vuelta completa al cruzar el
  // norte.
  const deltaRotation = targetRotation === undefined
    ? 0
    : ((targetRotation - startRotation + 540) % 360) - 180;
  const startTime = performance.now();

  function step(now: number) {
    const t = Math.min((now - startTime) / duration, 1);
    marker.setLngLat([
      start.lng + (endLng - start.lng) * t,
      start.lat + (endLat - start.lat) * t,
    ]);
    if (targetRotation !== undefined) {
      marker.setRotation(startRotation + deltaRotation * t);
    }
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// Aproxima un círculo geográfico como polígono GeoJSON. Se usa para el radio
// de precisión de la ubicación: dibujarlo como capa (y no como un div de N
// píxeles) hace que represente METROS REALES, así que al alejar el zoom se
// encoge igual que el terreno — que es justamente lo que tiene que comunicar.
export function circlePolygon(
  lng: number,
  lat: number,
  radiusMeters: number,
  steps = 64,
): GeoJSON.Feature<GeoJSON.Polygon> {
  const coords: [number, number][] = [];
  const latRad = (lat * Math.PI) / 180;
  // Grados de longitud por metro varían con la latitud; los de latitud no.
  const dLat = radiusMeters / 111320;
  const dLng = radiusMeters / (111320 * Math.cos(latRad));

  for (let i = 0; i <= steps; i++) {
    const theta = (i / steps) * 2 * Math.PI;
    coords.push([lng + dLng * Math.cos(theta), lat + dLat * Math.sin(theta)]);
  }

  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [coords] },
  };
}

// Crea un elemento HTML para usar como marcador custom (MapLibre no tiene
// divIcon como Leaflet; se le pasa un HTMLElement directo).
export function htmlMarkerEl(className: string, innerHtml: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = className;
  el.innerHTML = innerHtml;
  return el;
}
