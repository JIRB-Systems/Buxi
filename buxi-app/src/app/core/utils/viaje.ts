// "¿A dónde vas?": con dónde está el pasajero y a dónde quiere ir, qué ruta
// tomar, en qué parada subir, en cuál bajar y cuánto caminar.
//
// Primero los viajes directos, en un bus. Para cada ruta se prueban todos los
// pares de paradas (subir, bajar) y se queda el que menos tarda entre caminar
// hasta la parada, ir en el bus y caminar hasta el destino. Con las pocas
// decenas de paradas que tiene una ruta, probarlos todos es más simple y más
// seguro que cualquier atajo.
//
// Si ningún bus directo sirve, se buscan viajes con un transbordo: un bus,
// una caminata corta hasta la parada de otra ruta y un segundo bus (ver
// planificarTransbordos).
//
// Se asume que los buses recorren la ruta en los dos sentidos (ida y vuelta),
// igual que el cálculo de llegadas (ver eta.ts).
//
// Son funciones puras, sin Angular ni mapa, para poder probarlas solas.

import { DEMORA_POR_PARADA_S, LatLng, Sentido, VEL_URBANA_KMH, distanciaKm } from './eta';

export interface ParadaEnRuta {
  id: string;
  lat: number;
  lng: number;
  /** Dónde está la parada sobre el trazado de su ruta, en km desde el inicio. */
  km: number;
}

export interface RutaParaViaje {
  id: string;
  paradas: ParadaEnRuta[];
}

export interface OpcionViaje {
  rutaId: string;
  subirId: string;
  bajarId: string;
  /** 1 = el bus va del inicio al final del trazado; -1 = de vuelta. */
  sentido: Sentido;
  /** En línea recta, del pasajero a la parada donde sube. */
  alSubirKm: number;
  /** En línea recta, de la parada donde baja al destino. */
  alDestinoKm: number;
  enBusKm: number;
  /** Paradas que el bus hace entre la de subir y la de bajar. */
  paradasEnMedio: number;
  minutosAlSubir: number;
  minutosEnBus: number;
  minutosAlDestino: number;
  /**
   * Sin la espera del primer bus, que depende de cuándo pase. Con transbordo
   * incluye todo: el segundo bus, su margen de espera y la última caminata.
   */
  minutosTotal: number;
  /**
   * El segundo bus, si el viaje tiene transbordo. En ese caso los campos de
   * arriba son el primer tramo: `bajarId` es donde se deja el primer bus y
   * `alDestinoKm`/`minutosAlDestino` son la caminata hasta la otra parada.
   */
  transbordo?: TramoTransbordo;
}

export interface TramoTransbordo {
  rutaId: string;
  subirId: string;
  bajarId: string;
  sentido: Sentido;
  enBusKm: number;
  paradasEnMedio: number;
  /** Margen para esperar el segundo bus, que tampoco se sabe cuándo pasa. */
  minutosEspera: number;
  minutosEnBus: number;
  /** De la parada donde se baja del segundo bus al destino. */
  alDestinoKm: number;
  minutosAlDestino: number;
}

/** Por qué no hay ningún viaje en bus que ofrecer. */
export type SinViaje =
  | 'cerca'                // se llega antes caminando
  | 'sin_parada_origen'    // ninguna parada cerca del pasajero
  | 'sin_parada_destino'   // ninguna parada cerca del destino
  | 'sin_ruta_directa';    // hay paradas en las dos puntas, pero ninguna ruta las une, ni con un transbordo

export interface PlanViaje {
  opciones: OpcionViaje[];
  /** Ir caminando de punta a punta, como referencia. */
  aPie: { metros: number; minutos: number };
  motivo: SinViaje | null;
  /** La parada más cercana a cada punta, en km (null si no hay paradas). */
  paradaOrigenKm: number | null;
  paradaDestinoKm: number | null;
}

