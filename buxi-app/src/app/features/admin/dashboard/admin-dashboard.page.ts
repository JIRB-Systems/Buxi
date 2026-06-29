import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import * as L from 'leaflet';
import { createClient, RealtimeChannel } from '@supabase/supabase-js';
import { environment } from '../../../../environments/environment';
import { AlertController, LoadingController, ToastController } from '@ionic/angular';
import { SupabaseService } from '../../../core/services/supabase.service';
import { AdminJirbService } from '../../../core/services/admin-jirb.service';
import { UserProfile } from '../../../core/models/user-profile.model';
import { Empresa, Bus, Ruta } from '../../../core/models/transport.model';
import { Calificacion, Viaje, ActivityLog, SystemConfig, Plan, Suscripcion } from '../../../core/models/features.model';
import { BusLocation } from '../../../core/models/transport.model';

@Component({
  selector: 'app-admin-dashboard',
  templateUrl: './admin-dashboard.page.html',
  styleUrls: ['./admin-dashboard.page.scss'],
  standalone: false,
})
export class AdminDashboardPage implements OnInit, OnDestroy {
  private adminMap: L.Map | null = null;
  private adminBusMarkers = new Map<string, L.Marker>();
  private realtimeChannel: RealtimeChannel | null = null;
  profile: UserProfile | null = null;
  activeTab = 'overview';
  loading = true;
  sidebarOpen = true;

  menuItems = [
    { id: 'overview', icon: 'grid-outline', label: 'Resumen' },
    { id: 'mapa', icon: 'map-outline', label: 'Mapa en vivo' },
    { id: 'empresas', icon: 'business-outline', label: 'Empresas' },
    { id: 'rutas', icon: 'git-branch-outline', label: 'Rutas' },
    { id: 'buses', icon: 'bus-outline', label: 'Buses' },
    { id: 'usuarios', icon: 'people-outline', label: 'Usuarios' },
    { id: 'viajes', icon: 'swap-horizontal-outline', label: 'Viajes' },
    { id: 'calificaciones', icon: 'star-outline', label: 'Reseñas' },
    { id: 'logs', icon: 'document-text-outline', label: 'Actividad' },
    { id: 'solicitudes', icon: 'mail-outline', label: 'Solicitudes' },
    { id: 'planes', icon: 'card-outline', label: 'Planes' },
    { id: 'config', icon: 'settings-outline', label: 'Configuración' },
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

  viajes: Viaje[] = [];
  logs: ActivityLog[] = [];
  configItems: SystemConfig[] = [];
  liveLocations: BusLocation[] = [];
  planes: Plan[] = [];
  suscripciones: Suscripcion[] = [];
  suscripcionMap = new Map<string, Suscripcion>();
  solicitudes: any[] = [];

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
    const [stats, empresas, rutas, buses, users, calificaciones, viajes, logs, config, liveLocations, planes, suscripciones, solicitudes] = await Promise.all([
      this.admin.getGlobalStats(),
      this.admin.getEmpresas(),
      this.admin.getAllRutas(),
      this.admin.getAllBuses(),
      this.admin.getAllUsers(),
      this.admin.getAllCalificaciones(),
      this.admin.getViajes(),
      this.admin.getLogs(),
      this.admin.getConfig(),
      this.admin.getAllLiveLocations(),
      this.admin.getPlanes(),
      this.admin.getSuscripciones(),
      this.admin.getSolicitudes(),
    ]);
    this.stats = stats;
    this.empresas = empresas;
    this.rutas = rutas;
    this.buses = buses;
    this.users = users;
    this.calificaciones = calificaciones;
    this.viajes = viajes;
    this.logs = logs;
    this.configItems = config;
    this.liveLocations = liveLocations;
    this.planes = planes;
    this.suscripciones = suscripciones;
    this.solicitudes = solicitudes;
    this.suscripcionMap.clear();
    for (const s of suscripciones) {
      this.suscripcionMap.set(s.empresa_id, s);
    }
    this.applyUserFilter();
  }

  switchTab(tab: string) {
    this.activeTab = tab;
    if (tab === 'mapa') {
      setTimeout(() => this.initAdminMap(), 150);
    }
  }

  toggleSidebar() { this.sidebarOpen = !this.sidebarOpen; }

