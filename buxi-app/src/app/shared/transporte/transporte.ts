import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { colorSeguro } from '../../core/utils/html';
import { rutaCorta, tintaSobre } from '../../core/utils/marca';

// Las dos piezas del transporte que se repiten en todas las superficies:
// la insignia de una ruta y la placa de un bus. Las clases y los estilos son
// globales (theme/componentes.scss); estos componentes solo calculan el texto
// y los colores para no repetir esa lógica en cada plantilla.

/** Insignia de ruta: el color de la línea con su nombre corto ("SJ · Cartago"). */
@Component({
  selector: 'bx-ruta',
  standalone: true,
  // El texto va en su propio span: en un contenedor flex el recorte con
  // puntos suspensivos no se aplica al texto suelto, y un nombre largo se
  // cortaba a la mitad de una letra.
  template: '<span class="bx-ruta__txt">{{ texto }}</span>',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'bx-ruta',
    '[class.bx-ruta--lg]': 'grande',
    '[class.bx-ruta--apagada]': 'apagada',
    '[style.--ruta]': 'fondo',
    '[style.--ruta-tinta]': 'tinta',
    '[attr.title]': 'nombre',
  },
})
export class RutaInsigniaComponent {
  @Input() nombre = '';
  @Input() color: string | null | undefined = null;
  /** Para un bus que va de regreso: "Cartago · SJ". */
  @Input() invertir = false;
  @Input() grande = false;
  @Input() apagada = false;

  get texto(): string { return rutaCorta(this.nombre, this.invertir); }
  get fondo(): string { return colorSeguro(this.color, '#8292aa'); }
  get tinta(): string { return tintaSobre(this.fondo); }
}

/** Placa del bus, con la franja azul de arriba, como en la calle. */
@Component({
  selector: 'bx-placa',
  standalone: true,
  template: '<span class="bx-placa__pais" aria-hidden="true">COSTA RICA</span><span class="bx-placa__num">{{ placa || "—" }}</span>',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'bx-placa',
    '[class.bx-placa--lg]': 'grande',
    '[class.bx-placa--apagada]': 'apagada',
    '[attr.aria-label]': '"Placa " + (placa || "sin registrar")',
  },
})
export class PlacaComponent {
  @Input() placa: string | null | undefined = '';
  @Input() grande = false;
  @Input() apagada = false;
}

/**
 * Un tiempo con su fuente, igual en toda la app (como Transit): en vivo va en
 * verde y negrita con ondas que laten; por horario, en gris con un reloj. Así
 * el pasajero sabe de un vistazo si el dato viene del GPS o de una tabla.
 */
@Component({
  selector: 'bx-dato',
  standalone: true,
  template: `@if (vivo) {<svg class="bx-dato__ic" viewBox="0 0 16 16" aria-hidden="true"><circle cx="4" cy="12" r="1.9" fill="currentColor"/><path class="bx-dato__ola" d="M4 7.4a4.6 4.6 0 0 1 4.6 4.6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path class="bx-dato__ola bx-dato__ola--2" d="M4 3a9 9 0 0 1 9 9" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>} @else {<svg class="bx-dato__ic" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 4.6V8l2.3 1.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>}<span class="bx-dato__txt"><ng-content></ng-content></span><span class="bx-sr">{{ vivo ? ' (en vivo)' : ' (según horario)' }}</span>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'bx-dato',
    '[class.bx-dato--vivo]': 'vivo',
    '[class.bx-dato--horario]': '!vivo',
  },
})
export class DatoComponent {
  @Input() vivo = false;
}

/** Para importar las tres de una vez en un módulo. */
export const TRANSPORTE = [RutaInsigniaComponent, PlacaComponent, DatoComponent] as const;