/** Más lejos que esto de una parada, en línea recta, no se propone caminar. */
export const CAMINATA_MAX_KM = 2.5;
// Menos que esto en el bus no es un viaje: es esperar un bus para una cuadra.
const TRAMO_MIN_KM = 0.3;
// Lo que se le da de ventaja a caminar por la espera del bus, que no se conoce.
const ESPERA_MIN = 5;
// Un minuto caminando pesa más que uno sentado: entre dos opciones que tardan
// casi lo mismo se prefiere la que hace caminar menos.
const PESO_CAMINAR = 1.5;
// Hasta acá, sin bus que sirva, se dice "queda cerca".
const CERCA_MIN = 30;
// Transbordo: hasta cuánto se camina entre las dos paradas (unas 5 cuadras)
// y cuánto se calcula para esperar el segundo bus.
export const TRANSBORDO_MAX_KM = 0.4;
const ESPERA_TRANSBORDO_MIN = 8;

/**
 * Lo que se tarda caminando una distancia medida en línea recta. Por calles
 * se camina alrededor de un 30 % más, a unos 4,5 km/h. Es la estimación que
 * se muestra mientras no se pidió el camino real al enrutador.
 */
export function caminataEstimada(lineaRectaKm: number): { metros: number; minutos: number } {
  const metros = Math.round(lineaRectaKm * 1000 * 1.3);
  return { metros, minutos: Math.max(1, Math.round(metros / 75)) };
}

export function planificarViaje(origen: LatLng, destino: LatLng, rutas: RutaParaViaje[], maximo = 3): PlanViaje {
  const aPie = caminataEstimada(distanciaKm(origen, destino));
  const opciones: (OpcionViaje & { costo: number })[] = [];
  let paradaOrigenKm: number | null = null;
  let paradaDestinoKm: number | null = null;

  for (const ruta of rutas) {
    // Las distancias a pie de cada parada se calculan una sola vez por ruta.
    const paradas = ruta.paradas.map(p => ({
      p,
      alOrigen: distanciaKm(origen, [p.lat, p.lng]),
      alDestino: distanciaKm([p.lat, p.lng], destino),
    }));
    for (const x of paradas) {
      if (paradaOrigenKm === null || x.alOrigen < paradaOrigenKm) paradaOrigenKm = x.alOrigen;
      if (paradaDestinoKm === null || x.alDestino < paradaDestinoKm) paradaDestinoKm = x.alDestino;
    }

    let mejor: (OpcionViaje & { costo: number }) | null = null;
    for (const a of paradas) {
      if (a.alOrigen > CAMINATA_MAX_KM) continue;
      for (const b of paradas) {
        if (b.p.id === a.p.id || b.alDestino > CAMINATA_MAX_KM) continue;
        const enBusKm = Math.abs(b.p.km - a.p.km);
        if (enBusKm < TRAMO_MIN_KM) continue;

        const desde = Math.min(a.p.km, b.p.km), hasta = Math.max(a.p.km, b.p.km);
        let enMedio = 0;
        for (const c of paradas) if (c.p.km > desde + 0.03 && c.p.km < hasta - 0.03) enMedio++;

        const alSubir = caminataEstimada(a.alOrigen).minutos;
        const alDestino = caminataEstimada(b.alDestino).minutos;
        const enBus = Math.max(1, Math.round((enBusKm / VEL_URBANA_KMH) * 60 + (enMedio * DEMORA_POR_PARADA_S) / 60));
        const costo = (alSubir + alDestino) * PESO_CAMINAR + enBus;
        if (mejor && costo >= mejor.costo) continue;

        mejor = {
          rutaId: ruta.id,
          subirId: a.p.id,
          bajarId: b.p.id,
          sentido: b.p.km > a.p.km ? 1 : -1,
          alSubirKm: a.alOrigen,
          alDestinoKm: b.alDestino,
          enBusKm,
          paradasEnMedio: enMedio,
          minutosAlSubir: alSubir,
          minutosEnBus: enBus,
          minutosAlDestino: alDestino,
          minutosTotal: alSubir + enBus + alDestino,
          costo,
        };
      }
    }
    // El bus tiene que ganarle a ir caminando, y con margen: hay que esperarlo.
    if (mejor && mejor.minutosTotal + ESPERA_MIN < aPie.minutos) opciones.push(mejor);
  }

  opciones.sort((x, y) => x.costo - y.costo);
  let elegidas: OpcionViaje[] = opciones.slice(0, maximo).map(({ costo, ...o }) => o);

  // Sin ningún bus directo que sirva, uno con transbordo.
  if (!elegidas.length) elegidas = planificarTransbordos(origen, destino, rutas, aPie.minutos, maximo);

  let motivo: SinViaje | null = null;
  if (!elegidas.length) {
    if (aPie.minutos <= CERCA_MIN) motivo = 'cerca';
    else if (paradaOrigenKm === null || paradaOrigenKm > CAMINATA_MAX_KM) motivo = 'sin_parada_origen';
    else if (paradaDestinoKm === null || paradaDestinoKm > CAMINATA_MAX_KM) motivo = 'sin_parada_destino';
    else motivo = 'sin_ruta_directa';
  }

  return { opciones: elegidas, aPie, motivo, paradaOrigenKm, paradaDestinoKm };
}

