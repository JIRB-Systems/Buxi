import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController, LoadingController, ToastController } from '@ionic/angular';
import { SupabaseService } from '../../../core/services/supabase.service';
import { AdminJirbService } from '../../../core/services/admin-jirb.service';
import { UserProfile } from '../../../core/models/user-profile.model';
import { Empresa, Bus, Ruta } from '../../../core/models/transport.model';
import { Calificacion } from '../../../core/models/features.model';

@Component({
  selector: 'app-admin-dashboard',
  templateUrl: './admin-dashboard.page.html',
  styleUrls: ['./admin-dashboard.page.scss'],
  standalone: false,
})
export class AdminDashboardPage implements OnInit {
  profile: UserProfile | null = null;
  activeTab = 'overview';
  loading = true;
  sidebarOpen = true;

  menuItems = [
    { id: 'overview', icon: 'grid-outline', label: 'Resumen' },
    { id: 'empresas', icon: 'business-outline', label: 'Empresas' },
    { id: 'rutas', icon: 'git-branch-outline', label: 'Rutas' },
    { id: 'buses', icon: 'bus-outline', label: 'Buses' },
    { id: 'usuarios', icon: 'people-outline', label: 'Usuarios' },
    { id: 'calificaciones', icon: 'star-outline', label: 'Reseñas' },
  ];

  stats = {
    totalEmpresas: 0, totalRutas: 0, totalBuses: 0, totalChoferes: 0,
    totalPasajeros: 0, busesEnRuta: 0, totalCalificaciones: 0, promedioGeneral: 0,
  };

  empresas: Empresa[] = [];
  rutas: Ruta[] = [];
  buses: Bus[] = [];
  users: UserProfile[] = [];
  calificaciones: Calificacion[] = [];

  filteredUsers: UserProfile[] = [];
  userRoleFilter = 'todos';
  userSearch = '';

  constructor(
    private supabase: SupabaseService,
    private admin: AdminJirbService,
    private router: Router,
    private alertCtrl: AlertController,
    private loadingCtrl: LoadingController,
    private toastCtrl: ToastController,
  ) {}

  async ngOnInit() {
    try {
      this.profile = await this.supabase.getProfile();
      await this.loadData();
    } catch {} finally { this.loading = false; }
  }

  async loadData() {
    const [stats, empresas, rutas, buses, users, calificaciones] = await Promise.all([
      this.admin.getGlobalStats(),
      this.admin.getEmpresas(),
      this.admin.getAllRutas(),
      this.admin.getAllBuses(),
      this.admin.getAllUsers(),
      this.admin.getAllCalificaciones(),
    ]);
    this.stats = stats;
    this.empresas = empresas;
    this.rutas = rutas;
    this.buses = buses;
    this.users = users;
    this.calificaciones = calificaciones;
    this.applyUserFilter();
  }

  switchTab(tab: string) { this.activeTab = tab; }
  toggleSidebar() { this.sidebarOpen = !this.sidebarOpen; }

