import { Directive, ElementRef, EventEmitter, NgZone, OnDestroy, OnInit, Output } from '@angular/core';

// Arrastrar una hoja inferior desde su asa (la barrita y el encabezado).
//
// Mientras el dedo se mueve, la hoja lo sigue escribiendo el transform directo
// en el DOM, fuera de la zona de Angular: el mapa del pasajero tiene muchos
// bindings y un ciclo de detección por cada pointermove se nota. Al soltar
// emite cuánto se movió y la página decide a qué altura pasa.
//
// Un toque sin movimiento no es un arrastre: se deja pasar el click normal
// (por ejemplo el del botón del encabezado). Si hubo arrastre, el click que
// el navegador manda al final se descarta para no abrir y cerrar a la vez.
@Directive({ selector: '[bxArrastreHoja]', standalone: true })
export class ArrastreHojaDirective implements OnInit, OnDestroy {
  @Output() soltar = new EventEmitter<number>();

  private readonly UMBRAL = 6;
  private inicioY = 0;
  private dy = 0;
  private arrastrando = false;
  private puntero: number | null = null;
  private hoja: HTMLElement | null = null;

  constructor(private el: ElementRef<HTMLElement>, private zone: NgZone) {}

  ngOnInit() {
    this.zone.runOutsideAngular(() => {
      this.el.nativeElement.addEventListener('pointerdown', this.bajar);
    });
  }

  ngOnDestroy() {
    this.el.nativeElement.removeEventListener('pointerdown', this.bajar);
    this.limpiar();
  }

  private bajar = (e: PointerEvent) => {
    if (e.button !== 0 || this.puntero !== null) return;
    // Los botones de adentro que no son parte del asa (por ejemplo "Ir")
    // funcionan como botones, no arrastran.
    const objetivo = e.target as Element | null;
    if (objetivo?.closest('button:not([data-asa]), a, input')) return;
    this.hoja = this.el.nativeElement.closest('[data-hoja]') as HTMLElement | null;
    if (!this.hoja) return;
    this.puntero = e.pointerId;
    this.inicioY = e.clientY;
    this.dy = 0;
    this.arrastrando = false;
    const el = this.el.nativeElement;
    el.addEventListener('pointermove', this.mover, { passive: false });
    el.addEventListener('pointerup', this.soltarPuntero);
    el.addEventListener('pointercancel', this.cancelar);
  };

  private mover = (e: PointerEvent) => {
    if (e.pointerId !== this.puntero || !this.hoja) return;
    this.dy = e.clientY - this.inicioY;
    if (!this.arrastrando && Math.abs(this.dy) < this.UMBRAL) return;
    if (!this.arrastrando) {
      this.arrastrando = true;
      // Todo esto recién cuando ya se sabe que es un arrastre, no en el
      // pointerdown: hacerlo antes rompía el toque simple del encabezado
      // (el click terminaba en el asa y no en el botón).
      //
      // Capturar el puntero es lo que hace que el gesto no se corte: sin
      // esto, apenas el dedo salía del asa el navegador mandaba
      // pointercancel y el arrastre se perdía a la mitad. Y limpiar la
      // selección evita que el navegador lo tome por "seleccionar texto".
      try { this.el.nativeElement.setPointerCapture(e.pointerId); } catch {}
      try { document.getSelection()?.removeAllRanges(); } catch {}
    }
    e.preventDefault();
    // Hacia abajo sigue al dedo; hacia arriba ofrece resistencia, porque la
    // hoja crece desde abajo y no tiene lugar real para subir entera.
    const y = this.dy > 0 ? this.dy : this.dy / 3;
    this.hoja.style.transition = 'none';
    this.hoja.style.transform = `translateY(${y}px)`;
  };

  private soltarPuntero = (e: PointerEvent) => {
    if (e.pointerId !== this.puntero) return;
    const huboArrastre = this.arrastrando;
    const dy = this.dy;
    this.limpiar();
    if (!huboArrastre) return;
    // El click que sigue al soltar no tiene que contar como toque.
    const tragar = (ev: Event) => { ev.stopPropagation(); ev.preventDefault(); };
    this.el.nativeElement.addEventListener('click', tragar, { capture: true, once: true });
    setTimeout(() => this.el.nativeElement.removeEventListener('click', tragar, { capture: true }), 0);
    this.zone.run(() => this.soltar.emit(dy));
  };

  // Si el sistema corta el gesto igual (una llamada entrante, por ejemplo) y
  // ya se había arrastrado, vale lo último que marcó el dedo: es más amable
  // que devolver la hoja a donde estaba.
  private cancelar = (e: PointerEvent) => {
    if (e.pointerId !== this.puntero) return;
    const huboArrastre = this.arrastrando;
    const dy = this.dy;
    this.limpiar();
    if (huboArrastre) this.zone.run(() => this.soltar.emit(dy));
  };

  private limpiar() {
    const el = this.el.nativeElement;
    if (this.puntero !== null) {
      try { el.releasePointerCapture(this.puntero); } catch {}
    }
    el.removeEventListener('pointermove', this.mover);
    el.removeEventListener('pointerup', this.soltarPuntero);
    el.removeEventListener('pointercancel', this.cancelar);
    if (this.hoja) {
      this.hoja.style.transition = '';
      this.hoja.style.transform = '';
    }
    this.hoja = null;
    this.puntero = null;
    this.arrastrando = false;
  }
}
