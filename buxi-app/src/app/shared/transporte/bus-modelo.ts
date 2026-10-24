import { ChangeDetectionStrategy, Component, ElementRef, Input, OnChanges, inject } from '@angular/core';
import { MODELO_BUS_DEFECTO, ModeloBus, VistaBus, svgBus } from '../../core/utils/bus-modelos';

/**
 * Dibujo de un modelo de bus (core/utils/bus-modelos), teñido con un color.
 *
 * El SVG se escribe directo en el elemento: el sanitizador de Angular borra
 * los <svg> que llegan por [innerHTML]. Es seguro porque el dibujo es nuestro
 * y lo único variable, el color, pasa por colorSeguro dentro de svgBus.
 */
@Component({
  selector: 'bx-bus-modelo',
  standalone: true,
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'bx-bus-modelo',
    '[class.bx-bus-modelo--arriba]': 'vista === "arriba"',
    '[class.bx-bus-modelo--lado]': 'vista === "lado"',
    '[class.bx-bus-modelo--planta]': 'vista === "planta"',
  },
})
export class BusModeloComponent implements OnChanges {
  @Input() modelo: ModeloBus = MODELO_BUS_DEFECTO;
  @Input() vista: VistaBus = 'lado';
  @Input() color: string | null | undefined = null;

  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);

  ngOnChanges() {
    this.el.nativeElement.innerHTML = svgBus(this.modelo, this.vista, this.color);
  }
}
