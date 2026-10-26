import { Injectable } from '@angular/core';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import type { BackgroundGeolocationPlugin, Location } from '@capacitor-community/background-geolocation';
import { logError } from '../utils/log';

const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation');

export type ResultadoGpsFondo = 'ok' | 'sin-permiso' | 'error';

// GPS del chofer con la pantalla apagada o la app minimizada.
//
// En el navegador, watchPosition se corta apenas el chofer bloquea el
// teléfono: el bus desaparecía del mapa del pasajero. En la app de Android
// este plugin levanta un servicio en primer plano, que es la única forma en
// que Android deja seguir usando el GPS: obliga a mostrar una notificación
// fija mientras dure ("Buxci está transmitiendo…"), igual que Uber o Waze.
// Solo se usa durante un viaje; fuera de él alcanza con el GPS común.
@Injectable({ providedIn: 'root' })
export class GpsFondoService {
  private watcherId: string | null = null;

  get disponible(): boolean {
    return Capacitor.getPlatform() === 'android';
  }

  get activo(): boolean {
    return this.watcherId !== null;
  }

  async iniciar(ruta: string | null, alUbicar: (l: Location) => void): Promise<ResultadoGpsFondo> {
    if (!this.disponible) return 'error';
    if (this.watcherId) return 'ok';

    // Android 13+ no muestra la notificación del servicio sin este permiso,
    // y sin notificación no hay servicio: el GPS se cortaría igual.
    try {
      const p = await LocalNotifications.checkPermissions();
      if (p.display !== 'granted') await LocalNotifications.requestPermissions();
    } catch (e) {
      logError('gps de fondo: permiso de notificaciones', e);
    }

    return new Promise<ResultadoGpsFondo>(resolve => {
      let resuelto = false;
      const fin = (r: ResultadoGpsFondo) => { if (!resuelto) { resuelto = true; resolve(r); } };
      BackgroundGeolocation.addWatcher(
        {
          backgroundTitle: 'Buxci está transmitiendo tu ubicación',
          backgroundMessage: ruta ? `Viaje en curso · ${ruta}. Terminalo en la app para dejar de transmitir.` : 'Viaje en curso. Terminalo en la app para dejar de transmitir.',
          requestPermissions: true,
          stale: false,
          // 0 y no "cada N metros": con el bus detenido en una parada
          // tienen que seguir llegando posiciones, si no el pasajero lo ve
          // como "señal vieja" a los 45 s. El GPS ya está prendido igual; lo
          // que se manda al servidor se limita a uno cada 5 s en la página.
          distanceFilter: 0,
        },
        (ubicacion, error) => {
          if (error) {
            logError('gps de fondo', error);
            fin(error.code === 'NOT_AUTHORIZED' ? 'sin-permiso' : 'error');
            return;
          }
          if (ubicacion) {
            fin('ok');
            alUbicar(ubicacion);
          }
        },
      ).then(id => {
        this.watcherId = id;
        // Sin señal todavía (bajo techo) no es un error: el servicio quedó
        // andando y la primera posición llega cuando haya cielo.
        setTimeout(() => fin('ok'), 8000);
      }).catch(e => {
        logError('gps de fondo: no arrancó', e);
        fin('error');
      });
    });
  }

  async detener() {
    const id = this.watcherId;
    this.watcherId = null;
    if (!id) return;
    try {
      await BackgroundGeolocation.removeWatcher({ id });
    } catch (e) {
      logError('gps de fondo: no se pudo detener', e);
    }
  }

  abrirAjustes() {
    BackgroundGeolocation.openSettings().catch(() => {});
  }
}
