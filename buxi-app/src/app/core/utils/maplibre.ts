import * as maplibregl from 'maplibre-gl';
import type { Feature, Polygon } from 'geojson';
import { Protocol } from 'pmtiles';
import { environment } from '../../../environments/environment';

// `dataviz-dark` es plano y minimal: sirve para paneles donde el mapa es sólo
// un fondo de datos. `streets-v2-dark` trae edificios, relieve y agua, que es
// lo que necesita el mapa del pasajero para verse 3D.
// `outdoor-v2` para el modo claro, repintado al estilo Google Maps por
// tintLightMap (sin relieve, verde claro y vías gris azulado). Se parte de él
// y no de `streets-v2` porque es el que trae los parques nacionales como área
// verde con nombre; `streets-v2` era un callejero urbano, con demasiado color y
// detalle compitiendo con los buses.
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
// Mapas cuyo estilo llegó a cargar. `isStyleLoaded()` no sirve para saberlo:
// también da false un rato después, mientras baja fuentes o relieve.
const conEstilo = new WeakSet<maplibregl.Map>();

export function estiloCargo(map: maplibregl.Map): boolean {
  return conEstilo.has(map);
}

// Las paradas de bus de OpenStreetMap (capa "Station" de MapTiler) competían
// con las de Buxci: el pasajero veía dos íconos de parada y no sabía cuál era
// la real. Se dejan solo las estaciones de tren, que sí ayudan a ubicarse.
export function soloParadasBuxci(map: maplibregl.Map) {
  if (!map.getLayer('Station')) return;
  map.setFilter('Station', ['all', ['==', 'class', 'railway'], ['has', 'name']] as any);
}

// Las paradas municipales (las oficiales de la calle) y las terminales del
// mapa base vuelven, pero con un estilo propio que no se confunde con las
// paradas de Buxci (punto blanco con borde azul):
//   - terminales: círculo azul con el ícono de bus y el nombre, desde lejos;
//     son el punto de referencia de cualquier pueblo;
//   - paradas municipales: el ícono de parada en ámbar, solo de cerca.
// Salen de OpenStreetMap, por la misma fuente que el resto del mapa. Las de
// Buxi se dibujan después, encima de estas.
export const CAPA_PARADAS_MUNICIPALES = 'buxci-paradas-municipales';

// ---- Comercios de Overture ----
// Los comercios del mapa base salen de OpenStreetMap, que en Costa Rica tiene
// muchos cerrados y le faltan los nuevos. Cada mes un workflow
// (.github/workflows/comercios-mapa.yml) arma un PMTiles con los de Overture
// Maps: abiertos, con buena confianza, y con el mismo ícono del sprite de
// MapTiler (propiedad `c`). El mapa lee solo las teselas de la zona que mira.
//
// Los comercios de MapTiler se esconden recién cuando el archivo propio
// respondió: si no está (todavía no se publicó, o falló), el mapa queda como
// estaba en vez de quedar sin comercios.
let protocoloPmtiles = false;
function registrarPmtiles() {
  if (protocoloPmtiles) return;
  protocoloPmtiles = true;
  maplibregl.addProtocol('pmtiles', new Protocol().tile);
}

const FUENTE_COMERCIOS = 'buxci-comercios';
const CAPA_COMERCIOS = 'buxci-comercios';

// Lo que de MapTiler pasa a mostrar Overture: las capas enteras de comida y
// tiendas, y las clases comerciales de otras capas (bancos, hoteles, bombas).
const CAPAS_COMERCIO_MAPTILER = ['Food', 'Shopping'];
const CLASES_COMERCIO_MAPTILER: Record<string, string[]> = {
  Public: ['atm', 'bank', 'hairdresser'],
  Tourism: ['apartment', 'chalet', 'guest_house', 'hostel', 'hotel', 'lodging', 'motel'],
  Transport: ['car_rental', 'car_repair', 'fuel'],
};

function esconderComerciosMapTiler(map: maplibregl.Map) {
  for (const id of CAPAS_COMERCIO_MAPTILER) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
  }
  for (const [id, clases] of Object.entries(CLASES_COMERCIO_MAPTILER)) {
    if (!map.getLayer(id)) continue;
    const filtro = map.getFilter(id);
    map.setFilter(id, (filtro ? ['all', filtro, ['!in', 'class', ...clases]] : ['!in', 'class', ...clases]) as any);
  }
}

