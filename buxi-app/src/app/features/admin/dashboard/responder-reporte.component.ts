import { Component, Input } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { ReporteBug } from '../../../core/models/features.model';

@Component({
  selector: 'app-responder-reporte',
  templateUrl: './responder-reporte.component.html',
  styleUrls: ['./responder-reporte.component.scss'],
  standalone: false,
})
export class ResponderReporteComponent {
  @Input() reporte!: ReporteBug;

  estado: 'pendiente' | 'en_revision' | 'resuelto' = 'pendiente';
  respuesta = '';

  constructor(private modalCtrl: ModalController) {}

  ngOnInit() {
    this.estado = this.reporte.estado;
    this.respuesta = this.reporte.respuesta_jirb || '';
  }

  cancel() {
    this.modalCtrl.dismiss(null, 'cancel');
  }

  save() {
    this.modalCtrl.dismiss({ estado: this.estado, respuesta: this.respuesta.trim() }, 'confirm');
  }
}
