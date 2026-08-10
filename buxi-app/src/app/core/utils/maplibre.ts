import * as maplibregl from 'maplibre-gl';
import { environment } from '../../../environments/environment';

// `dataviz-dark` es plano y minimal: sirve para paneles donde el mapa es sólo
// un fondo de datos. `streets-v2-dark` trae edificios, relieve y agua, que es
// lo que necesita el mapa del pasajero para verse 3D.
// `outdoor-v2` para el modo claro: terreno verde apagado y agua azul suave,
// el look de mapa de seguimiento. `streets-v2` era un callejero urbano, con
// demasiado color y detalle compitiendo con los buses.
export type MapStyleName = 'dataviz-dark' | 'streets-v2-dark' | 'outdoor-v2';

export function isDarkStyle(style: MapStyleName): boolean {
  return style.endsWith('-dark');
}

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
        const dark = isDarkStyle(opts.style ?? "streets-v2-dark");
        try { enable3D(map, dark); } catch { /* el mapa sigue siendo usable en 2D */ }
        if (!dark) { try { tintLightMap(map); } catch {} }
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

// El relieve y los edificios se pintan según el tema: sobre terreno claro, un
// cielo nocturno y edificios azul marino se ven como un error de render.
export function enable3D(map: maplibregl.Map, dark = true): void {
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
    map.setSky(dark
      ? {
          'sky-color': '#0b1a2e',
          'horizon-color': '#1b3358',
          'fog-color': '#0a1626',
          'sky-horizon-blend': 0.6,
          'horizon-fog-blend': 0.7,
          'fog-ground-blend': 0.4,
        }
      : {
          'sky-color': '#a8cdf0',
          'horizon-color': '#dceaf6',
          'fog-color': '#eef4f8',
          'sky-horizon-blend': 0.7,
          'horizon-fog-blend': 0.6,
          'fog-ground-blend': 0.3,
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
          'fill-extrusion-color': dark
            ? [
                'interpolate', ['linear'], ['get', 'render_height'],
                0, '#1a2434',
                50, '#243248',
                200, '#2e3f5c',
              ]
            // Grises fríos y con salto real entre alturas. Antes eran beiges
            // pálidos (#d9d7cd…) sobre un suelo también pálido: los edificios
            // se fundían con el terreno y la ciudad se veía lavada y vacía.
            // El tono frío además los despega del verde y del beige del mapa.
            : [
                'interpolate', ['linear'], ['get', 'render_height'],
                0, '#b6bcc4',
                50, '#9aa2ad',
                200, '#7d8794',
              ],
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 8],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          'fill-extrusion-opacity': dark ? 0.85 : 0.92,
        },
      },
      firstSymbolLayerId(map),
    );
  }
}

