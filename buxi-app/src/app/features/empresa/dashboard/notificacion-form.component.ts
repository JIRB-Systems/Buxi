import { Component, Input, OnInit } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { Ruta } from '../../../core/models/transport.model';
import { TipoNotificacion } from '../../../core/models/features.model';

// Composición de un aviso de la empresa hacia los pasajeros que la siguen.
//
// El modal recibe `prefill` para el atajo "Avisar atraso" de la lista de
// buses: llega con el tipo, la ruta y el bus ya puestos y el texto sugerido,
// de modo que un atraso se avisa en dos toques. Igual se puede editar todo
// antes de mandar — el atajo propone, no decide por la empresa.
@Component({
  selector: 'app-notificacion-form',
  templateUrl: './notificacion-form.component.html',
  styleUrls: ['./notificacion-form.component.scss'],
  standalone: false,
})
export class NotificacionFormComponent implements OnInit {
  @Input() rutas: Ruta[] = [];
  @Input() seguidores = 0;
  @Input() prefill: {
    tipo?: TipoNotificacion;
    titulo?: string;
    mensaje?: string;
    rutaId?: string | null;
    busId?: string | null;
    busLabel?: string | null;
  } | null = null;

  tipo: TipoNotificacion = 'atraso';
  titulo = '';
  mensaje = '';
  rutaId: string | null = null;

  // No se elige en el formulario: solo llega por el atajo desde un bus
  // concreto. Se guarda para mandarlo y se muestra como contexto fijo.
  busId: string | null = null;
  busLabel: string | null = null;

  readonly tipos: { id: TipoNotificacion; label: string; icon: string; color: string }[] = [
    { id: 'atraso', label: 'Atraso', icon: 'time-outline', color: '#ff9800' },
    { id: 'desvio', label: 'Desvío', icon: 'git-branch-outline', color: '#2196f3' },
    { id: 'cancelacion', label: 'Cancelación', icon: 'close-circle-outline', color: '#f44336' },
    { id: 'info', label: 'Información', icon: 'information-circle-outline', color: '#00c853' },
  ];

  // Los mismos límites que las constraints de la tabla. Se repiten acá para
  // que el contador avise antes de mandar, no para reemplazarlas: la que vale
  // es la de la base.
  readonly MAX_TITULO = 120;
  readonly MAX_MENSAJE = 500;

  constructor(private modalCtrl: ModalController) {}

  ngOnInit() {
    if (!this.prefill) return;
    this.tipo = this.prefill.tipo ?? this.tipo;
    this.titulo = this.prefill.titulo ?? '';
    this.mensaje = this.prefill.mensaje ?? '';
    this.rutaId = this.prefill.rutaId ?? null;
    this.busId = this.prefill.busId ?? null;
    this.busLabel = this.prefill.busLabel ?? null;
  }

  get canSend(): boolean {
    const t = this.titulo.trim(), m = this.mensaje.trim();
    return !!t && !!m && t.length <= this.MAX_TITULO && m.length <= this.MAX_MENSAJE;
  }

  get seguidoresLabel(): string {
    if (this.seguidores === 0) return 'Todavía nadie sigue a tu empresa';
    if (this.seguidores === 1) return 'Le va a llegar a 1 pasajero';
    return `Le va a llegar a ${this.seguidores} pasajeros`;
  }

  cancel() {
    this.modalCtrl.dismiss(null, 'cancel');
  }

  send() {
    if (!this.canSend) return;
    this.modalCtrl.dismiss({
      tipo: this.tipo,
      titulo: this.titulo.trim(),
      mensaje: this.mensaje.trim(),
      rutaId: this.rutaId,
      busId: this.busId,
    }, 'confirm');
  }
}
