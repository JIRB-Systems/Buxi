import {
  TrazadoRuta, LatLng, distanciaKm, rumboEntre, sentidoSegunRumbo, suavizarVelocidad, estimarLlegada,
  FUERA_DE_RUTA_KM, VEL_URBANA_KMH,
} from './eta';

// Un recorrido en "L": 2 km hacia el este y después 1 km hacia el norte.
// A esta latitud un grado de longitud son ~109,7 km y uno de latitud ~110,6.
const LAT = 9.93, LNG = -84.08;
const ESTE_2KM = 2 / (111.32 * Math.cos(LAT * Math.PI / 180));
const NORTE_1KM = 1 / 110.574;
const ele: LatLng[] = [[LAT, LNG], [LAT, LNG + ESTE_2KM], [LAT + NORTE_1KM, LNG + ESTE_2KM]];

describe('eta: TrazadoRuta', () => {
  const trazado = new TrazadoRuta(ele);

  it('mide el largo del recorrido', () => {
    expect(trazado.valido).toBeTrue();
    expect(trazado.largoKm).toBeCloseTo(3, 1);
  });

  it('ubica un punto sobre el recorrido por su avance en km', () => {
    const mitadDelPrimerTramo = trazado.proyectar(LAT, LNG + ESTE_2KM / 2);
    expect(mitadDelPrimerTramo.km).toBeCloseTo(1, 1);
    expect(mitadDelPrimerTramo.desvioKm).toBeLessThan(0.01);
    expect(mitadDelPrimerTramo.rumbo).toBeCloseTo(90, 0); // hacia el este

    const segundoTramo = trazado.proyectar(LAT + NORTE_1KM / 2, LNG + ESTE_2KM);
    expect(segundoTramo.km).toBeCloseTo(2.5, 1);
    expect(segundoTramo.rumbo).toBeCloseTo(0, 0); // hacia el norte
  });

  it('dice cuánto se aparta un punto que no está sobre el recorrido', () => {
    // 500 m al sur del primer tramo.
    const p = trazado.proyectar(LAT - 0.5 / 110.574, LNG + ESTE_2KM / 2);
    expect(p.desvioKm).toBeCloseTo(0.5, 1);
    expect(p.desvioKm).toBeGreaterThan(FUERA_DE_RUTA_KM);
  });

  it('con un trazado de ida y vuelta por la misma calle, la pista decide en cuál de las dos pasadas está', () => {
    // 2 km al este y 2 km de regreso: cada punto de la calle aparece dos veces.
    const idaYVuelta = new TrazadoRuta([[LAT, LNG], [LAT, LNG + ESTE_2KM], [LAT, LNG]]);
    expect(idaYVuelta.largoKm).toBeCloseTo(4, 1);
    const lng = LNG + ESTE_2KM / 4; // a 0,5 km del inicio
    expect(idaYVuelta.proyectar(LAT, lng, 0.4).km).toBeCloseTo(0.5, 1);
    expect(idaYVuelta.proyectar(LAT, lng, 3.6).km).toBeCloseTo(3.5, 1);
  });

  it('un trazado vacío o de un solo punto no es válido y no rompe', () => {
    expect(new TrazadoRuta([]).valido).toBeFalse();
    expect(new TrazadoRuta([[LAT, LNG]]).valido).toBeFalse();
    expect(new TrazadoRuta([]).proyectar(LAT, LNG).desvioKm).toBe(Infinity);
  });
});

describe('eta: geometría', () => {
  it('distancia y rumbo entre dos puntos', () => {
    expect(distanciaKm([LAT, LNG], [LAT, LNG + ESTE_2KM])).toBeCloseTo(2, 1);
    expect(rumboEntre([LAT, LNG], [LAT + NORTE_1KM, LNG])).toBeCloseTo(0, 0);
    expect(rumboEntre([LAT, LNG], [LAT, LNG - ESTE_2KM])).toBeCloseTo(270, 0);
  });
});

