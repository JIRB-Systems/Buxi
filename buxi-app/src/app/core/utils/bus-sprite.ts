import type * as maplibregl from 'maplibre-gl';
import { MODELO_BUS_DEFECTO, ModeloBus, esModeloBus, svgBus } from './bus-modelos';

// El bus que se ve en el mapa no es un ícono plano: son dos hojas de sprites
// renderizadas del modelo 3D de Blender (diseno/bus_buxi.blend), con 16
// direcciones cada una. Una trae la carrocería blanca con su sombreado y la
// otra los detalles — vidrios, ruedas, luces — que no se tiñen.
//
// Vive acá y no dentro de una página porque lo usan el mapa del pasajero y el
// del chofer, y tienen que verse IGUAL. Con una copia en cada uno, el día que
// alguien retoque el de una pantalla la otra se queda vieja y nadie se entera
// hasta que lo nota un usuario.
export const SPRITE_N = 16;
export const SPRITE_CELDA = 126;

export interface SpritesBus {
  body: HTMLImageElement;
  det: HTMLImageElement;
}

// Una sola carga para toda la app, cacheada a nivel de módulo: son dos PNG de
// ~300 KB entre los dos y los quieren las dos pantallas. Si el chofer entra
// después de haber estado en el mapa, ya están.
let cargaEnCurso: Promise<SpritesBus | null> | null = null;

export function cargarSpritesBus(): Promise<SpritesBus | null> {
  if (cargaEnCurso) return cargaEnCurso;
  const carga = (src: string) => new Promise<HTMLImageElement>((ok, fail) => {
    const im = new Image();
    im.onload = () => ok(im);
    im.onerror = () => fail(new Error(src));
    im.src = src;
  });
  cargaEnCurso = Promise.all([
    carga('assets/bus/bus_body_sheet.png'),
    carga('assets/bus/bus_det_sheet.png'),
  ])
    .then(([body, det]) => ({ body, det }))
    .catch(() => {
      // El fallo NO se cachea: si fue pasajero (red, arranque a medias), el
      // próximo mapa que los pida vuelve a intentarlo. Cachearlo dejaría la
      // app sin buses hasta recargarla entera.
      cargaEnCurso = null;
      // Sin sprites no se dibuja el bus, pero el mapa sigue siendo usable:
      // cada pantalla decide si tiene un ícono de reserva o si no pinta nada.
      return null;
    });
  return cargaEnCurso;
}

// Índice de sprite según el rumbo. Se le RESTA la rotación del mapa: el sprite
// está dibujado en espacio de pantalla, así que si el usuario gira el mapa el
// bus tiene que girar con él o quedaría apuntando a cualquier lado.
export function dirDeSprite(heading: number, bearingMapa: number): number {
  const rel = (((heading || 0) - bearingMapa) % 360 + 360) % 360;
  return Math.round(rel / (360 / SPRITE_N)) % SPRITE_N;
}

// Medio paso de sprite. Girar el mapa dispara 'rotate' decenas de veces por
// gesto, pero solo importa cuando se cruza este umbral: por debajo, el sprite
// elegido sería el mismo y el trabajo iría a la basura.
export const SPRITE_PASO_MEDIO = (360 / SPRITE_N) / 2;

// Devuelve el bus de esa dirección teñido de ese color, en un canvas suelto.
//
// Separado de registrarIconoBus porque no todos los usos tienen un mapa: la
// vista previa de Personalización, en el panel de empresa, necesita dibujar
// el bus en un <canvas> para que la empresa vea el color que está eligiendo
// antes de guardarlo. Es el mismo teñido, así que la previa no puede mentir
// sobre cómo va a quedar en el mapa.
export function tintarSpriteBus(
  sprites: SpritesBus | null,
  color: string,
  dir: number,
): HTMLCanvasElement | null {
  if (!sprites) return null;
  const L = SPRITE_CELDA;
  const sx = (dir % 4) * L, sy = Math.floor(dir / 4) * L;
  const c = document.createElement('canvas');
  c.width = L; c.height = L;
  const ctx = c.getContext('2d');
  if (!ctx) return null;

  // 1) la carrocería, blanca pero con el sombreado del render 3D
  ctx.drawImage(sprites.body, sx, sy, L, L, 0, 0, L, L);
  // 2) multiply: el blanco toma el color y las sombras sobreviven, que es lo
  //    que le da volumen (un relleno plano lo aplastaría)
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, L, L);
  // 3) el multiply pinta el cuadro entero: se recorta contra el alfa del bus
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(sprites.body, sx, sy, L, L, 0, 0, L, L);
  // 4) y encima los detalles, sin teñir
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(sprites.det, sx, sy, L, L, 0, 0, L, L);
  return c;
}