  private initAdminMap() {
    if (this.adminMap) { this.adminMap.remove(); this.adminMap = null; }

    const el = document.getElementById('admin-map');
    if (!el) return;

    this.adminMap = L.map('admin-map', {
      center: [9.9281, -84.0907], zoom: 10,
      zoomControl: true, attributionControl: false,
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
    }).addTo(this.adminMap);

    this.adminBusMarkers.forEach(m => m.remove());
    this.adminBusMarkers.clear();

    for (const loc of this.liveLocations) {
      this.addAdminBusMarker(loc);
    }

    if (this.liveLocations.length > 0) {
      const bounds = L.latLngBounds(this.liveLocations.map(l => [l.latitud, l.longitud] as L.LatLngTuple));
      this.adminMap.fitBounds(bounds, { padding: [40, 40] });
    }

    this.startMapRealtime();
    setTimeout(() => this.adminMap?.invalidateSize(), 200);
  }

  private addAdminBusMarker(loc: BusLocation) {
    if (!this.adminMap) return;
    const busInfo = loc.bus as any;
    const color = busInfo?.ruta?.color || '#00c853';

    if (this.adminBusMarkers.has(loc.bus_id)) {
      this.adminBusMarkers.get(loc.bus_id)!.setLatLng([loc.latitud, loc.longitud]);
      return;
    }

    const icon = L.divIcon({
      className: 'admin-bus-marker',
      html: `<div style="width:28px;height:28px;background:${color};border-radius:50%;border:2px solid #fff;display:grid;place-items:center;box-shadow:0 2px 6px rgba(0,0,0,0.3)"><svg viewBox="0 0 24 24" fill="white" width="12" height="12"><path d="M4 16c0 .88.39 1.67 1 2.22V20c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h8v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1.78c.61-.55 1-1.34 1-2.22V6c0-3.5-3.58-4-8-4s-8 .5-8 4v10zm3.5 1c-.83 0-1.5-.67-1.5-1.5S6.67 14 7.5 14s1.5.67 1.5 1.5S8.33 17 7.5 17zm9 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm1.5-6H6V6h12v5z"/></svg></div>`,
      iconSize: [28, 28], iconAnchor: [14, 14],
    });

    const marker = L.marker([loc.latitud, loc.longitud], { icon })
      .addTo(this.adminMap)
      .bindPopup(`<b>${busInfo?.placa || 'Bus'}</b><br>${busInfo?.ruta?.nombre || 'Sin ruta'}<br>${loc.velocidad} km/h`);

    this.adminBusMarkers.set(loc.bus_id, marker);
  }

