import { LatLng } from './eta';
import { CAMINATA_MAX_KM, RutaParaViaje, caminataEstimada, planificarViaje } from './viaje';

// Una ruta recta de oeste a este con una parada por kilómetro, y puntos
// ubicados respecto de ella. A esta latitud un grado de longitud son ~109,7 km.
const LAT = 9.93, LNG = -84.08;
const KM_LNG = 1 / (111.32 * Math.cos(LAT * Math.PI / 180));
const KM_LAT = 1 / 110.574;
const punto = (kmEste: number, kmNorte = 0): LatLng => [LAT + kmNorte * KM_LAT, LNG + kmEste * KM_LNG];

function rutaRecta(id: string, kms: number[], kmNorte = 0): RutaParaViaje {
  return {
    id,
    paradas: kms.map(km => {
      const [lat, lng] = punto(km, kmNorte);
      return { id: `${id}-${km}`, lat, lng, km };
    }),
  };
}

const central = rutaRecta('central', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

describe('viaje: caminataEstimada', () => {
  it('por calles se camina un 30 % más que en línea recta, a 4,5 km/h', () => {
    expect(caminataEstimada(1)).toEqual({ metros: 1300, minutos: 17 });
  });

  it('nunca dice "0 min"', () => {
    expect(caminataEstimada(0.01).minutos).toBe(1);
  });
});

describe('viaje: planificarViaje', () => {
  it('elige la parada donde subir y la parada donde bajar', () => {
    // El pasajero está a 200 m de la parada del km 1; va a 150 m de la del km 8.
    const plan = planificarViaje(punto(1, 0.2), punto(8, -0.15), [central]);
    expect(plan.motivo).toBeNull();
    expect(plan.opciones.length).toBe(1);
    const o = plan.opciones[0];
    expect(o.subirId).toBe('central-1');
    expect(o.bajarId).toBe('central-8');
    expect(o.sentido).toBe(1);
    expect(o.enBusKm).toBeCloseTo(7, 5);
    expect(o.paradasEnMedio).toBe(6);
    expect(o.minutosTotal).toBe(o.minutosAlSubir + o.minutosEnBus + o.minutosAlDestino);
  });

  it('en el otro sentido el viaje es el mismo, de vuelta', () => {
    const o = planificarViaje(punto(8, -0.15), punto(1, 0.2), [central]).opciones[0];
    expect(o.subirId).toBe('central-8');
    expect(o.bajarId).toBe('central-1');
    expect(o.sentido).toBe(-1);
  });

  it('el tiempo en el bus cuenta la distancia y lo que pierde en cada parada', () => {
    const o = planificarViaje(punto(1, 0.2), punto(8, -0.15), [central]).opciones[0];
    // 7 km a 25 km/h = 16,8 min; más 6 paradas a 25 s = 2,5 min.
    expect(o.minutosEnBus).toBe(19);
  });

  it('entre dos rutas pone primero la que menos hace caminar', () => {
    // La otra ruta corre 900 m más al norte: llega al mismo lado, caminando más.
    const lejana = rutaRecta('lejana', [0, 2, 4, 6, 8, 10], 0.9);
    const plan = planificarViaje(punto(2, 0.1), punto(8, 0.1), [lejana, central]);
    expect(plan.opciones.map(o => o.rutaId)).toEqual(['central', 'lejana']);
  });

  it('da una sola opción por ruta y respeta el máximo', () => {
    const rutas = ['a', 'b', 'c', 'd'].map((id, i) => rutaRecta(id, [0, 2, 4, 6, 8, 10], i * 0.1));
    const plan = planificarViaje(punto(2), punto(8), rutas, 3);
    expect(plan.opciones.length).toBe(3);
    expect(new Set(plan.opciones.map(o => o.rutaId)).size).toBe(3);
  });

  it('si el destino queda cerca no manda a tomar un bus', () => {
    // 600 m: caminando son unos 10 minutos.
    const plan = planificarViaje(punto(2), punto(2.6), [central]);
    expect(plan.opciones.length).toBe(0);
    expect(plan.motivo).toBe('cerca');
    expect(plan.aPie.minutos).toBeLessThan(15);
  });

  it('no ofrece un bus que no le gana a ir caminando', () => {
    // Las paradas quedan a 1,2 km de cada punta: entre ir y volver de la
    // ruta se camina más que yendo directo.
    const plan = planificarViaje(punto(3, 1.2), punto(4.2, 1.2), [central]);
    expect(plan.opciones.length).toBe(0);
    expect(plan.motivo).toBe('cerca');
  });

  it('dice de qué lado falta parada cuando ninguna ruta llega', () => {
    const lejos = CAMINATA_MAX_KM + 1.5;
    const sinDestino = planificarViaje(punto(1), punto(9, lejos), [central]);
    expect(sinDestino.opciones.length).toBe(0);
    expect(sinDestino.motivo).toBe('sin_parada_destino');
    expect(sinDestino.paradaDestinoKm!).toBeCloseTo(lejos, 1);

    const sinOrigen = planificarViaje(punto(1, lejos), punto(9), [central]);
    expect(sinOrigen.motivo).toBe('sin_parada_origen');
  });

  it('con paradas en las dos puntas pero de rutas distintas, avisa que no hay ruta directa', () => {
    // Dos rutas que no se tocan: una cerca del pasajero, otra cerca del destino.
    const oeste = rutaRecta('oeste', [0, 1, 2]);
    const este: RutaParaViaje = {
      id: 'este',
      paradas: [20, 21, 22].map((km, i) => {
        const [lat, lng] = punto(km);
        return { id: `este-${km}`, lat, lng, km: i };
      }),
    };
    const plan = planificarViaje(punto(1), punto(21), [oeste, este]);
    expect(plan.opciones.length).toBe(0);
    expect(plan.motivo).toBe('sin_ruta_directa');
  });

  it('sin rutas no rompe', () => {
    const plan = planificarViaje(punto(0), punto(9), []);
    expect(plan.opciones).toEqual([]);
    expect(plan.motivo).toBe('sin_parada_origen');
    expect(plan.paradaOrigenKm).toBeNull();
  });

  it('usa los km del trazado y no la línea recta para el tramo en bus', () => {
    // Una ruta que da un rodeo: las paradas están a 4 km en línea recta, pero
    // el bus recorre 9 km entre una y otra.
    const [la1, ln1] = punto(0), [la2, ln2] = punto(4);
    const rodeo: RutaParaViaje = {
      id: 'rodeo',
      paradas: [{ id: 'r-a', lat: la1, lng: ln1, km: 0 }, { id: 'r-b', lat: la2, lng: ln2, km: 9 }],
    };
    const o = planificarViaje(punto(0, 0.1), punto(4, 0.1), [rodeo]).opciones[0];
    expect(o.enBusKm).toBe(9);
    expect(o.minutosEnBus).toBe(22);
  });
});
