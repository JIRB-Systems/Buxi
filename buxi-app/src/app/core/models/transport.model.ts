export interface Empresa {
  id: string;
  nombre: string;
  cedula_juridica: string | null;
  telefono: string | null;
  email: string | null;
  logo_url: string | null;
  estado: string;
  // Personalización del bus. null = usar el color de la ruta, que es como se
  // venía pintando y lo que ve una empresa que nunca entró a personalizar.
  color_bus?: string | null;
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
  geometria: [number, number][] | null;
  precio: number | null;
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
  chofer?: { nombre_completo: string } | null;
}

export interface BusLocation {
  id: string;
  bus_id: string;
  latitud: number;
  longitud: number;
  velocidad: number;
  heading: number;
  timestamp: string;
  anomalo?: boolean;
  bus?: Bus;
}
