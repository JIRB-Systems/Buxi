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

/** Para importar las dos de una vez en un módulo. */
export const TRANSPORTE = [RutaInsigniaComponent, PlacaComponent] as const;
