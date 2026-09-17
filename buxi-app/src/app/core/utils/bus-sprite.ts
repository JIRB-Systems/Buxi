import type * as maplibregl from 'maplibre-gl';

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
  if (!sprites) return id;

  const L = SPRITE_CELDA;
  const sx = (dir % 4) * L, sy = Math.floor(dir / 4) * L;
  const c = document.createElement('canvas');
  c.width = L; c.height = L;
  const ctx = c.getContext('2d');
  if (!ctx) return id;

  // 1) la carrocería, blanca pero con el sombreado del render 3D
  ctx.drawImage(sprites.body, sx, sy, L, L, 0, 0, L, L);
  // 2) multiply: el blanco toma el color de la ruta y las sombras sobreviven,
  //    que es lo que le da volumen (un relleno plano lo aplastaría)
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, L, L);
  // 3) el multiply pinta el cuadro entero: se recorta contra el alfa del bus
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(sprites.body, sx, sy, L, L, 0, 0, L, L);
  // 4) y encima los detalles, sin teñir
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(sprites.det, sx, sy, L, L, 0, 0, L, L);

  try {
    map.addImage(id, ctx.getImageData(0, 0, L, L), { pixelRatio: 3 });
    registrados.add(id);
  } catch { /* ya estaba registrada */ }
  return id;
}
