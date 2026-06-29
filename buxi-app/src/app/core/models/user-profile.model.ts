export type UserRole = 'pasajero' | 'chofer' | 'admin_empresa' | 'admin_jirb';
export type UserStatus = 'activo' | 'inactivo' | 'suspendido';

export interface UserProfile {
  id: string;
  nombre_completo: string;
  correo: string;
  telefono: string | null;
  provincia: string | null;
  rol: UserRole;
  empresa_id: string | null;
  estado: UserStatus;
  foto_url: string | null;
  created_at: string;
}