  // ---- EMPRESAS ----
  async addEmpresa() {
    const alert = await this.alertCtrl.create({
      header: 'Nueva empresa',
      inputs: [
        { name: 'nombre', placeholder: 'Nombre de la empresa', type: 'text' },
        { name: 'cedula_juridica', placeholder: 'Cédula jurídica', type: 'text' },
        { name: 'telefono', placeholder: 'Teléfono', type: 'tel' },
        { name: 'email', placeholder: 'Correo', type: 'email' },
      ],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Crear', handler: async (d) => {
          if (!d.nombre) return false;
          try {
            await this.admin.createEmpresa({
              nombre: d.nombre, cedula_juridica: d.cedula_juridica || null,
              telefono: d.telefono || null, email: d.email || null, estado: 'activo',
            });
            await this.loadData(); this.showToast('Empresa creada');
          } catch { this.showToast('Error', 'danger'); }
          return true;
        }},
      ],
    });
    await alert.present();
  }

  async toggleEmpresaStatus(empresa: Empresa) {
    const newStatus = empresa.estado === 'activo' ? 'inactivo' : 'activo';
    await this.admin.updateEmpresa(empresa.id, { estado: newStatus });
    await this.loadData();
    this.showToast(`Empresa ${newStatus === 'activo' ? 'activada' : 'desactivada'}`);
  }

  async deleteEmpresa(empresa: Empresa) {
    const alert = await this.alertCtrl.create({
      header: 'Eliminar empresa',
      message: `¿Eliminar "${empresa.nombre}"? Se borrarán todas sus rutas, buses y datos asociados.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Eliminar', role: 'destructive', handler: async () => {
          try { await this.admin.deleteEmpresa(empresa.id); await this.loadData(); this.showToast('Empresa eliminada'); }
          catch { this.showToast('Error', 'danger'); }
        }},
      ],
    });
    await alert.present();
  }

  // ---- RUTAS ----
  async addRuta() {
    const empresaInputs = this.empresas.map(e => ({
      type: 'radio' as const, label: e.nombre, value: e.id,
    }));

    const step1 = await this.alertCtrl.create({
      header: 'Seleccionar empresa',
      inputs: empresaInputs,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Siguiente', handler: (empresaId) => {
          if (!empresaId) return false;
          this.addRutaStep2(empresaId);
          return true;
        }},
      ],
    });
    await step1.present();
  }

  private async addRutaStep2(empresaId: string) {
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
        { text: 'Crear', handler: async (d) => {
          if (!d.nombre || !d.origen || !d.destino) return false;
          try {
            await this.admin.createRuta({
              empresa_id: empresaId, nombre: d.nombre, origen: d.origen,
              destino: d.destino, color: d.color || '#00c853', estado: 'activa',
            });
            await this.loadData(); this.showToast('Ruta creada');
          } catch { this.showToast('Error', 'danger'); }
          return true;
        }},
      ],
    });
    await alert.present();
  }

  async toggleRutaStatus(ruta: Ruta) {
    const newStatus = ruta.estado === 'activa' ? 'inactiva' : 'activa';
    await this.admin.updateRuta(ruta.id, { estado: newStatus });
    await this.loadData();
  }

  async deleteRuta(ruta: Ruta) {
    const alert = await this.alertCtrl.create({
      header: 'Eliminar ruta',
      message: `¿Eliminar "${ruta.nombre}"?`,
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
  async deleteBus(bus: Bus) {
    const alert = await this.alertCtrl.create({
      header: 'Eliminar bus', message: `¿Eliminar ${bus.placa}?`,
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

  getBusStatusLabel(estado: string): string {
    return { activo: 'Activo', inactivo: 'Inactivo', en_ruta: 'En ruta', mantenimiento: 'Mant.' }[estado] || estado;
  }

  getBusStatusColor(estado: string): string {
    return { activo: '#00c853', inactivo: '#9aa5b4', en_ruta: '#2196f3', mantenimiento: '#ff9800' }[estado] || '#9aa5b4';
  }

  // ---- USUARIOS ----
  onUserSearch(event: any) {
    this.userSearch = (event.detail.value || '').toLowerCase();
    this.applyUserFilter();
  }

  filterByRole(role: string) {
    this.userRoleFilter = role;
    this.applyUserFilter();
  }

  private applyUserFilter() {
    let list = this.users;
    if (this.userRoleFilter !== 'todos') {
      list = list.filter(u => u.rol === this.userRoleFilter);
    }
    if (this.userSearch) {
      list = list.filter(u =>
        u.nombre_completo.toLowerCase().includes(this.userSearch) ||
        u.correo.toLowerCase().includes(this.userSearch)
      );
    }
    this.filteredUsers = list;
  }

  async changeUserRole(user: UserProfile) {
    const inputs = [
      { type: 'radio' as const, label: 'Pasajero', value: 'pasajero', checked: user.rol === 'pasajero' },
      { type: 'radio' as const, label: 'Chofer', value: 'chofer', checked: user.rol === 'chofer' },
      { type: 'radio' as const, label: 'Admin Empresa', value: 'admin_empresa', checked: user.rol === 'admin_empresa' },
      { type: 'radio' as const, label: 'Admin JIRB', value: 'admin_jirb', checked: user.rol === 'admin_jirb' },
    ];

    const alert = await this.alertCtrl.create({
      header: `Rol de ${user.nombre_completo}`,
      inputs,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Guardar', handler: async (rol) => {
          if (rol === 'chofer' || rol === 'admin_empresa') {
            this.assignUserToEmpresa(user.id, rol);
          } else {
            await this.admin.updateUserRole(user.id, rol, null);
            await this.loadData(); this.showToast('Rol actualizado');
          }
        }},
      ],
    });
    await alert.present();
  }

  private async assignUserToEmpresa(userId: string, rol: string) {
    const inputs = this.empresas.map(e => ({
      type: 'radio' as const, label: e.nombre, value: e.id,
    }));

    const alert = await this.alertCtrl.create({
      header: 'Asignar a empresa',
      inputs,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Asignar', handler: async (empresaId) => {
          if (!empresaId) return false;
          await this.admin.updateUserRole(userId, rol, empresaId);
          await this.loadData(); this.showToast('Usuario asignado');
          return true;
        }},
      ],
    });
    await alert.present();
  }

  async toggleUserStatus(user: UserProfile) {
    const newStatus = user.estado === 'activo' ? 'suspendido' : 'activo';
    await this.admin.updateUserStatus(user.id, newStatus);
    await this.loadData();
    this.showToast(`Usuario ${newStatus === 'activo' ? 'activado' : 'suspendido'}`);
  }

  getRoleLabel(rol: string): string {
    return { pasajero: 'Pasajero', chofer: 'Chofer', admin_empresa: 'Admin Empresa', admin_jirb: 'Admin JIRB' }[rol] || rol;
  }

  getRoleColor(rol: string): string {
    return { pasajero: '#00c853', chofer: '#2196f3', admin_empresa: '#9c27b0', admin_jirb: '#ff5722' }[rol] || '#9aa5b4';
  }

  // ---- CALIFICACIONES ----
  async deleteCalificacion(cal: Calificacion) {
    await this.admin.deleteCalificacion(cal.id);
    await this.loadData();
    this.showToast('Calificación eliminada');
  }

  getStars(n: number): number[] {
    return Array.from({ length: 5 }, (_, i) => i < n ? 1 : 0);
  }

  async onLogout() {
    await this.supabase.signOut();
    this.router.navigate(['/auth/login'], { replaceUrl: true });
  }

  async refreshData() {
    const loading = await this.loadingCtrl.create({ message: 'Actualizando...' });
    await loading.present();
    await this.loadData();
    await loading.dismiss();
  }

  private async showToast(msg: string, color = 'success') {
    const t = await this.toastCtrl.create({ message: msg, duration: 2000, color, position: 'top' });
    await t.present();
  }
}