// ---- Viajes con un transbordo ----
//
// Para cada ruta se calcula, una sola vez:
//   - llegar[j]: lo mejor para estar arriba de ese bus en la parada j,
//     subiendo en alguna parada a la que se llega caminando desde el origen;
//   - salir[i]:  lo mejor para, subiendo en la parada i, terminar en el destino.
// Después, para cada par de rutas distintas (A con alguna subida, B con alguna
// bajada), se prueban los pares de paradas (t1 de A, t2 de B) a menos de
// TRANSBORDO_MAX_KM: bajar de A en t1, caminar a t2, esperar y tomar B.
// Así no se repite el cálculo de cada tramo por cada combinación.

interface TramoBus { km: number; enMedio: number; minutos: number }

interface Llegada { desde: number; caminarKm: number; caminarMin: number; bus: TramoBus; costo: number }
interface Salida { hasta: number; caminarKm: number; caminarMin: number; bus: TramoBus; costo: number }

interface RutaPreparada {
  id: string;
  ord: ParadaEnRuta[];               // paradas ordenadas por km
  llegar: (Llegada | null)[];
  salir: (Salida | null)[];
}

function tramoBus(ord: ParadaEnRuta[], i: number, j: number): TramoBus {
  const km = Math.abs(ord[j].km - ord[i].km);
  const enMedio = Math.max(0, Math.abs(j - i) - 1);
  const minutos = Math.max(1, Math.round((km / VEL_URBANA_KMH) * 60 + (enMedio * DEMORA_POR_PARADA_S) / 60));
  return { km, enMedio, minutos };
}

function prepararRuta(ruta: RutaParaViaje, origen: LatLng, destino: LatLng): RutaPreparada {
  const ord = [...ruta.paradas].sort((a, b) => a.km - b.km);
  const alOrigen = ord.map(p => distanciaKm(origen, [p.lat, p.lng]));
  const alDestino = ord.map(p => distanciaKm([p.lat, p.lng], destino));
  const llegar: (Llegada | null)[] = ord.map(() => null);
  const salir: (Salida | null)[] = ord.map(() => null);

  for (let i = 0; i < ord.length; i++) {
    for (let j = 0; j < ord.length; j++) {
      if (i === j) continue;
      const bus = tramoBus(ord, i, j);
      if (bus.km < TRAMO_MIN_KM) continue;
      // Subir en i (cerca del origen) y seguir hasta j.
      if (alOrigen[i] <= CAMINATA_MAX_KM) {
        const caminarMin = caminataEstimada(alOrigen[i]).minutos;
        const costo = caminarMin * PESO_CAMINAR + bus.minutos;
        if (!llegar[j] || costo < llegar[j]!.costo) {
          llegar[j] = { desde: i, caminarKm: alOrigen[i], caminarMin, bus, costo };
        }
      }
      // Subir en i y bajar en j (cerca del destino).
      if (alDestino[j] <= CAMINATA_MAX_KM) {
        const caminarMin = caminataEstimada(alDestino[j]).minutos;
        const costo = caminarMin * PESO_CAMINAR + bus.minutos;
        if (!salir[i] || costo < salir[i]!.costo) {
          salir[i] = { hasta: j, caminarKm: alDestino[j], caminarMin, bus, costo };
        }
      }
    }
  }
  return { id: ruta.id, ord, llegar, salir };
}