  private startMapRealtime() {
    const sb = createClient(environment.supabaseUrl, environment.supabaseAnonKey);
    this.realtimeChannel = sb.channel('admin-live-map')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bus_locations' }, (payload) => {
        const loc = payload.new as BusLocation;
        this.addAdminBusMarker(loc);
      })
      .subscribe();
  }

  ngOnDestroy() {
    if (this.adminMap) this.adminMap.remove();
    if (this.realtimeChannel) {
      const sb = createClient(environment.supabaseUrl, environment.supabaseAnonKey);
      sb.removeChannel(this.realtimeChannel);
    }
  }

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
            const emp = await this.admin.createEmpresa({
              nombre: d.nombre, cedula_juridica: d.cedula_juridica || null,
              telefono: d.telefono || null, email: d.email || null, estado: 'activo',
            });
            await this.logAction('Crear empresa', d.nombre, 'empresa', emp.id);
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
          try { await this.admin.deleteEmpresa(empresa.id); await this.logAction('Eliminar empresa', empresa.nombre, 'empresa', empresa.id); await this.loadData(); this.showToast('Empresa eliminada'); }
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
          try { await this.admin.deleteRuta(ruta.id); await this.logAction('Eliminar ruta', ruta.nombre, 'ruta', ruta.id); await this.loadData(); this.showToast('Ruta eliminada'); }
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
          try { await this.admin.deleteBus(bus.id); await this.logAction('Eliminar bus', bus.placa, 'bus', bus.id); await this.loadData(); this.showToast('Bus eliminado'); }
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
          await this.logAction('Cambiar rol', `${rol} en empresa`, 'usuario', userId);
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

  get pendingSolicitudes(): number {
    return this.solicitudes.filter(s => s.estado === 'pendiente').length;
  }

  async approveSolicitud(sol: any) {
    const alert = await this.alertCtrl.create({
      header: 'Aprobar solicitud',
      message: `Se creará la empresa "${sol.nombre_empresa}" y una cuenta admin_empresa para ${sol.email}`,
      inputs: [
        { name: 'password', placeholder: 'Contraseña temporal para el admin', type: 'password', value: 'Buxi2024!' },
      ],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Aprobar y crear', handler: async (data) => {
          const loading = await this.loadingCtrl.create({ message: 'Creando empresa y cuenta...' });
          await loading.present();
          try {
            const empresa = await this.admin.createEmpresa({
              nombre: sol.nombre_empresa,
              cedula_juridica: sol.cedula_juridica || null,
              telefono: sol.telefono || null,
              email: sol.email || null,
              logo_url: sol.logo_url || null,
              estado: 'activo',
            });

            await this.admin.createAdminEmpresa(
              sol.email, data.password || 'Buxi2024!',
              sol.nombre_contacto, empresa.id
            );

            await this.admin.updateSolicitud(sol.id, 'aprobada');
            await this.logAction('Aprobar solicitud', `${sol.nombre_empresa} + cuenta ${sol.email}`, 'solicitud', sol.id);
            await this.loadData();
            this.showToast(`Empresa y cuenta admin creadas. Credenciales: ${sol.email}`);
          } catch (e: any) {
            this.showToast(e?.message || 'Error al aprobar', 'danger');
          }
          await loading.dismiss();
          return true;
        }},
      ],
    });
    await alert.present();
  }

  async rejectSolicitud(sol: any) {
    await this.admin.updateSolicitud(sol.id, 'rechazada');
    await this.logAction('Rechazar solicitud', sol.nombre_empresa, 'solicitud', sol.id);
    await this.loadData();
    this.showToast('Solicitud rechazada');
  }

  getEmpresaPlan(empresaId: string): string {
    const sub = this.suscripcionMap.get(empresaId);
    return (sub?.plan as any)?.nombre || 'Sin plan';
  }

  getEmpresaPlanColor(empresaId: string): string {
    const name = this.getEmpresaPlan(empresaId);
    if (name === 'Enterprise') return '#ff5722';
    if (name === 'Pro') return '#9c27b0';
    if (name === 'Básico') return '#2196f3';
    return '#b0b8c4';
  }

  async changePlan(empresa: Empresa) {
    const inputs = this.planes.map(p => ({
      type: 'radio' as const,
      label: `${p.nombre} (${p.max_buses} buses, ${p.max_rutas === 9999 ? '∞' : p.max_rutas} rutas)`,
      value: p.id,
      checked: this.getEmpresaPlan(empresa.id) === p.nombre,
    }));

    const alert = await this.alertCtrl.create({
      header: `Plan de ${empresa.nombre}`,
      inputs,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Asignar', handler: async (planId) => {
          if (!planId) return false;
          await this.admin.assignPlan(empresa.id, planId);
          await this.logAction('Cambiar plan', `${empresa.nombre}`, 'empresa', empresa.id);
          await this.loadData();
          this.showToast('Plan actualizado');
          return true;
        }},
      ],
    });
    await alert.present();
  }

  async updatePlanPrice(plan: Plan, newPrice: string) {
    const price = parseFloat(newPrice);
    if (isNaN(price)) return;
    await this.admin.updatePlan(plan.id, { precio_mensual: price });
    plan.precio_mensual = price;
    this.showToast('Precio actualizado');
  }

  getTabTitle(): string {
    const titles: Record<string, string> = {
      overview: 'Resumen general', mapa: 'Mapa en tiempo real',
      empresas: 'Gestión de empresas', rutas: 'Gestión de rutas',
      buses: 'Gestión de buses', usuarios: 'Gestión de usuarios',
      viajes: 'Historial de viajes', calificaciones: 'Reseñas y calificaciones',
      solicitudes: 'Solicitudes de empresas', logs: 'Registro de actividad', planes: 'Planes y suscripciones',
      config: 'Configuración del sistema',
    };
    return titles[this.activeTab] || '';
  }

  async updateConfigValue(item: SystemConfig, newValue: string) {
    try {
      await this.admin.updateConfig(item.key, newValue);
      item.value = newValue;
      this.showToast('Configuración actualizada');
    } catch { this.showToast('Error', 'danger'); }
  }

  getConfigLabel(key: string): string {
    const labels: Record<string, string> = {
      gps_refresh_seconds: 'Refresco GPS (segundos)',
      max_speed_kmh: 'Velocidad máxima (km/h)',
      operating_hours_start: 'Hora inicio operaciones',
      operating_hours_end: 'Hora fin operaciones',
      eta_enabled: 'ETA habilitado',
      maintenance_alert_km: 'Alerta mantenimiento (km)',
    };
    return labels[key] || key;
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

  private async logAction(accion: string, detalle?: string, entidad?: string, entidadId?: string) {
    try {
      await this.admin.addLog(this.profile?.id || null, accion, detalle, entidad, entidadId);
    } catch {}
  }

  private async showToast(msg: string, color = 'success') {
    const t = await this.toastCtrl.create({ message: msg, duration: 2000, color, position: 'top' });
    await t.present();
  }
}
