// Tiempo de llegada de un bus a una parada, medido sobre el recorrido.
//
// Antes se calculaba con la distancia en línea recta entre el bus y la parada
// y una velocidad fija de 20 km/h, sin mirar hacia dónde iba el bus. Tres
// errores salían de ahí:
//   - un bus que ya había pasado la parada seguía contando como "llega en 1 min";
//   - en una ruta con curvas, o que da la vuelta, la línea recta se quedaba
//     corta y el tiempo también;
//   - daba lo mismo un bus en la autopista que uno en una presa.
//
// Acá el bus y la parada se ubican sobre el trazado de la ruta ("kilómetro
// 3,2 de 21"), se mira en qué sentido va el bus y se usa su velocidad real.
//
// Son funciones puras, sin Angular ni mapa, para poder probarlas solas.

/** [latitud, longitud], como guarda la base el trazado de cada ruta. */
export type LatLng = [number, number];

export interface Proyeccion {
  /** Kilómetros desde el inicio del trazado hasta el punto más cercano. */
  km: number;
  /** Qué tan lejos del trazado está el punto, en km. */
  desvioKm: number;
  /** Rumbo del trazado en ese punto, en grados (0 = norte, sentido horario). */
  rumbo: number;
}

export type Sentido = 1 | -1;

export type EstadoLlegada = 'viene' | 'llegando' | 'ya_paso' | 'fuera_de_ruta';

export interface Llegada {
  estado: EstadoLlegada;
  /** Minutos hasta la parada. Solo con 'viene' (>= 1) y 'llegando' (0). */
  minutos: number | null;
  /** Distancia por el recorrido hasta la parada, en km. */
  distanciaKm: number | null;
}

// Más lejos que esto del trazado, el bus no está haciendo esta ruta (o se
// desvió): no tiene sentido prometer una hora de llegada.
export const FUERA_DE_RUTA_KM = 0.3;
// Margen para "ya pasó": el GPS y la proyección bailan unos metros, y un bus
// detenido justo en la parada no debe contarse como que se fue.
const YA_PASO_KM = 0.05;
// A menos de esto, está llegando.
const LLEGANDO_KM = 0.06;
// Lo que un bus pierde en cada parada intermedia, en segundos.
const DEMORA_POR_PARADA_S = 25;
// La velocidad que reporta un bus puede ser un pico (bajando una cuesta) o
// casi cero (saliendo de una parada). Se acota a lo que un bus sostiene.
const VEL_MIN_KMH = 12;
const VEL_MAX_KMH = 60;
/** Velocidad en movimiento que se asume cuando el bus todavía no reportó ninguna. */
export const VEL_URBANA_KMH = 25;

const KM_POR_GRADO_LAT = 110.574;
const KM_POR_GRADO_LNG = 111.32;
const RAD = Math.PI / 180;

/** El recorrido de una ruta, listo para ubicar puntos sobre él. */
export class TrazadoRuta {
  private readonly pts: LatLng[] = [];
  /** Kilómetros acumulados hasta cada punto. */
  private readonly acum: number[] = [];
  readonly largoKm: number;

  constructor(coords: LatLng[]) {
    for (const c of coords) {
      if (!c || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
      const ultimo = this.pts[this.pts.length - 1];
      if (ultimo && ultimo[0] === c[0] && ultimo[1] === c[1]) continue;
      this.acum.push(ultimo ? this.acum[this.acum.length - 1] + distanciaKm(ultimo, c) : 0);
      this.pts.push(c);
    }
    this.largoKm = this.acum.length ? this.acum[this.acum.length - 1] : 0;
  }

  get valido(): boolean {
    return this.pts.length >= 2 && this.largoKm > 0;
  }

  /**
   * El punto del trazado más cercano a (lat, lng).
   *
   * `pistaKm` desempata cuando el trazado pasa dos veces por la misma calle
   * (rutas de ida y vuelta dibujadas en una sola línea): entre los puntos casi
   * igual de cercanos gana el que queda más cerca de esa pista, que es el
   * avance que el bus tenía en su lectura anterior.
   */
  proyectar(lat: number, lng: number, pistaKm?: number): Proyeccion {
    if (!this.valido) return { km: 0, desvioKm: Infinity, rumbo: 0 };

    // Cerca de un punto la Tierra es plana: se trabaja en km sobre un plano
    // centrado en el punto que se busca. Evita trigonometría por tramo.
    const kx = KM_POR_GRADO_LNG * Math.cos(lat * RAD);
    const candidatos: { km: number; d: number; i: number }[] = [];
    let mejor = Infinity;

    for (let i = 0; i < this.pts.length - 1; i++) {
      const a = this.pts[i], b = this.pts[i + 1];
      const ax = (a[1] - lng) * kx, ay = (a[0] - lat) * KM_POR_GRADO_LAT;
      const bx = (b[1] - lng) * kx, by = (b[0] - lat) * KM_POR_GRADO_LAT;
      const dx = bx - ax, dy = by - ay;
      const largo2 = dx * dx + dy * dy;
      // Fracción del tramo donde cae la perpendicular, acotada a sus extremos.
      const t = largo2 === 0 ? 0 : Math.min(1, Math.max(0, -(ax * dx + ay * dy) / largo2));
      const d = Math.hypot(ax + t * dx, ay + t * dy);
      if (d < mejor) mejor = d;
      candidatos.push({ km: this.acum[i] + t * (this.acum[i + 1] - this.acum[i]), d, i });
    }

    // Sin pista gana el más cercano. Con pista, entre los que están a menos
    // de 30 m del mejor, el más próximo al avance anterior.
    const TOLERANCIA_KM = 0.03;
    let elegido = candidatos[0];
    let hay = false;
    for (const c of candidatos) {
      if (pistaKm === undefined) {
        if (!hay || c.d < elegido.d) { elegido = c; hay = true; }
        continue;
      }
      if (c.d > mejor + TOLERANCIA_KM) continue;
      if (!hay || Math.abs(c.km - pistaKm) < Math.abs(elegido.km - pistaKm)) { elegido = c; hay = true; }
    }

    return {
      km: elegido.km,
      desvioKm: elegido.d,
      rumbo: rumboEntre(this.pts[elegido.i], this.pts[elegido.i + 1]),
    };
  }
}

/** Distancia entre dos puntos, en km (haversine). */
export function distanciaKm(a: LatLng, b: LatLng): number {
  const dLat = (b[0] - a[0]) * RAD, dLng = (b[1] - a[1]) * RAD;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(x));
}