// Registra (o reutiliza) la imagen del bus en ese color y esa dirección, y
// devuelve el id para usar en 'icon-image'. `registrados` es el set de la
// pantalla que llama: las imágenes viven en el mapa, y cada mapa es suyo.
export function registrarIconoBus(
  map: maplibregl.Map,
  sprites: SpritesBus | null,
  color: string,
  dir: number,
  registrados: Set<string>,
): string {
  const id = `bus-${color.replace('#', '')}-${dir}`;
  if (registrados.has(id)) return id;

  const c = tintarSpriteBus(sprites, color, dir);
  const ctx = c?.getContext('2d');
  if (!c || !ctx) return id;

  try {
    map.addImage(id, ctx.getImageData(0, 0, c.width, c.height), { pixelRatio: 3 });
    registrados.add(id);
  } catch { /* ya estaba registrada */ }
  return id;
}

// ---- EN 2D: EL BUS VISTO DESDE ARRIBA ----
//
// Los sprites de arriba son isométricos: están pensados para la cámara
// inclinada del 3D. Con el mapa plano, que se mira derecho para abajo, el bus
// parecía un juguete parado de costado sobre la calle. En 2D va la vista de
// arriba de bus-modelos (la misma que la empresa ve en Personalización, con
// el modelo que eligió) y la gira MapLibre con icon-rotate según el rumbo: un
// dibujo cenital sí se puede rotar sin que se tuerza.
//
// Una imagen por modelo y color, no 16: el rumbo lo pone icon-rotate. Pasar
// un SVG a imagen es asíncrono, así que la primera vez devuelve null y avisa
// con `alCargar` cuando ya se puede registrar. Mientras tanto (o si falla) el
// que llama usa el sprite isométrico.
const PLANO_ESCALA = 0.36;            // px de pantalla por unidad del dibujo
// Nitidez: 3 px por px de pantalla (teléfonos de alta densidad) multiplicado
// por cuánto llega a agrandarse con el zoom (ver ESCALA_PLANO). Con menos, el
// bus de cerca se ve borroso, que es justo cuando se lo quiere mirar.
const PLANO_PR = 8;
const PLANO_ANCHO = 34, PLANO_ALTO = 184; // el recorte de svgBus(…, 'arriba')

// Compartido por todos los mapas: el dibujo no depende del mapa, solo el
// registro. null = no se pudo dibujar (no se reintenta: un SVG propio que no
// decodifica no va a decodificar la segunda vez).
const planos = new Map<string, ImageData | null>();
const esperandoPlano = new Map<string, Set<() => void>>();

export const PREFIJO_ICONO_PLANO = 'bus-plano-';

