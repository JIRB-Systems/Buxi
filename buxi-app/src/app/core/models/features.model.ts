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
