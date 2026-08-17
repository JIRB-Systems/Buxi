import { Component } from '@angular/core';
import { ModalController } from '@ionic/angular';

@Component({
  selector: 'app-reporte-form',
  templateUrl: './reporte-form.component.html',
  styleUrls: ['./reporte-form.component.scss'],
  standalone: false,
})
export class ReporteFormComponent {
  titulo = '';
  descripcion = '';

  constructor(private modalCtrl: ModalController) {}

  get canSend(): boolean {
    return !!this.titulo.trim() && !!this.descripcion.trim();
  }

  cancel() {
    this.modalCtrl.dismiss(null, 'cancel');
  }

  send() {
    if (!this.canSend) return;
    this.modalCtrl.dismiss({ titulo: this.titulo.trim(), descripcion: this.descripcion.trim() }, 'confirm');
  }
}