function rasterizarPlano(clave: string, modelo: ModeloBus, color: string, alCargar: () => void): void {
  const espera = esperandoPlano.get(clave);
  if (espera) { espera.add(alCargar); return; }
  esperandoPlano.set(clave, new Set([alCargar]));

  const terminar = (datos: ImageData | null) => {
    planos.set(clave, datos);
    const avisar = esperandoPlano.get(clave);
    esperandoPlano.delete(clave);
    avisar?.forEach(f => { try { f(); } catch { /* el aviso es de otra pantalla */ } });
  };

  const w = Math.round(PLANO_ANCHO * PLANO_ESCALA * PLANO_PR);
  const h = Math.round(PLANO_ALTO * PLANO_ESCALA * PLANO_PR);
  // Medidas fijas en vez del 100% de svgBus: un SVG sin tamaño propio no se
  // dibuja en un canvas en todos los navegadores.
  const svg = svgBus(modelo, 'arriba', color).replace('width="100%" height="100%"', `width="${w}" height="${h}"`);
  const im = new Image();
  im.onload = () => {
    try {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      if (!ctx) { terminar(null); return; }
      ctx.drawImage(im, 0, 0, w, h);
      terminar(ctx.getImageData(0, 0, w, h));
    } catch {
      terminar(null);
    }
  };
  im.onerror = () => terminar(null);
  im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

// Registra (o reutiliza) el bus visto desde arriba en ese modelo y color, y
// devuelve el id para 'icon-image'; null si todavía no está listo.
export function registrarIconoPlano(
  map: maplibregl.Map,
  modelo: string | null | undefined,
  color: string,
  registrados: Set<string>,
  alCargar: () => void,
): string | null {
  const m: ModeloBus = esModeloBus(modelo) ? modelo : MODELO_BUS_DEFECTO;
  const clave = `${m}-${color.replace('#', '').toLowerCase()}`;
  const id = PREFIJO_ICONO_PLANO + clave;
  if (registrados.has(id)) return id;

  const datos = planos.get(clave);
  if (datos === undefined) { rasterizarPlano(clave, m, color, alCargar); return null; }
  if (datos === null) return null;
  try {
    if (!map.hasImage(id)) map.addImage(id, datos, { pixelRatio: PLANO_PR });
    registrados.add(id);
    return id;
  } catch {
    return null;
  }
}

// Cómo se apoya el ícono del bus en el mapa según la vista. En 3D el sprite
// isométrico va parado frente a la cámara, anclado abajo (las ruedas sobre el
// punto), y el rumbo ya viene dibujado. En 2D el cenital va acostado sobre el
// mapa, centrado en el punto y girado con el rumbo de cada bus ('rot').
export function layoutIconoBus(is3D: boolean): Record<string, any> {
  return is3D
    ? {
      'icon-size': escalaBus(true),
      'icon-rotate': 0,
      'icon-rotation-alignment': 'viewport',
      'icon-pitch-alignment': 'viewport',
      'icon-anchor': 'bottom',
    }
    : {
      'icon-size': escalaBus(false),
      'icon-rotate': ['coalesce', ['get', 'rot'], 0],
      'icon-rotation-alignment': 'map',
      'icon-pitch-alignment': 'map',
      'icon-anchor': 'center',
    };
}

export function aplicarLayoutIconoBus(map: maplibregl.Map, capa: string, is3D: boolean): void {
  if (!map.getLayer(capa)) return;
  for (const [k, v] of Object.entries(layoutIconoBus(is3D))) {
    try { map.setLayoutProperty(capa, k, v); } catch { /* capa de otro tipo */ }
  }
}

// ---- EL BUS CRECE AL ACERCARSE ----
//
// Con un tamaño fijo, el bus de cerca quedaba igual de chico que de lejos y
// el diseño (vidrios, techo, el modelo que eligió la empresa) no se llegaba a
// ver. Desde zoom 15 crece. El de arriba crece más que el isométrico: está
// dibujado a mayor resolución (PLANO_PR) y el isométrico sale de renders de
// 126 px, que agrandados de más se ven borrosos.
const ESCALA_PLANO: [number, number][] = [[15, 1], [17, 1.45], [19, 2.2], [20, 2.6]];
const ESCALA_ISO: [number, number][] = [[15, 1], [17, 1.3], [19, 1.7], [20, 1.9]];

// Cualquier medida que dependa del tamaño del bus (el halo, lo que se escribe
// al lado) siguiendo la misma curva. Los arreglos (text-offset) van como
// literal, que es lo que pide MapLibre dentro de una interpolación.
export function segunEscalaBus(is3D: boolean, valor: (escala: number) => number | number[]): any {
  const pasos = (is3D ? ESCALA_ISO : ESCALA_PLANO).flatMap(([z, e]) => {
    const v = valor(e);
    return [z, Array.isArray(v) ? ['literal', v.map(n => +n.toFixed(2))] : +v.toFixed(2)];
  });
  return ['interpolate', ['linear'], ['zoom'], ...pasos];
}

export function escalaBus(is3D: boolean): any {
  return segunEscalaBus(is3D, e => e);
}
