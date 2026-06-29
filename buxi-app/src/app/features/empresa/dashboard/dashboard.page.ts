import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController, LoadingController, ModalController, ToastController } from '@ionic/angular';
import { SupabaseService } from '../../../core/services/supabase.service';
import { AdminEmpresaService } from '../../../core/services/admin-empresa.service';
import { UserProfile } from '../../../core/models/user-profile.model';
import { Bus, Ruta } from '../../../core/models/transport.model';

@Component({
  selector: 'app-empresa-dashboard',
  templateUrl: './dashboard.page.html',
  styleUrls: ['./dashboard.page.scss'],
  standalone: false,
})
export class EmpresaDashboardPage implements OnInit {
  profile: UserProfile | null = null;
  activeTab = 'overview';
  loading = true;
  sidebarOpen = true;
  empresaNombre = '';

  menuItems = [
    { id: 'overview', icon: 'grid-outline', label: 'Resumen' },
    { id: 'rutas', icon: 'git-branch-outline', label: 'Rutas' },
    { id: 'buses', icon: 'bus-outline', label: 'Buses' },
    { id: 'choferes', icon: 'people-outline', label: 'Choferes' },
  ];

  stats = { buses: 0, rutas: 0, choferes: 0, busesEnRuta: 0 };
  rutas: Ruta[] = [];
  buses: Bus[] = [];
  choferes: UserProfile[] = [];

  constructor(
    private supabase: SupabaseService,
    private admin: AdminEmpresaService,
    private router: Router,
    private alertCtrl: AlertController,
    private loadingCtrl: LoadingController,
    private toastCtrl: ToastController,
  ) {}

  async ngOnInit() {
    try {
      this.profile = await this.supabase.getProfile();
      if (this.profile?.empresa_id) {
        await this.loadData();
      }
    } catch {} finally {
      this.loading = false;
    }
  }

  async loadData() {
    if (!this.profile?.empresa_id) return;
    const eid = this.profile.empresa_id;
    const [stats, rutas, buses, choferes] = await Promise.all([
      this.admin.getStats(eid),
      this.admin.getRutas(eid),
      this.admin.getBuses(eid),
      this.admin.getChoferes(eid),
    ]);
    this.stats = stats;
    this.rutas = rutas;
    this.buses = buses;
    this.choferes = choferes;
  }

  switchTab(tab: string) { this.activeTab = tab; }
  toggleSidebar() { this.sidebarOpen = !this.sidebarOpen; }

