export interface Empresa {
  id: string;
  nombre: string;
  cedula_juridica: string | null;
  telefono: string | null;
  email: string | null;
  logo_url: string | null;
  estado: string;
}

export interface Ruta {
  id: string;
  empresa_id: string;
  nombre: string;
  descripcion: string | null;
  origen: string;
  destino: string;
  color: string;
  estado: string;
  empresa?: Empresa;
}

export interface Parada {
  id: string;
  ruta_id: string;
  nombre: string;
  latitud: number;
  longitud: number;
  orden: number;
}

export interface Bus {
  id: string;
  empresa_id: string;
  ruta_id: string | null;
  placa: string;
  numero_unidad: string | null;
  capacidad: number;
  chofer_id: string | null;
  estado: string;
  ruta?: Ruta;
  empresa?: Empresa;
}

export interface BusLocation {
  id: string;
  bus_id: string;
  latitud: number;
  longitud: number;
  velocidad: number;
  heading: number;
  timestamp: string;
  bus?: Bus;
}
