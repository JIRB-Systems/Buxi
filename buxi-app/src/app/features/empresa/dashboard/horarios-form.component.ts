import { Component, Input, OnInit } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { AdminEmpresaService } from '../../../core/services/admin-empresa.service';
import { Horario } from '../../../core/models/features.model';
import { Ruta } from '../../../core/models/transport.model';

type Dia = 'lunes_viernes' | 'sabado' | 'domingo';

interface DiaRow {
  dia: Dia;
  label: string;
  id: string | null;
  primera_salida: string;
  ultima_salida: string;
  frecuencia_minutos: number | null;
  notas: string;
}

const DIAS: { dia: Dia; label: string }[] = [
  { dia: 'lunes_viernes', label: 'Lunes a viernes' },
  { dia: 'sabado', label: 'Sábado' },
  { dia: 'domingo', label: 'Domingo' },
];

@Component({
  selector: 'app-horarios-form',
  templateUrl: './horarios-form.component.html',
  styleUrls: ['./horarios-form.component.scss'],
  standalone: false,
})
export class HorariosFormComponent implements OnInit {
  @Input() ruta!: Ruta;

  rows: DiaRow[] = [];
  loading = true;
  saving = false;

  constructor(private modalCtrl: ModalController, private admin: AdminEmpresaService) {}

  async ngOnInit() {
    this.rows = DIAS.map(d => ({ ...d, id: null, primera_salida: '', ultima_salida: '', frecuencia_minutos: null, notas: '' }));
    try {
      const existentes = await this.admin.getHorarios(this.ruta.id);
      for (const h of existentes) {
        const row = this.rows.find(r => r.dia === h.dia);
        if (row) {
          row.id = h.id;
          row.primera_salida = h.primera_salida.slice(0, 5);
          row.ultima_salida = h.ultima_salida.slice(0, 5);
          row.frecuencia_minutos = h.frecuencia_minutos;
          row.notas = h.notas || '';
        }
      }
    } catch {}
    this.loading = false;
  }

  // Un día se guarda si tiene ambas horas; si el usuario las borra y ya
  // existía, se elimina en vez de mandar un horario a medio llenar.
  private isRowFilled(r: DiaRow): boolean {
    return !!r.primera_salida && !!r.ultima_salida;
  }

  close() {
    this.modalCtrl.dismiss();
  }

  // Mismo motivo que en anuncio-form.component.ts: global.scss fuerza
  // --keyboard-offset: 0px, así que el teclado puede tapar el footer
  // fijo. Lo cerramos apenas se empieza a scrollear.
  onFormScroll() {
    const active = document.activeElement as HTMLElement | null;
    if (active && active.tagName !== 'BODY' && typeof active.blur === 'function') {
      active.blur();
    }
  }

  async save() {
    if (this.saving) return;
    this.saving = true;
    try {
      for (const r of this.rows) {
        if (this.isRowFilled(r)) {
          const horario: Partial<Horario> = {
            ruta_id: this.ruta.id,
            dia: r.dia,
            primera_salida: r.primera_salida,
            ultima_salida: r.ultima_salida,
            frecuencia_minutos: r.frecuencia_minutos || 15,
            notas: r.notas.trim() || null,
          };
          if (r.id) horario.id = r.id;
          await this.admin.saveHorario(horario);
        } else if (r.id) {
          await this.admin.deleteHorario(r.id);
        }
      }
      this.modalCtrl.dismiss(null, 'confirm');
    } finally {
      this.saving = false;
    }
  }
}