export function planificarTransbordos(
  origen: LatLng, destino: LatLng, rutas: RutaParaViaje[], minutosAPie: number, maximo = 3,
): OpcionViaje[] {
  const preparadas = rutas.map(r => prepararRuta(r, origen, destino));
  const conSubida = preparadas.filter(r => r.llegar.some(Boolean));
  const conBajada = preparadas.filter(r => r.salir.some(Boolean));
  const opciones: (OpcionViaje & { costo: number })[] = [];

  for (const a of conSubida) {
    for (const b of conBajada) {
      if (a.id === b.id) continue;
      let mejor: (OpcionViaje & { costo: number }) | null = null;

      for (let t1 = 0; t1 < a.ord.length; t1++) {
        const ll = a.llegar[t1];
        if (!ll) continue;
        for (let t2 = 0; t2 < b.ord.length; t2++) {
          const sa = b.salir[t2];
          if (!sa) continue;
          const entreKm = distanciaKm([a.ord[t1].lat, a.ord[t1].lng], [b.ord[t2].lat, b.ord[t2].lng]);
          if (entreKm > TRANSBORDO_MAX_KM) continue;
          const entreMin = caminataEstimada(entreKm).minutos;
          const costo = ll.costo + entreMin * PESO_CAMINAR + ESPERA_TRANSBORDO_MIN + sa.costo;
          if (mejor && costo >= mejor.costo) continue;

          const subir = a.ord[ll.desde], bajar1 = a.ord[t1];
          const subir2 = b.ord[t2], bajar2 = b.ord[sa.hasta];
          mejor = {
            rutaId: a.id,
            subirId: subir.id,
            bajarId: bajar1.id,
            sentido: bajar1.km > subir.km ? 1 : -1,
            alSubirKm: ll.caminarKm,
            alDestinoKm: entreKm,
            enBusKm: ll.bus.km,
            paradasEnMedio: ll.bus.enMedio,
            minutosAlSubir: ll.caminarMin,
            minutosEnBus: ll.bus.minutos,
            minutosAlDestino: entreMin,
            minutosTotal: ll.caminarMin + ll.bus.minutos + entreMin + ESPERA_TRANSBORDO_MIN + sa.bus.minutos + sa.caminarMin,
            transbordo: {
              rutaId: b.id,
              subirId: subir2.id,
              bajarId: bajar2.id,
              sentido: bajar2.km > subir2.km ? 1 : -1,
              enBusKm: sa.bus.km,
              paradasEnMedio: sa.bus.enMedio,
              minutosEspera: ESPERA_TRANSBORDO_MIN,
              minutosEnBus: sa.bus.minutos,
              alDestinoKm: sa.caminarKm,
              minutosAlDestino: sa.caminarMin,
            },
            costo,
          };
        }
      }
      // Igual que el directo: tiene que ganarle a caminar, con margen.
      if (mejor && mejor.minutosTotal + ESPERA_MIN < minutosAPie) opciones.push(mejor);
    }
  }

  opciones.sort((x, y) => x.costo - y.costo);
  return opciones.slice(0, maximo).map(({ costo, ...o }) => o);
}
