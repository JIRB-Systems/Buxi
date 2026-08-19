import { Component, Input, OnInit } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { AdminEmpresaService } from '../../../core/services/admin-empresa.service';
import { HorarioSalida } from '../../../core/models/features.model';
import { Ruta } from '../../../core/models/transport.model';

type Dia = 'lunes_viernes' | 'sabado' | 'domingo';

interface DiaRow {
  dia: Dia;
  label: string;
  times: HorarioSalida[];
  newTime: string;
  adding: boolean;
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

  constructor(private modalCtrl: ModalController, private admin: AdminEmpresaService) {}

  async ngOnInit() {
    this.rows = DIAS.map(d => ({ ...d, times: [], newTime: '', adding: false }));
    try {
      const salidas = await this.admin.getHorarioSalidas(this.ruta.id);
      for (const s of salidas) {
        const row = this.rows.find(r => r.dia === s.dia);
        if (row) row.times.push(s);
      }
    } catch {}
    this.loading = false;
  }

  // Cada hora se guarda al toque, como agregar un tag: nada de "Guardar" al
  // final que deje sin persistir lo que ya escribiste si cerrás sin querer.
  async addTime(row: DiaRow) {
    if (!row.newTime || row.adding) return;
    row.adding = true;
    try {
      const hora = row.newTime.length === 5 ? `${row.newTime}:00` : row.newTime;
      const creada = await this.admin.addHorarioSalida(this.ruta.id, row.dia, hora);
      row.times.push(creada);
      row.times.sort((a, b) => a.hora.localeCompare(b.hora));
      row.newTime = '';
    } catch {} finally {
      row.adding = false;
    }
  }

  async removeTime(row: DiaRow, h: HorarioSalida) {
    try {
      await this.admin.deleteHorarioSalida(h.id);
      row.times = row.times.filter(t => t.id !== h.id);
    } catch {}
  }

  formatHora(hora: string): string {
    return hora.slice(0, 5);
  }

  close() {
    this.modalCtrl.dismiss(null, 'confirm');
  }

  onFormScroll() {
    const active = document.activeElement as HTMLElement | null;
    if (active && active.tagName !== 'BODY' && typeof active.blur === 'function') {
      active.blur();
    }
  }
}
