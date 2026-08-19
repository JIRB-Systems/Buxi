export interface Favorito {
  id: string;
  user_id: string;
  ruta_id: string;
  created_at: string;
}

export interface Horario {
  id: string;
  ruta_id: string;
  dia: 'lunes_viernes' | 'sabado' | 'domingo';
  primera_salida: string;
  ultima_salida: string;
  frecuencia_minutos: number;
  notas: string | null;
}

// Reemplaza a Horario: una hora exacta de salida en vez de un rango con
// frecuencia pareja, que no representa cómo salen los buses en la realidad.
export interface HorarioSalida {
  id: string;
  ruta_id: string;
  dia: 'lunes_viernes' | 'sabado' | 'domingo';
  hora: string;
}

export interface Calificacion {
  id: string;
  user_id: string;
  ruta_id: string;
  bus_id: string | null;
  estrellas: number;
  comentario: string | null;
  created_at: string;
}

export interface UserPreferences {
  user_id: string;
  dark_mode: boolean;
  notifications_enabled: boolean;
}

export interface Viaje {
  id: string;
  bus_id: string;
  chofer_id: string;
  ruta_id: string;
  inicio: string;
  fin: string | null;
  estado: 'en_curso' | 'completado' | 'cancelado';
  distancia_km: number;
  created_at: string;
  bus?: any;
  chofer?: any;
  ruta?: any;
}

export interface ActivityLog {
  id: string;
  user_id: string | null;
  accion: string;
  detalle: string | null;
  entidad: string | null;
  entidad_id: string | null;
  created_at: string;
}

export interface SystemConfig {
  key: string;
  value: string;
  description: string | null;
}

export interface Plan {
  id: string;
  nombre: string;
  max_buses: number;
  max_rutas: number;
  gps_intervalo_seg: number;
  precio_mensual: number;
  descripcion: string | null;
  activo: boolean;
}

export interface Suscripcion {
  id: string;
  empresa_id: string;
  plan_id: string;
  fecha_inicio: string;
  fecha_fin: string | null;
  estado: 'activa' | 'vencida' | 'cancelada' | 'prueba';
  auto_renovar: boolean;
  plan?: Plan;
}

export interface SolicitudPlan {
  id: string;
  empresa_id: string;
  plan_id: string;
  estado: 'pendiente' | 'resuelta';
  created_at: string;
  plan?: Plan;
  empresa?: { id: string; nombre: string };
}

export interface Factura {
  id: string;
  empresa_id: string;
  plan_id: string;
  numero: string;
  monto: number;
  fecha: string;
  created_at: string;
  plan?: { nombre: string };
  empresa?: { nombre: string; cedula_juridica: string | null };
}

export interface ReporteBug {
  id: string;
  empresa_id: string;
  autor_id: string | null;
  titulo: string;
  descripcion: string;
  estado: 'pendiente' | 'en_revision' | 'resuelto';
  respuesta_jirb: string | null;
  respondido_por: string | null;
  respondido_at: string | null;
  created_at: string;
  empresa?: { nombre: string };
  autor?: { nombre_completo: string };
}

export interface AvisoSistema {
  id: string;
  autor_id: string | null;
  titulo: string;
  mensaje: string;
  tipo: 'info' | 'advertencia' | 'urgente';
  activo: boolean;
  created_at: string;
}

export interface Anuncio {
  id: string;
  autor_id: string | null;
  titulo: string;
  descripcion: string | null;
  tipo_espacio: 'apertura' | 'lista';
  media_tipo: 'imagen' | 'video';
  media_url: string;
  logo_url: string | null;
  link_url: string | null;
  animacion: 'ninguna' | 'fade' | 'slide' | 'zoom' | 'pulso';
  fecha_inicio: string;
  fecha_fin: string | null;
  activo: boolean;
  orden: number;
  created_at: string;
}
