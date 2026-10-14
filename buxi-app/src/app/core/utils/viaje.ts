// "¿A dónde vas?": con dónde está el pasajero y a dónde quiere ir, qué ruta
// tomar, en qué parada subir, en cuál bajar y cuánto caminar.
//
// Solo viajes directos, en un bus. Para cada ruta se prueban todos los pares
// de paradas (subir, bajar) y se queda el que menos tarda entre caminar hasta
// la parada, ir en el bus y caminar hasta el destino. Con las pocas decenas de
// paradas que tiene una ruta, probarlos todos es más simple y más seguro que
// cualquier atajo.
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
  /** Sin la espera del bus, que depende de cuándo pase. */
  minutosTotal: number;
}

/** Por qué no hay ningún viaje en bus que ofrecer. */
export type SinViaje =
  | 'cerca'                // se llega antes caminando
  | 'sin_parada_origen'    // ninguna parada cerca del pasajero
  | 'sin_parada_destino'   // ninguna parada cerca del destino
  | 'sin_ruta_directa';    // hay paradas en las dos puntas, pero ninguna ruta las une

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
  const elegidas = opciones.slice(0, maximo).map(({ costo, ...o }) => o);

  let motivo: SinViaje | null = null;
  if (!elegidas.length) {
    if (aPie.minutos <= CERCA_MIN) motivo = 'cerca';
    else if (paradaOrigenKm === null || paradaOrigenKm > CAMINATA_MAX_KM) motivo = 'sin_parada_origen';
    else if (paradaDestinoKm === null || paradaDestinoKm > CAMINATA_MAX_KM) motivo = 'sin_parada_destino';
    else motivo = 'sin_ruta_directa';
  }

  return { opciones: elegidas, aPie, motivo, paradaOrigenKm, paradaDestinoKm };
}