export function capaComercios(map: maplibregl.Map, dark: boolean): void {
  const url = environment.comerciosUrl;
  if (!url || map.getSource(FUENTE_COMERCIOS)) return;
  registrarPmtiles();
  const letra = (map.getLayer('Food') && map.getLayoutProperty('Food', 'text-font')) || ['Noto Sans Regular'];

  map.addSource(FUENTE_COMERCIOS, { type: 'vector', url: `pmtiles://${url}` });

  const listo = (e: any) => {
    // 'metadata': el encabezado del archivo llegó bien, o sea que existe.
    if (e.sourceId !== FUENTE_COMERCIOS || e.sourceDataType !== 'metadata') return;
    map.off('sourcedata', listo);
    map.off('error', fallo);
    try { esconderComerciosMapTiler(map); } catch {}
  };
  const fallo = (e: any) => {
    if (e?.sourceId !== FUENTE_COMERCIOS) return;
    map.off('sourcedata', listo);
    map.off('error', fallo);
    // Sin archivo: fuera la capa propia y quedan los de MapTiler.
    try {
      if (map.getLayer(CAPA_COMERCIOS)) map.removeLayer(CAPA_COMERCIOS);
      if (map.getSource(FUENTE_COMERCIOS)) map.removeSource(FUENTE_COMERCIOS);
    } catch {}
  };
  map.on('sourcedata', listo);
  map.on('error', fallo);

  // Colores por grupo, los mismos tonos que usa MapTiler para cada tipo.
  const color = dark
    ? ['match', ['get', 'g'], 'comida', 'hsl(18, 39%, 78%)', 'tiendas', 'hsl(18, 25%, 70%)', 'hospedaje', 'hsl(283, 55%, 75%)',
        'auto', 'hsl(215, 81%, 66%)', 'finanzas', 'hsl(51, 30%, 70%)', 'hsl(0, 0%, 75%)']
    : ['match', ['get', 'g'], 'comida', 'hsl(18, 60%, 45%)', 'tiendas', 'hsl(200, 45%, 40%)', 'hospedaje', 'hsl(283, 45%, 45%)',
        'auto', 'hsl(215, 70%, 45%)', 'finanzas', 'hsl(40, 45%, 35%)', 'hsl(0, 0%, 40%)'];

  map.addLayer({
    id: CAPA_COMERCIOS, type: 'symbol', source: FUENTE_COMERCIOS, 'source-layer': 'comercios', minzoom: 15,
    layout: {
      'icon-image': ['coalesce', ['image', ['get', 'c']], ['image', 'shop']] as any,
      'icon-size': 0.85,
      'text-field': ['step', ['zoom'], '', 16, ['get', 'n']],
      'text-font': letra,
      'text-size': ['interpolate', ['linear'], ['zoom'], 16, 11, 19, 13],
      'text-anchor': 'top',
      'text-offset': [0, 0.8],
      'text-max-width': 8,
      'text-optional': true,
      // Si chocan, gana el de más confianza (r chico).
      'symbol-sort-key': ['get', 'r'],
    },
    paint: {
      'icon-color': color as any,
      'icon-halo-color': dark ? 'hsl(0, 0%, 0%)' : '#ffffff',
      'icon-halo-width': 1.2,
      'text-color': color as any,
      'text-halo-color': dark ? 'rgba(7, 15, 28, 0.9)' : 'rgba(255, 255, 255, 0.95)',
      'text-halo-width': 1.4,
    },
  });
}