/** Rumbo de a hacia b, en grados (0 = norte, sentido horario). */
export function rumboEntre(a: LatLng, b: LatLng): number {
  const y = Math.sin((b[1] - a[1]) * RAD) * Math.cos(b[0] * RAD);
  const x = Math.cos(a[0] * RAD) * Math.sin(b[0] * RAD) -
    Math.sin(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.cos((b[1] - a[1]) * RAD);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

/**
 * En qué sentido recorre el bus el trazado: 1 = del inicio hacia el final,
 * -1 = de vuelta. Sale de comparar su rumbo con el del trazado donde está.
 *
 * Devuelve null si el rumbo no sirve. El de un GPS quieto apunta a cualquier
 * lado, así que quien llama solo debería confiar en esto con el bus andando.
 */
export function sentidoSegunRumbo(rumboBus: number | null | undefined, rumboTrazado: number): Sentido | null {
  if (rumboBus === null || rumboBus === undefined || !Number.isFinite(rumboBus)) return null;
  const diferencia = Math.abs(((rumboBus - rumboTrazado) % 360 + 540) % 360 - 180);
  return diferencia <= 90 ? 1 : -1;
}

/**
 * Promedio móvil de la velocidad del bus MIENTRAS SE MUEVE. Las lecturas con
 * el bus detenido no entran: lo que se pierde en las paradas se cuenta aparte
 * (ver estimarLlegada), y mezclarlas hundiría el promedio dos veces.
 */
export function suavizarVelocidad(previa: number | undefined, lecturaKmh: number | null | undefined): number | undefined {
  if (lecturaKmh === null || lecturaKmh === undefined || !Number.isFinite(lecturaKmh) || lecturaKmh <= 5) return previa;
  return previa === undefined ? lecturaKmh : previa * 0.7 + lecturaKmh * 0.3;
}

export function estimarLlegada(o: {
  /** Avance del bus sobre el trazado, en km. */
  kmBus: number;
  /** Dónde está la parada sobre el trazado, en km. */
  kmParada: number;
  sentido: Sentido;
  /** Qué tan lejos del trazado está el bus. */
  desvioKm: number;
  /** Velocidad del bus en movimiento; sin dato se asume la urbana. */
  velocidadKmh?: number;
  /** Paradas que el bus todavía tiene que hacer antes de esta. */
  paradasEnMedio?: number;
}): Llegada {
  if (o.desvioKm > FUERA_DE_RUTA_KM) return { estado: 'fuera_de_ruta', minutos: null, distanciaKm: null };

  // Positivo = la parada está adelante, en el sentido en que va el bus.
  const adelante = (o.kmParada - o.kmBus) * o.sentido;
  if (adelante < -YA_PASO_KM) return { estado: 'ya_paso', minutos: null, distanciaKm: null };

  const distancia = Math.max(0, adelante);
  if (distancia <= LLEGANDO_KM) return { estado: 'llegando', minutos: 0, distanciaKm: distancia };

  const vel = Math.min(VEL_MAX_KMH, Math.max(VEL_MIN_KMH, o.velocidadKmh ?? VEL_URBANA_KMH));
  const minutos = (distancia / vel) * 60 + ((o.paradasEnMedio ?? 0) * DEMORA_POR_PARADA_S) / 60;
  return { estado: 'viene', minutos: Math.max(1, Math.round(minutos)), distanciaKm: distancia };
}