describe('eta: sentido del bus', () => {
  it('va de ida si su rumbo coincide con el del trazado, de vuelta si es el opuesto', () => {
    expect(sentidoSegunRumbo(85, 90)).toBe(1);
    expect(sentidoSegunRumbo(275, 90)).toBe(-1);
  });

  it('entiende que 350° y 10° son casi el mismo rumbo', () => {
    expect(sentidoSegunRumbo(350, 10)).toBe(1);
    expect(sentidoSegunRumbo(10, 350)).toBe(1);
    expect(sentidoSegunRumbo(190, 350)).toBe(-1);
  });

  it('sin rumbo no adivina', () => {
    expect(sentidoSegunRumbo(null, 90)).toBeNull();
    expect(sentidoSegunRumbo(undefined, 90)).toBeNull();
    expect(sentidoSegunRumbo(NaN, 90)).toBeNull();
  });
});

describe('eta: velocidad', () => {
  it('ignora las lecturas con el bus detenido', () => {
    expect(suavizarVelocidad(40, 0)).toBe(40);
    expect(suavizarVelocidad(40, 3)).toBe(40);
    expect(suavizarVelocidad(undefined, 0)).toBeUndefined();
  });

  it('arranca con la primera lectura en movimiento y después promedia', () => {
    expect(suavizarVelocidad(undefined, 30)).toBe(30);
    expect(suavizarVelocidad(30, 50)).toBeCloseTo(36, 5);
  });
});

describe('eta: estimarLlegada', () => {
  const base = { kmParada: 5, sentido: 1 as const, desvioKm: 0.01 };

  it('un bus 4 km antes de la parada, a 24 km/h, llega en 10 minutos', () => {
    const l = estimarLlegada({ ...base, kmBus: 1, velocidadKmh: 24 });
    expect(l.estado).toBe('viene');
    expect(l.minutos).toBe(10);
    expect(l.distanciaKm).toBeCloseTo(4, 5);
  });

  it('suma lo que pierde en las paradas intermedias', () => {
    const sin = estimarLlegada({ ...base, kmBus: 1, velocidadKmh: 24 });
    const con = estimarLlegada({ ...base, kmBus: 1, velocidadKmh: 24, paradasEnMedio: 6 });
    expect(con.minutos! - sin.minutos!).toBeGreaterThanOrEqual(2);
  });

  it('un bus que ya pasó la parada NO cuenta como que viene', () => {
    // Era el fallo más grave del cálculo anterior: en línea recta este bus
    // está a 200 m y daba "llega en 1 min".
    const l = estimarLlegada({ ...base, kmBus: 5.2, velocidadKmh: 30 });
    expect(l.estado).toBe('ya_paso');
    expect(l.minutos).toBeNull();
  });

  it('de vuelta, el mismo bus sí viene hacia la parada', () => {
    const l = estimarLlegada({ ...base, sentido: -1, kmBus: 5.2, velocidadKmh: 30 });
    expect(l.estado).toBe('viene');
    expect(l.distanciaKm).toBeCloseTo(0.2, 5);
  });

  it('a pocos metros está llegando; detenido en la parada no "ya pasó"', () => {
    expect(estimarLlegada({ ...base, kmBus: 4.97 }).estado).toBe('llegando');
    expect(estimarLlegada({ ...base, kmBus: 5.02 }).estado).toBe('llegando');
    expect(estimarLlegada({ ...base, kmBus: 4.97 }).minutos).toBe(0);
  });

  it('lejos del trazado no promete hora', () => {
    const l = estimarLlegada({ ...base, kmBus: 1, desvioKm: 0.8 });
    expect(l.estado).toBe('fuera_de_ruta');
    expect(l.minutos).toBeNull();
  });

  it('sin velocidad conocida usa la urbana, y acota los picos', () => {
    const sinDato = estimarLlegada({ ...base, kmBus: 0 });
    expect(sinDato.minutos).toBe(Math.round((5 / VEL_URBANA_KMH) * 60));
    // 120 km/h no es una velocidad que un bus sostenga: se acota a 60.
    expect(estimarLlegada({ ...base, kmBus: 0, velocidadKmh: 120 }).minutos).toBe(5);
    // Y casi parado tampoco: se acota a 12.
    expect(estimarLlegada({ ...base, kmBus: 4, velocidadKmh: 6 }).minutos).toBe(5);
  });

  it('nunca dice "0 min" para un bus que todavía viene', () => {
    const l = estimarLlegada({ ...base, kmBus: 4.9, velocidadKmh: 60 });
    expect(l.estado).toBe('viene');
    expect(l.minutos).toBe(1);
  });
});
