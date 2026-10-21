// Utilidades para mostrar los datos de ARESEP, que vienen en mayúsculas y
// con guiones pegados: "LIBERIA-LA CRUZ-PEÑAS BLANCAS".

const MINUSCULAS = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'a', 'en', 'por', 'con']);
// Abreviaturas y siglas que no se tocan.
const SIGLAS = new Set(['UCR', 'UNA', 'TEC', 'CCSS', 'INS', 'ICE', 'MOPT', 'UNED', 'II', 'III', 'IV']);

// ARESEP escribe sin tilde muchos nombres ("SAN JOSE" sale 1.527 veces y
// "SAN JOSÉ" 2). Solo palabras que en Costa Rica siempre la llevan; las
// ambiguas (canas/cañas) se dejan como vienen.
const TILDES: Record<string, string> = {
  minima: 'mínima', jose: 'josé', limon: 'limón', ramon: 'ramón', paraiso: 'paraíso',
  belen: 'belén', tibas: 'tibás', aserri: 'aserrí', guacimo: 'guácimo', poas: 'poás',
  turrucares: 'turrúcares', sarapiqui: 'sarapiquí', estacion: 'estación', sanchez: 'sánchez',
  rodriguez: 'rodríguez', catolica: 'católica', maria: 'maría', corazon: 'corazón',
  jesus: 'jesús', angeles: 'ángeles', quiros: 'quirós', perez: 'pérez', gonzalez: 'gonzález',
  colon: 'colón', leon: 'león',
};

function palabra(p: string, primera: boolean): string {
  if (!p) return p;
  if (SIGLAS.has(p.toUpperCase())) return p.toUpperCase();
  const minus = p.toLocaleLowerCase('es-CR');
  const baja = TILDES[minus] ?? minus;
  if (!primera && MINUSCULAS.has(baja)) return baja;
  return baja.charAt(0).toLocaleUpperCase('es-CR') + baja.slice(1);
}

// "LIBERIA-LA CRUZ" → "Liberia – La Cruz". Cada tramo entre guiones empieza
// con mayúscula, aunque sea "la" o "el".
export function tituloAresep(texto: string | null | undefined): string {
  if (!texto) return '';
  return texto
    .trim()
    .split(/\s*-\s*/)
    .filter(Boolean)
    .map(tramo => tramo.split(/\s+/).map((p, i) => palabra(p, i === 0)).join(' '))
    .join(' – ');
}

// La tarifa de adulto mayor como se lee en pantalla.
export function tarifaAdultoMayorTexto(monto: number | null | undefined): string {
  if (monto === null || monto === undefined) return '—';
  if (monto === 0) return 'Gratis';
  return '₡' + Math.round(monto).toLocaleString('es-CR');
}

// Regla de ARESEP para personas de 65 años o más, por largo del recorrido.
export const REGLA_ADULTO_MAYOR =
  'Personas de 65 años o más: gratis en recorridos de menos de 25 km, la mitad entre 25 y 50 km y el 75 % en más de 50 km.';