// Repinta el estilo claro con una paleta propia, al estilo Google Maps: verdes
// más vivos, agua celeste y carreteras azules. MapTiler no ofrece un estilo así,
// pero sus capas se pueden repintar en caliente una vez cargado el estilo.
//
// Cada asignación va protegida: si MapTiler renombra o quita una capa, esa
// línea se ignora y el mapa sigue funcionando con su color original en vez de
// romperse entero.
export function tintLightMap(map: maplibregl.Map): void {
  const paint = (id: string, prop: string, value: any) => {
    try {
      if (map.getLayer(id)) map.setPaintProperty(id, prop as any, value);
    } catch { /* capa ausente o propiedad no aplicable a este tipo */ }
  };

  // ---- Vegetación ----
  paint('Forest', 'fill-color', '#a9d6a0');
  paint('Wood', 'fill-color', '#a9d6a0');
  paint('Park', 'fill-color', '#c3e6b4');
  paint('Grass', 'fill-color', '#c8e8b8');
  paint('Scrub', 'fill-color', '#cfe6bb');
  for (const id of ['Forest', 'Wood', 'Park', 'Grass', 'Scrub']) {
    paint(id, 'fill-opacity', 0.9);
  }

  // ---- Agua ----
  // Azul saturado, no el celeste pálido del estilo original: el agua es el
  // rasgo geográfico que más orienta de un vistazo (costa, golfo, ríos), y
  // desvaída se perdía contra el terreno claro. `Water` cubre mar y lagos.
  paint('Water', 'fill-color', '#2e90e0');
  paint('Water', 'fill-opacity', 1);
  // El río va más suave que el mar a propósito: con el mismo azul saturado, una
  // línea fina compite con las carreteras y satura la escena. Un tono más claro
  // lo mantiene reconocible como agua sin robarle protagonismo a las vías.
  paint('River', 'line-color', '#93c8e8');
  paint('River', 'line-opacity', 0.85);
  // Un río de 1px a este zoom desaparece; se le da cuerpo creciente con el zoom.
  paint('River', 'line-width', [
    'interpolate', ['linear'], ['zoom'],
    8, 1.2,
    12, 2.4,
    16, 4,
  ]);

  // ---- Suelo ----
  // Un punto más oscuro y cálido que el original. El fondo casi blanco era la
  // razón de fondo por la que las calles no se veían: no hay color de vía que
  // resalte contra un lienzo del mismo valor.
  paint('Sand', 'fill-color', '#ece0c4');
  paint('Residential', 'fill-color', '#e9e7e0');
  try {
    const bg = (map.getStyle().layers || []).find(l => l.type === 'background');
    if (bg) map.setPaintProperty(bg.id, 'background-color', '#eef0e6');
  } catch {}

  // ---- Carreteras ----
  // `Road network` es UNA sola capa para toda la red, así que un color plano
  // pintaría de azul hasta el último callejón. Se usa el atributo `class` del
  // esquema OpenMapTiles para conservar la jerarquía: azul sólo en las vías
  // importantes, blanco en las calles de barrio, como en la referencia.
  // Prueba en naranja. Se conserva la jerarquía por `class` para poder juzgar
  // el resultado: un naranja plano en toda la red no diría nada.
  paint('Road network', 'line-color', [
    'match', ['get', 'class'],
    ['motorway', 'trunk'], '#e2680a',
    ['primary'], '#f2861f',
    ['secondary', 'tertiary'], '#f7a85c',
    '#c69766',
  ]);

  // Ancho explícito por jerarquía y zoom. El estilo original adelgaza mucho las
  // vías a zoom medio, que es justo donde se mira una ciudad entera.
  paint('Road network', 'line-width', [
    'interpolate', ['linear'], ['zoom'],
    6, ['match', ['get', 'class'], ['motorway', 'trunk'], 2.4, ['primary'], 1.7, 0.9],
    10, ['match', ['get', 'class'], ['motorway', 'trunk'], 5.4, ['primary'], 4, ['secondary', 'tertiary'], 2.8, 1.8],
    14, ['match', ['get', 'class'], ['motorway', 'trunk'], 9.5, ['primary'], 7.2, ['secondary', 'tertiary'], 5.2, 3.4],
    18, ['match', ['get', 'class'], ['motorway', 'trunk'], 21, ['primary'], 16, ['secondary', 'tertiary'], 12, 7.5],
  ]);

  paint('Bridge', 'fill-color', '#cfd8e6');

  // Contorno bajo las vías principales. Es lo que en cartografía les da
  // presencia: sin él, una línea de color plano sobre terreno claro se lee
  // como un trazo suelto y no como una carretera.
  addRoadCasing(map);
}

function addRoadCasing(map: maplibregl.Map): void {
  const CASING_ID = 'buxi-road-casing';
  if (map.getLayer(CASING_ID)) return;

  const road = (map.getStyle().layers || []).find(l => l.id === 'Road network') as any;
  if (!road?.source) return;

  try {
    map.addLayer(
      {
        id: CASING_ID,
        type: 'line',
        source: road.source,
        'source-layer': road['source-layer'],
        // Incluye también secundarias y terciarias: son las que estructuran una
        // ciudad como Liberia, y sin contorno se perdían junto a las de barrio.
        filter: ['match', ['get', 'class'],
          ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'], true, false],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          // El contorno acompaña al naranja: en azul quedaría un halo frío
          // alrededor de una vía cálida y se vería sucio.
          'line-color': '#8a3d05',
          'line-opacity': 0.45,
          'line-width': [
            'interpolate', ['linear'], ['zoom'],
            6, 4,
            10, 8,
            14, 13.5,
            18, 28,
          ],
        },
      },
      'Road network',
    );
  } catch { /* si el estilo cambia de estructura, el mapa sigue sin el contorno */ }
}

export function set3DEnabled(map: maplibregl.Map, enabled: boolean, dark = true): void {
  if (enabled) {
    enable3D(map, dark);
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
