import * as maplibregl from 'maplibre-gl';
import { environment } from '../../../environments/environment';

// Estilo dark de MapTiler. `dataviz-dark` es limpio y minimal, ideal para
// superponer datos (buses, rutas) encima — matchea el look oscuro de la app.
export function mapStyleUrl(): string {
  return `https://api.maptiler.com/maps/dataviz-dark/style.json?key=${environment.maptilerKey}`;
}

// MapLibre es asíncrono: no se pueden agregar sources/layers hasta que el
// estilo terminó de cargar. Este helper devuelve el mapa ya "load" para que
// el código llamador pueda dibujar de una sin manejar el evento cada vez.
// Nota: MapLibre usa [lng, lat] (invertido respecto a Leaflet).
export function createMap(opts: {
  container: string | HTMLElement;
  center: [number, number];
  zoom: number;
}): Promise<maplibregl.Map> {
  const map = new maplibregl.Map({
    container: opts.container,
    style: mapStyleUrl(),
    center: opts.center,
    zoom: opts.zoom,
    attributionControl: false,
  });
  return new Promise((resolve) => {
    map.on('load', () => resolve(map));
  });
}

// Desliza un marcador de su posición actual a una nueva en vez de saltar de
// golpe, para que el movimiento del bus se vea fluido. target es [lng, lat].
export function animateMarkerTo(
  marker: maplibregl.Marker,
  target: [number, number],
  duration = 1000,
): void {
  const start = marker.getLngLat();
  const [endLng, endLat] = target;
  const startTime = performance.now();

  function step(now: number) {
    const t = Math.min((now - startTime) / duration, 1);
    marker.setLngLat([
      start.lng + (endLng - start.lng) * t,
      start.lat + (endLat - start.lat) * t,
    ]);
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// Crea un elemento HTML para usar como marcador custom (MapLibre no tiene
// divIcon como Leaflet; se le pasa un HTMLElement directo).
export function htmlMarkerEl(className: string, innerHtml: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = className;
  el.innerHTML = innerHtml;
  return el;
}