export function paradasDelMapaBase(map: maplibregl.Map, dark: boolean): void {
  const fuente = 'maptiler_planet';
  if (!map.getSource(fuente)) return;
  const letra = (map.getLayer('Station') && map.getLayoutProperty('Station', 'text-font')) || ['Noto Sans Regular'];
  const halo = dark ? 'rgba(7, 15, 28, 0.92)' : 'rgba(255, 255, 255, 0.95)';
  const terminal = ['all', ['==', ['get', 'class'], 'bus'], ['==', ['get', 'subclass'], 'bus_station']];

  if (!map.getLayer('buxci-terminales-circ')) {
    map.addLayer({
      id: 'buxci-terminales-circ', type: 'circle', source: fuente, 'source-layer': 'poi', minzoom: 11,
      filter: terminal as any,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 6, 14, 10, 17, 13],
        'circle-color': '#2f6fe0',
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2.5,
      },
    });
  }
  if (!map.getLayer('buxci-terminales-txt')) {
    map.addLayer({
      id: 'buxci-terminales-txt', type: 'symbol', source: fuente, 'source-layer': 'poi', minzoom: 11,
      filter: terminal as any,
      layout: {
        'icon-image': 'bus_stop',
        'icon-size': ['interpolate', ['linear'], ['zoom'], 11, 0.5, 14, 0.75, 17, 0.95],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'text-field': ['step', ['zoom'], '', 12.5, ['get', 'name']],
        'text-font': letra,
        'text-size': 12,
        'text-anchor': 'top',
        'text-offset': [0, 1.15],
        'text-max-width': 9,
        'text-optional': true,
      },
      paint: {
        'icon-color': '#ffffff',
        'text-color': dark ? '#dbe7ff' : '#1d4fb8',
        'text-halo-color': halo,
        'text-halo-width': 1.6,
      },
    });
  }
  if (!map.getLayer(CAPA_PARADAS_MUNICIPALES)) {
    map.addLayer({
      id: CAPA_PARADAS_MUNICIPALES, type: 'symbol', source: fuente, 'source-layer': 'poi', minzoom: 15,
      filter: ['all', ['==', ['get', 'class'], 'bus'], ['==', ['get', 'subclass'], 'bus_stop']] as any,
      layout: {
        'icon-image': 'bus_stop',
        'icon-size': ['interpolate', ['linear'], ['zoom'], 15, 0.7, 18, 0.95],
        'icon-allow-overlap': true,
        'text-field': ['step', ['zoom'], '', 16.5, ['coalesce', ['get', 'name'], '']],
        'text-font': letra,
        'text-size': 11,
        'text-anchor': 'top',
        'text-offset': [0, 0.9],
        'text-max-width': 8,
        'text-optional': true,
      },
      paint: {
        'icon-color': '#f5a623',
        'icon-halo-color': halo,
        'icon-halo-width': 1.2,
        'text-color': dark ? '#ffd28a' : '#9a5b00',
        'text-halo-color': halo,
        'text-halo-width': 1.4,
      },
    });
  }
}

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
  // Para mapas embebidos en una página con scroll: la rueda/gesto de scroll
  // sólo hace zoom si ya se interactuó con el mapa (con un cartel avisando),
  // si no la página nunca se puede desplazar por encima del mapa.
  cooperativeGestures?: boolean;
  interactive?: boolean;
}): Promise<maplibregl.Map> {
  const map = new maplibregl.Map({
    container: opts.container,
    style: mapStyleUrl(opts.style ?? (opts.threeD ? 'streets-v2-dark' : 'dataviz-dark')),
    center: opts.center,
    zoom: opts.zoom,
    pitch: opts.pitch ?? 0,
    bearing: opts.bearing ?? 0,
    attributionControl: false,
    interactive: opts.interactive ?? true,
    cooperativeGestures: opts.cooperativeGestures ?? false,
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
      const dark = isDarkStyle(opts.style ?? (opts.threeD ? 'streets-v2-dark' : 'dataviz-dark'));
      if (opts.threeD) {
        try { enable3D(map, dark); } catch { /* el mapa sigue siendo usable en 2D */ }
      }
      // El repintado del claro va siempre, no solo con 3D: sin él queda el
      // estilo de montaña crudo de MapTiler (relieve, curvas de nivel, nombres
      // en inglés).
      if (!dark) { try { tintLightMap(map); } catch {} }
      try { soloParadasBuxci(map); } catch {}
      conEstilo.add(map);
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
            // Grises fríos claros, con salto real entre alturas. El tono frío
            // los despega del verde del terreno; más oscuros (como antes) se
            // veían como bloques pesados sobre la paleta clara tipo Google.
            : [
                'interpolate', ['linear'], ['get', 'render_height'],
                0, '#dfe2e7',
                50, '#cfd3da',
                200, '#bcc2cb',
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

// Paleta del modo claro, tomada píxel a píxel de una captura de Google Maps
// (Guanacaste, zoom ~10): el look que los pasajeros ya conocen, plano y sin
// relieve, donde lo que resalta son las carreteras y los buses.
const CLARO = {
  terreno: '#d3f7e0',
  bosque: '#c8f3d8',
  parque: '#bdf0d1',
  agua: '#90d9ed',
  ciudad: '#f6f6f6',
  arido: '#f4efe3',
  viaPrincipal: '#aabcd4',
  viaLocal: '#ffffff',
  bordeViaLocal: '#cdd4dd',
  edificio: '#e8e9ed',
  textoLugar: '#3c4043',
  textoSecundario: '#5f6368',
  textoParque: '#158860',
  textoAgua: '#1c8c9f',
  textoAeropuerto: '#1769d2',
};

// Clases de vía que van en gris azulado; el resto va en blanco con borde, como
// las calles de barrio de Google.
const VIAS_PRINCIPALES = ['motorway', 'trunk', 'primary', 'secondary'];

// Ancho por jerarquía y zoom, más `extra` píxeles (para el borde). El estilo
// original adelgaza mucho las vías a zoom medio, que es justo donde se mira
// una ciudad entera.
function anchoVia(extra = 0): any {
  const w = (mt: number, p: number, st: number, resto: number) =>
    ['match', ['get', 'class'],
      ['motorway', 'trunk'], mt + extra,
      ['primary'], p + extra,
      ['secondary', 'tertiary'], st + extra,
      resto + extra];
  return ['interpolate', ['linear'], ['zoom'],
    6, w(2.4, 1.7, 0.9, 0.9),
    10, w(5.4, 4, 2.8, 1.8),
    14, w(9.5, 7.2, 5.2, 3.4),
    18, w(21, 16, 12, 7.5),
  ];
}

// Repinta `outdoor-v2` para que se vea como Google Maps. MapTiler no ofrece un
// estilo así, pero sus capas se pueden repintar en caliente una vez cargado.
//
// `outdoor-v2` es un estilo de montaña: trae sombreado del relieve, curvas de
// nivel, acantilados, una veintena de capas de senderos y la altura de cada
// cerro. Eso es lo que lo hacía verse "en relieve" y recargado. Se apaga, y se
// conserva lo que sí suma: los parques nacionales como área verde con nombre,
// que es justo como los muestra Google.
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
  const ocultar = (id: string) => {
    try {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
    } catch {}
  };

  // ---- Relieve y montaña: fuera ----
  // Por fuente y no por nombre: así caen también los senderos de colores
  // (`Red trail`, `Via ferrata`…) que MapTiler va agregando.
  for (const layer of map.getStyle().layers || []) {
    const fuente = (layer as any)['source-layer'];
    if (
      layer.type === 'hillshade'
      || fuente === 'contour'
      || fuente === 'trail'
      || fuente === 'outdoor_poi'
      || (fuente === 'mountain_peak' && layer.type === 'line')
    ) {
      ocultar(layer.id);
    }
  }
  // Los cerros con su altura ("Cerro Pelón 300 m") son de mapa de senderismo.
  for (const id of ['Peak labels', 'Peak labels (US)', 'Volcano labels (US)', 'Outdoor shop', 'Park outline']) {
    ocultar(id);
  }

  // ---- Suelo ----
  try {
    const bg = (map.getStyle().layers || []).find(l => l.type === 'background');
    if (bg) map.setPaintProperty(bg.id, 'background-color', CLARO.terreno);
  } catch {}
  // Google pinta el campo de un solo verde: el matorral y el pasto del estilo
  // original lo llenaban de manchas sin información.
  ocultar('Scrub');
  ocultar('Grass');
  for (const id of ['Forest', 'Tree', 'Wood']) {
    paint(id, 'fill-color', CLARO.bosque);
    paint(id, 'fill-opacity', 1);
  }
  // Parques y áreas protegidas, verdes a todo zoom. El original los desvanecía
  // hasta 0.1 al acercarse, justo cuando uno está adentro de uno.
  paint('Park', 'fill-color', CLARO.parque);
  paint('Park', 'fill-opacity', 1);
  paint('Sand', 'fill-color', CLARO.arido);
  paint('Residential', 'fill-color', CLARO.ciudad);
  paint('Residential', 'fill-opacity', 1);
  for (const id of ['Industrial', 'Commercial']) {
    paint(id, 'fill-color', '#f1f3f4');
    paint(id, 'fill-opacity', 1);
  }
  paint('Aeroway', 'fill-color', '#e8eaed');
  paint('Building', 'fill-color', CLARO.edificio);
  paint('Building', 'fill-outline-color', '#d7d9de');

  // ---- Agua ----
  paint('Water', 'fill-color', CLARO.agua);
  paint('Water', 'fill-opacity', 1);
  paint('River', 'line-color', CLARO.agua);
  // A escala de provincia, las líneas de río llenaban el mapa de rayitas
  // celestes. No se pueden separar ríos de quebradas: a zoom bajo MapTiler
  // marca todo con class "river". Se hace como Google: aparecen al acercarse,
  // donde sí sirven para ubicarse. Los cauces anchos (el Tempisque, los
  // esteros) siguen visibles a todo zoom porque vienen como polígono de `Water`.
  paint('River', 'line-opacity', [
    'interpolate', ['linear'], ['zoom'],
    11, 0,
    12.5, 1,
  ]);
  paint('River', 'line-width', [
    'interpolate', ['linear'], ['zoom'],
    8, 1,
    12, 2,
    16, 4,
  ]);

  // ---- Carreteras ----
  // `Road network` es UNA sola capa para toda la red, así que un color plano
  // pintaría igual hasta el último callejón. Se usa el atributo `class` del
  // esquema OpenMapTiles para conservar la jerarquía: gris azulado en las vías
  // importantes, blanco en las calles de barrio.
  paint('Road network', 'line-color', [
    'match', ['get', 'class'],
    VIAS_PRINCIPALES, CLARO.viaPrincipal,
    CLARO.viaLocal,
  ]);
  paint('Road network', 'line-width', anchoVia());
  paint('Bridge', 'fill-color', '#e8ecf1');

  // Las calles blancas necesitan un borde para separarse del terreno claro; las
  // principales no, su gris azulado ya contrasta (Google tampoco se lo pone).
  addRoadCasing(map);

  // ---- Etiquetas ----
  etiquetasEnEspanol(map);
  const texto = (id: string, color: string, halo = '#ffffff') => {
    paint(id, 'text-color', color);
    paint(id, 'text-halo-color', halo);
  };
  for (const id of ['City labels', 'Town labels', 'Village labels']) {
    texto(id, CLARO.textoLugar);
    paint(id, 'text-halo-width', 1.5);
    // Sin el puntito al lado del nombre del pueblo, como en Google.
    paint(id, 'icon-opacity', 0);
  }
  texto('Place labels', CLARO.textoSecundario);
  texto('Road labels', CLARO.textoSecundario);
  for (const id of ['National park labels', 'Protected area labels', 'Park labels']) {
    texto(id, CLARO.textoParque);
    paint(id, 'icon-color', CLARO.textoParque);
  }
  for (const id of ['Ocean labels', 'Sea labels', 'Lake labels', 'Lakeline labels', 'River labels']) {
    texto(id, CLARO.textoAgua, 'rgba(255, 255, 255, 0)');
  }
  texto('Airport labels', CLARO.textoAeropuerto);
  paint('Airport labels', 'icon-color', CLARO.textoAeropuerto);
  // El volcán se queda (en Costa Rica orienta), pero sin la altura.
  texto('Volcano labels', CLARO.textoSecundario);
  try {
    if (map.getLayer('Volcano labels')) {
      map.setLayoutProperty('Volcano labels', 'text-field', ['coalesce', ['get', 'name:es'], ['get', 'name']]);
    }
  } catch {}
}

// MapTiler etiqueta en inglés ("Gulf of Papagayo", "Santa Rosa National Park").
// Se pide el nombre en español y, si el lugar no lo tiene, el nombre local, que
// en Costa Rica ya es español. Se reescribe la expresión de cada capa en vez de
// una lista fija de ids para que sirva con cualquier estilo de MapTiler.
export function etiquetasEnEspanol(map: maplibregl.Map): void {
  for (const layer of map.getStyle().layers || []) {
    if (layer.type !== 'symbol') continue;
    try {
      const campo = map.getLayoutProperty(layer.id, 'text-field');
      if (campo == null) continue;
      let nuevo: any;
      if (campo === '{name:en}') {
        nuevo = ['coalesce', ['get', 'name:es'], ['get', 'name']];
      } else {
        const json = JSON.stringify(campo);
        if (!json.includes('"name:en"')) continue;
        nuevo = JSON.parse(json.split('"name:en"').join('"name:es"'));
      }
      map.setLayoutProperty(layer.id, 'text-field', nuevo);
    } catch { /* capa sin texto o expresión que no se pudo reescribir */ }
  }
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
        // Solo las calles que van en blanco: sin borde, blanco sobre verde claro
        // se lee como una mancha y no como una calle.
        filter: ['match', ['get', 'class'], ['tertiary', 'minor', 'service'], true, false],
        minzoom: 11,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': CLARO.bordeViaLocal,
          'line-width': anchoVia(1.6),
        },
      },
      'Road network',
    );
  } catch { /* si el estilo cambia de estructura, el mapa sigue sin el contorno */ }
}