  // ---- RUTAS ----
  async addRuta() {
    const alert = await this.alertCtrl.create({
      header: 'Nueva ruta',
      inputs: [
        { name: 'nombre', placeholder: 'Nombre de la ruta', type: 'text' },
        { name: 'origen', placeholder: 'Origen', type: 'text' },
        { name: 'destino', placeholder: 'Destino', type: 'text' },
        { name: 'color', placeholder: 'Color (#hex)', type: 'text', value: '#00c853' },
      ],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Crear',
          handler: async (data) => {
            if (!data.nombre || !data.origen || !data.destino) return false;
            const loading = await this.loadingCtrl.create({ message: 'Creando...' });
            await loading.present();
            try {
              await this.admin.createRuta({
                empresa_id: this.profile!.empresa_id!,
                nombre: data.nombre, origen: data.origen, destino: data.destino,
                color: data.color || '#00c853', estado: 'activa',
              });
              await this.loadData();
              this.showToast('Ruta creada');
            } catch { this.showToast('Error al crear ruta', 'danger'); }
            await loading.dismiss();
            return true;
          },
        },
      ],
    });
    await alert.present();
  }

  async deleteRuta(ruta: Ruta) {
    const alert = await this.alertCtrl.create({
      header: 'Eliminar ruta',
      message: `¿Eliminar "${ruta.nombre}"? Se borrarán sus paradas y horarios.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Eliminar', role: 'destructive', handler: async () => {
          try { await this.admin.deleteRuta(ruta.id); await this.loadData(); this.showToast('Ruta eliminada'); }
          catch { this.showToast('Error', 'danger'); }
        }},
      ],
    });
    await alert.present();
  }

  // ---- BUSES ----
  async addBus() {
    const inputs: any[] = [
      { name: 'placa', placeholder: 'Placa (ej: SJB-001)', type: 'text' },
      { name: 'numero_unidad', placeholder: 'Número de unidad', type: 'text' },
      { name: 'capacidad', placeholder: 'Capacidad', type: 'number', value: '40' },
    ];

    const alert = await this.alertCtrl.create({
      header: 'Nuevo bus',
      inputs,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Crear', handler: async (data) => {
          if (!data.placa) return false;
          try {
            await this.admin.createBus({
              empresa_id: this.profile!.empresa_id!,
              placa: data.placa,
              numero_unidad: data.numero_unidad || null,
              capacidad: parseInt(data.capacidad) || 40,
              estado: 'inactivo',
            });
            await this.loadData();
            this.showToast('Bus creado');
          } catch { this.showToast('Error al crear bus', 'danger'); }
          return true;
        }},
      ],
    });
    await alert.present();
  }

  async assignBusRoute(bus: Bus) {
    const inputs = this.rutas.map(r => ({
      type: 'radio' as const, label: r.nombre, value: r.id,
      checked: bus.ruta_id === r.id,
    }));
    inputs.unshift({ type: 'radio' as const, label: 'Sin ruta', value: '', checked: !bus.ruta_id });

    const alert = await this.alertCtrl.create({
      header: `Asignar ruta a ${bus.placa}`,
      inputs,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Asignar', handler: async (rutaId) => {
          try {
            await this.admin.updateBus(bus.id, { ruta_id: rutaId || null });
            await this.loadData();
            this.showToast('Ruta asignada');
          } catch { this.showToast('Error', 'danger'); }
        }},
      ],
    });
    await alert.present();
  }

  async assignBusChofer(bus: Bus) {
    const inputs = this.choferes.map(c => ({
      type: 'radio' as const, label: c.nombre_completo, value: c.id,
      checked: bus.chofer_id === c.id,
    }));
    inputs.unshift({ type: 'radio' as const, label: 'Sin chofer', value: '', checked: !bus.chofer_id });

    const alert = await this.alertCtrl.create({
      header: `Asignar chofer a ${bus.placa}`,
      inputs,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Asignar', handler: async (choferId) => {
          try {
            await this.admin.updateBus(bus.id, { chofer_id: choferId || null });
            await this.loadData();
            this.showToast('Chofer asignado');
          } catch { this.showToast('Error', 'danger'); }
        }},
      ],
    });
    await alert.present();
  }

  async deleteBus(bus: Bus) {
    const alert = await this.alertCtrl.create({
      header: 'Eliminar bus',
      message: `¿Eliminar ${bus.placa}?`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Eliminar', role: 'destructive', handler: async () => {
          try { await this.admin.deleteBus(bus.id); await this.loadData(); this.showToast('Bus eliminado'); }
          catch { this.showToast('Error', 'danger'); }
        }},
      ],
    });
    await alert.present();
  }

  // ---- CHOFERES ----
  async addChofer() {
    const alert = await this.alertCtrl.create({
      header: 'Nuevo chofer',
      inputs: [
        { name: 'nombre', placeholder: 'Nombre completo', type: 'text' },
        { name: 'email', placeholder: 'Correo electrónico', type: 'email' },
        { name: 'password', placeholder: 'Contraseña temporal', type: 'password' },
      ],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Crear', handler: async (data) => {
          if (!data.nombre || !data.email || !data.password) return false;
          try {
            await this.admin.createChofer(data.email, data.password, data.nombre, this.profile!.empresa_id!);
            await this.loadData();
            this.showToast('Chofer creado');
          } catch (e: any) {
            this.showToast(e?.message || 'Error al crear chofer', 'danger');
          }
          return true;
        }},
      ],
    });
    await alert.present();
  }

  getBusStatus(estado: string): string {
    const map: Record<string, string> = {
      activo: 'Activo', inactivo: 'Inactivo', en_ruta: 'En ruta', mantenimiento: 'Mantenimiento',
    };
    return map[estado] || estado;
  }

  getBusStatusColor(estado: string): string {
    const map: Record<string, string> = {
      activo: '#00c853', inactivo: '#9aa5b4', en_ruta: '#2196f3', mantenimiento: '#ff9800',
    };
    return map[estado] || '#9aa5b4';
  }

  async onLogout() {
    await this.supabase.signOut();
    this.router.navigate(['/auth/login'], { replaceUrl: true });
  }

  private async showToast(msg: string, color = 'success') {
    const t = await this.toastCtrl.create({ message: msg, duration: 2000, color, position: 'top' });
    await t.present();
  }
}
