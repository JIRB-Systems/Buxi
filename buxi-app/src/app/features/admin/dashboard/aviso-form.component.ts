import { Component } from '@angular/core';
import { ModalController } from '@ionic/angular';

@Component({
  selector: 'app-aviso-form',
  templateUrl: './aviso-form.component.html',
  styleUrls: ['./aviso-form.component.scss'],
  standalone: false,
})
export class AvisoFormComponent {
  titulo = '';
  mensaje = '';
  tipo: 'info' | 'advertencia' | 'urgente' = 'info';

  constructor(private modalCtrl: ModalController) {}

  get canPublish(): boolean {
    return !!this.titulo.trim() && !!this.mensaje.trim();
  }

  cancel() {
    this.modalCtrl.dismiss(null, 'cancel');
  }

  publish() {
    if (!this.canPublish) return;
    this.modalCtrl.dismiss({ titulo: this.titulo.trim(), mensaje: this.mensaje.trim(), tipo: this.tipo }, 'confirm');
  }
}