// "Tipo de mapa" del pasajero, con los nombres del menú Capas de Google Maps:
// Predeterminado (plano) o Relieve (sombreado del terreno y curvas de nivel).
export type TipoMapa = 'predeterminado' | 'relieve';

const RELIEVE_SOURCE = 'buxi-relieve-dem';
const RELIEVE_LAYER = 'buxi-relieve';

// Prende o apaga el relieve sin recargar el estilo. Va después de tintLightMap,
// que es el que lo apaga por defecto en el modo claro.
//
// El sombreado es propio y no el `Hillshade` de outdoor-v2 para que funcione
// igual en el modo oscuro, cuyo estilo no trae relieve. Usa su propio DEM, y no
// 'terrain-dem' del 3D, porque compartir la fuente entre el terreno 3D y el
// sombreado baja la calidad del render (es lo que recomienda MapLibre).
//
// setStyle borra fuentes y capas propias: quien cambia de tema tiene que
// volver a llamarla.
export function setRelieve(map: maplibregl.Map, on: boolean, dark: boolean): void {
  try {
    if (on) {
      if (!map.getSource(RELIEVE_SOURCE)) {
        map.addSource(RELIEVE_SOURCE, { type: 'raster-dem', url: TERRAIN_DEM_URL(), tileSize: 256 });
      }
      if (!map.getLayer(RELIEVE_LAYER)) {
        // Debajo de parques y agua: el sombreado tiñe el terreno, no el mar.
        const antes = ['Park', 'Water'].find(id => map.getLayer(id));
        map.addLayer({
          id: RELIEVE_LAYER,
          type: 'hillshade',
          source: RELIEVE_SOURCE,
          paint: dark
            ? {
                'hillshade-exaggeration': 0.45,
                'hillshade-shadow-color': '#000000',
                'hillshade-highlight-color': '#2c3e5c',
                'hillshade-accent-color': '#0d1726',
              }
            // Sombras verde grisáceo: con negro, el verde menta se ensucia.
            : {
                'hillshade-exaggeration': 0.35,
                'hillshade-shadow-color': '#4f6b5a',
                'hillshade-highlight-color': '#ffffff',
                'hillshade-accent-color': '#6f8a78',
              },
        }, antes);
      }
    } else if (map.getLayer(RELIEVE_LAYER)) {
      map.removeLayer(RELIEVE_LAYER);
    }
  } catch { /* sin DEM el mapa sigue funcionando, solo que plano */ }

  // Curvas de nivel y cerros con su altura: solo existen en outdoor-v2 (modo
  // claro). En el oscuro este bucle no encuentra nada.
  for (const layer of map.getStyle().layers || []) {
    if ((layer as any)['source-layer'] === 'contour' || layer.id === 'Peak labels') {
      try { map.setLayoutProperty(layer.id, 'visibility', on ? 'visible' : 'none'); } catch {}
    }
  }
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
): Feature<Polygon> {
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

// Distancia mínima (en metros) de un punto a una polilínea, proyectando sobre
// cada segmento en un plano métrico local (suficiente para tramos de unos
// pocos km, que es la escala de una ruta de bus). Se usa para detectar si un
// bus se alejó de su ruta trazada. `line` y el punto van en [lng, lat].
export function distanceToPolylineMeters(lng: number, lat: number, line: [number, number][]): number {
  if (line.length < 2) return Infinity;
  const latRad = (lat * Math.PI) / 180;
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos(latRad);
  const px = lng * mPerDegLng;
  const py = lat * mPerDegLat;

  let minDist = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const x1 = line[i][0] * mPerDegLng, y1 = line[i][1] * mPerDegLat;
    const x2 = line[i + 1][0] * mPerDegLng, y2 = line[i + 1][1] * mPerDegLat;
    const dx = x2 - x1, dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const cx = x1 + t * dx, cy = y1 + t * dy;
    const dist = Math.hypot(px - cx, py - cy);
    if (dist < minDist) minDist = dist;
  }
  return minDist;
}

// Crea un elemento HTML para usar como marcador custom (MapLibre no tiene
// divIcon como Leaflet; se le pasa un HTMLElement directo).
export function htmlMarkerEl(className: string, innerHtml: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = className;
  el.innerHTML = innerHtml;
  return el;
}
