import { Injectable } from '@angular/core';
import { PreloadingStrategy, Route } from '@angular/router';
import { Observable, of } from 'rxjs';

// Antes la app usaba PreloadAllModules: apenas terminaba de arrancar, bajaba
// TODOS los módulos lazy. Un pasajero en el celular descargaba el panel de JIRB
// (~560 KB sin comprimir), el de empresa y la pantalla del chofer, pantallas que
// su rol ni siquiera le deja abrir — datos móviles y CPU gastados en cada visita.
//
// Ahora solo se precargan las rutas marcadas con `data: { precargar: true }`:
// el mapa del pasajero (la pantalla de la inmensa mayoría de los usuarios, que
// así empieza a bajar mientras corre la animación del splash) y el login. El
// resto se descarga recién al navegar, que para admins y choferes —pocos, y en
// computadora o con la app ya instalada— es un costo mucho menor.
@Injectable({ providedIn: 'root' })
export class PreloadSelectivo implements PreloadingStrategy {
  preload(route: Route, load: () => Observable<unknown>): Observable<unknown> {
    return route.data?.['precargar'] ? load() : of(null);
  }
}
