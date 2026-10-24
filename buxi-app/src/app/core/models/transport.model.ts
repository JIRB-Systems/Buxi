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
  // Modelo del bus (ver core/utils/bus-modelos). null = urbano.
  modelo_bus?: string | null;
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
  // Código oficial (CTP/ARESEP), ej. "521".
  codigo_ruta?: string | null;
  // Tramo de ARESEP del que sale el precio; con esto el precio lo fija la base.
  aresep_fraccionamiento?: string | null;
  empresa?: Empresa;
}

// Una fila de las tarifas vigentes que publica ARESEP (tabla tarifas_aresep).
export interface TarifaAresep {
  codigo_fraccionamiento: string;
  codigo_ruta: string;
  nombre_ruta: string;
  codigo_ramal: string | null;
  nombre_ramal: string | null;
  nombre_fraccionamiento: string;
  km: number | null;
  tarifa_regular: number;
  tarifa_adulto_mayor: number | null;
  resolucion: string | null;
  fecha_vigencia: string | null;
  operadores: string | null;
  vigente: boolean;
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
  // Personalización propia de esta unidad. null = la de la flota
  // (empresas.color_bus / empresas.modelo_bus).
  color_bus?: string | null;
  modelo_bus?: string | null;
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
