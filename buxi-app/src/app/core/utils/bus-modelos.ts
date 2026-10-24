import { colorSeguro } from './html';

// Los modelos de bus que una empresa puede elegir en Personalización, para
// toda su flota o para algunas unidades.
//
// Cada uno tiene dos vistas, dibujadas a mano como SVG: desde arriba (la que
// va a usar el mapa, girada según el rumbo) y de costado (la ficha del bus).
// La carrocería toma el color de la ruta o de la flota; vidrios, ruedas y
// luces no se tiñen.
//
// Las medidas van a escala real (1 unidad = 10 cm de largo) para que en la
// grilla se lea el tamaño: el microbús se ve chico y el articulado largo. La
// vista de arriba exagera un poco el ancho, que a escala real quedaba como un
// fideo al lado de la de costado.
//
// Vive en core/utils y no en el panel porque los mapas del pasajero y del
// chofer van a dibujar con estas mismas funciones: una sola fuente para que
// la previa no mienta sobre cómo se ve el bus de verdad.

export type ModeloBus =
  | 'urbano' | 'buseta' | 'interurbano' | 'articulado' | 'microbus' | 'electrico'
  | 'dos_pisos' | 'trompa' | 'panoramico' | 'piso_bajo' | 'shuttle' | 'descapotable';

export interface InfoModeloBus {
  id: ModeloBus;
  nombre: string;
  descripcion: string;
  idealPara: string;
}

export const MODELO_BUS_DEFECTO: ModeloBus = 'urbano';

export const MODELOS_BUS: readonly InfoModeloBus[] = [
  { id: 'urbano', nombre: 'Urbano',
    descripcion: 'Bus de 12 m con dos puertas y aire acondicionado en el techo.',
    idealPara: 'rutas dentro de la ciudad' },
  { id: 'buseta', nombre: 'Buseta',
    descripcion: 'Bus corto de unos 8 m, con trompa redondeada y una sola puerta.',
    idealPara: 'rutas de barrio y cortas' },
  { id: 'interurbano', nombre: 'Interurbano',
    descripcion: 'Bus alto con vidrios polarizados y maleteros a los lados.',
    idealPara: 'viajes largos, como Liberia – San José' },
  { id: 'articulado', nombre: 'Articulado',
    descripcion: 'Dos cuerpos unidos por un fuelle. Lleva casi el doble de pasajeros.',
    idealPara: 'rutas troncales con mucha gente' },
  { id: 'microbus', nombre: 'Microbús',
    descripcion: 'Van de 12 a 20 asientos, con capó adelante.',
    idealPara: 'transporte de turismo y empresas' },
  { id: 'electrico', nombre: 'Eléctrico',
    descripcion: 'Bus urbano de líneas suaves, con baterías en el techo y el rayo como distintivo.',
    idealPara: 'empresas con flota eléctrica' },
  { id: 'dos_pisos', nombre: 'Dos pisos',
    descripcion: 'Dos niveles de asientos y una ventana de techo para el piso de arriba.',
    idealPara: 'rutas con mucha demanda y turismo' },
  { id: 'trompa', nombre: 'De trompa',
    descripcion: 'El clásico con el motor adelante y ventanas separadas, como los de las rutas rurales.',
    idealPara: 'rutas rurales y de montaña' },
  { id: 'panoramico', nombre: 'Panorámico',
    descripcion: 'Ventanas grandes que suben hasta el techo para ver el paisaje.',
    idealPara: 'rutas turísticas, como volcanes y playas' },
  { id: 'piso_bajo', nombre: 'Piso bajo accesible',
    descripcion: 'Entrada al nivel de la acera, con rampa para silla de ruedas en la puerta del medio.',
    idealPara: 'mostrar qué unidades son accesibles' },
  { id: 'shuttle', nombre: 'Shuttle de aeropuerto',
    descripcion: 'Puerta doble ancha y parrilla en el techo para maletas.',
    idealPara: 'traslados a aeropuertos y hoteles' },
  { id: 'descapotable', nombre: 'Turístico descapotable',
    descripcion: 'Piso de arriba abierto, con baranda y asientos al aire libre.',
    idealPara: 'tours por la ciudad' },
];

export function nombreModeloBus(modelo: string | null | undefined): string {
  return MODELOS_BUS.find(m => m.id === modelo)?.nombre ?? '';
}

export function esModeloBus(valor: unknown): valor is ModeloBus {
  return MODELOS_BUS.some(m => m.id === valor);
}

// ---- Colores fijos (lo que no se tiñe) ----
const VIDRIO = '#d7e5f6';
const VIDRIO_OSC = '#1a2841';
const RUEDA = '#141b27';
const RIN = '#8391a8';
const FARO = '#ffd36b';
const STOP = '#ff5a52';
const MENTA = '#6ef2a8';
const FUELLE = '#252f3e';
const FUELLE_PLIEGUE = '#3b475a';
const METAL = '#c9d3e0';
const ACCESIBLE = '#2f8bff';
const ASIENTO = '#3a4a63';

// Mezcla dos colores hex. t = 0 devuelve `a`, t = 1 devuelve `b`.
function mezclar(a: string, b: string, t: number): string {
  const n = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const [r1, g1, b1] = n(a);
  const [r2, g2, b2] = n(b);
  const c = (x: number, y: number) => Math.round(x + (y - x) * t).toString(16).padStart(2, '0');
  return `#${c(r1, r2)}${c(g1, g2)}${c(b1, b2)}`;
}

interface Tinta { c: string; osc: string; arco: string; claro: string; borde: string }

function tinta(color: string | null | undefined): Tinta {
  // colorSeguro deja pasar solo #rrggbb: el valor termina dentro de un SVG
  // que se inserta como HTML.
  const c = colorSeguro(color, '#00c853');
  return {
    c,
    osc: mezclar(c, '#000000', 0.3),
    arco: mezclar(c, '#000000', 0.55),
    claro: mezclar(c, '#ffffff', 0.35),
    borde: mezclar(c, '#000000', 0.45),
  };
}

const svg = (viewBox: string, cuerpo: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="100%" height="100%" ` +
  `preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">${cuerpo}</svg>`;

// ============================================================================
// DE COSTADO: viewBox 200 × 56, el frente a la derecha, la base del cuerpo en
// y = 46 y el piso en y = 52.
// ============================================================================
const BASE = 46;

function sombraLado(x0: number, x1: number): string {
  return `<ellipse cx="${(x0 + x1) / 2}" cy="52.3" rx="${(x1 - x0) / 2 + 2}" ry="1.6" fill="#000" opacity=".28"/>`;
}

function rueda(x: number, t: Tinta, r = 5.5, rin = RIN, rinR = 0.45): string {
  const a = r + 1.4;
  return `<path d="M${x - a} ${BASE}A${a} ${a} 0 0 1 ${x + a} ${BASE}Z" fill="${t.arco}"/>` +
    `<circle cx="${x}" cy="${BASE}" r="${r}" fill="${RUEDA}"/>` +
    `<circle cx="${x}" cy="${BASE}" r="${(r * rinR).toFixed(2)}" fill="${rin}"/>`;
}

// Faldón oscuro con las esquinas de abajo redondeadas, para que no asome
// fuera de la carrocería.
function faldon(x0: number, x1: number, y: number, t: Tinta, r = 3.6): string {
  const b = BASE - 0.3;
  return `<path d="M${x0 + 0.3} ${y}H${x1 - 0.3}V${b - r}Q${x1 - 0.3} ${b} ${x1 - r} ${b}H${x0 + r}Q${x0 + 0.3} ${b} ${x0 + 0.3} ${b - r}Z" fill="${t.osc}"/>`;
}

function puerta(x: number, y: number, alto: number, t: Tinta, vidrio = VIDRIO, ancho = 7.5): string {
  return `<rect x="${x}" y="${y}" width="${ancho}" height="${alto}" rx="1" fill="${vidrio}" opacity=".88"/>` +
    `<rect x="${x + ancho / 2 - 0.3}" y="${y}" width=".6" height="${alto}" fill="${t.osc}"/>`;
}

function letrero(x: number, y: number, ancho: number): string {
  return `<rect x="${x}" y="${y}" width="${ancho}" height="2.4" rx=".8" fill="${VIDRIO_OSC}"/>` +
    `<rect x="${x + 1.5}" y="${y + 0.75}" width="${ancho - 5}" height=".9" rx=".45" fill="${FARO}"/>`;
}

const LADO: Record<ModeloBus, (t: Tinta) => string> = {
  urbano: t =>
    sombraLado(40, 160) +
    `<rect x="78" y="12.6" width="34" height="4.4" rx="1.4" fill="${t.osc}"/>` +
    `<rect x="40" y="16" width="120" height="30" rx="4" fill="${t.c}" stroke="${t.borde}" stroke-width=".6"/>` +
    faldon(40, 160, 40, t) +
    `<rect x="46" y="20" width="48" height="11" rx="1.6" fill="${VIDRIO}"/>` +
    `<rect x="106" y="20" width="34" height="11" rx="1.6" fill="${VIDRIO}"/>` +
    `<rect x="61.5" y="20" width="1.4" height="11" fill="${t.c}"/><rect x="77.5" y="20" width="1.4" height="11" fill="${t.c}"/>` +
    `<rect x="122.5" y="20" width="1.4" height="11" fill="${t.c}"/>` +
    puerta(96.5, 20, 24, t) + puerta(142.5, 20, 24, t) +
    `<path d="M152 19H156.5Q159 19 159 21.5V36H152Z" fill="${VIDRIO}"/>` +
    letrero(143, 16.9, 13.5) +
    `<rect x="157.6" y="38.6" width="2.4" height="2.6" rx=".6" fill="${FARO}"/>` +
    `<rect x="40" y="36.5" width="2" height="3.6" rx=".6" fill="${STOP}"/>` +
    rueda(70, t) + rueda(134, t),

  buseta: t =>
    sombraLado(60, 140) +
    `<path d="M60 22Q60 19 63 19H127Q139.5 19.5 140 31V42.5Q140 46 136.5 46H63.5Q60 46 60 42.5Z" fill="${t.c}" stroke="${t.borde}" stroke-width=".6"/>` +
    faldon(60, 140, 40.5, t) +
    [65, 76, 87, 98].map(x => `<rect x="${x}" y="23" width="9.4" height="8.6" rx="1.6" fill="${VIDRIO}"/>`).join('') +
    puerta(109.5, 23, 20.5, t) +
    `<path d="M120 23H128.5Q134.6 23.4 136.8 32H120Z" fill="${VIDRIO}"/>` +
    `<rect x="137.4" y="37.5" width="2.6" height="2.4" rx=".6" fill="${FARO}"/>` +
    `<rect x="60" y="35.5" width="2" height="3.4" rx=".6" fill="${STOP}"/>` +
    rueda(73, t, 5) + rueda(126, t, 5),

  interurbano: t =>
    sombraLado(35, 165) +
    `<rect x="35" y="10" width="130" height="36" rx="3.5" fill="${t.c}" stroke="${t.borde}" stroke-width=".6"/>` +
    `<rect x="40" y="14" width="108" height="14" rx="1.8" fill="${VIDRIO_OSC}"/>` +
    `<path d="M60 14L54 28M100 14L94 28" stroke="#fff" stroke-opacity=".1" stroke-width="3"/>` +
    puerta(150, 14, 29.5, t, VIDRIO_OSC, 7) +
    `<path d="M159 13H162.5Q164.6 13 164.6 15.5V33H159Z" fill="${VIDRIO_OSC}"/>` +
    `<rect x="35.3" y="30.5" width="129.4" height="1.4" fill="${t.claro}"/>` +
    [78, 96.5, 115].map(x => `<rect x="${x}" y="33.5" width="17" height="9.5" rx=".8" fill="none" stroke="${t.osc}" stroke-width=".8"/>`).join('') +
    `<rect x="162.2" y="38.5" width="2.6" height="3" rx=".6" fill="${FARO}"/>` +
    `<rect x="35" y="35" width="2" height="4.5" rx=".6" fill="${STOP}"/>` +
    rueda(52, t, 5.8) + rueda(65, t, 5.8) + rueda(141, t, 5.8),

  articulado: t =>
    sombraLado(10, 190) +
    `<rect x="34" y="12.6" width="26" height="4.4" rx="1.4" fill="${t.osc}"/>` +
    `<rect x="128" y="12.6" width="26" height="4.4" rx="1.4" fill="${t.osc}"/>` +
    `<rect x="10" y="16" width="85" height="30" rx="4" fill="${t.c}" stroke="${t.borde}" stroke-width=".6"/>` +
    `<rect x="102" y="16" width="88" height="30" rx="4" fill="${t.c}" stroke="${t.borde}" stroke-width=".6"/>` +
    faldon(10, 95, 40, t) + faldon(102, 190, 40, t) +
    `<rect x="94" y="18.5" width="9" height="26" rx="1.5" fill="${FUELLE}"/>` +
    [96, 98.5, 101].map(x => `<rect x="${x - 0.4}" y="18.5" width=".8" height="26" fill="${FUELLE_PLIEGUE}"/>`).join('') +
    `<rect x="15" y="20" width="30" height="11" rx="1.6" fill="${VIDRIO}"/>` +
    `<rect x="57" y="20" width="33" height="11" rx="1.6" fill="${VIDRIO}"/>` +
    `<rect x="106" y="20" width="28" height="11" rx="1.6" fill="${VIDRIO}"/>` +
    `<rect x="146" y="20" width="23" height="11" rx="1.6" fill="${VIDRIO}"/>` +
    `<rect x="29.5" y="20" width="1.4" height="11" fill="${t.c}"/><rect x="72.5" y="20" width="1.4" height="11" fill="${t.c}"/>` +
    `<rect x="119.5" y="20" width="1.4" height="11" fill="${t.c}"/>` +
    puerta(47, 20, 24, t) + puerta(136, 20, 24, t) + puerta(171, 20, 24, t) +
    `<path d="M181 19H185.5Q188.7 19 188.7 21.5V36H181Z" fill="${VIDRIO}"/>` +
    letrero(172, 16.9, 13) +
    `<rect x="187.6" y="38.6" width="2.4" height="2.6" rx=".6" fill="${FARO}"/>` +
    `<rect x="10" y="36.5" width="2" height="3.6" rx=".6" fill="${STOP}"/>` +
    rueda(24, t) + rueda(78, t) + rueda(118, t) + rueda(163, t),

  microbus: t =>
    sombraLado(70, 130) +
    `<path d="M70 25.5Q70 22 73.5 22H112Q114.6 22 116.2 24.4L121.6 33Q122.4 34.2 124 34.6L127.6 35.5Q130 36.1 130 38.6V43Q130 46 127 46H73Q70 46 70 43Z" fill="${t.c}" stroke="${t.borde}" stroke-width=".6"/>` +
    faldon(70, 130, 41.5, t, 2.7) +
    `<rect x="74.5" y="25.5" width="10.5" height="7" rx="1.4" fill="${VIDRIO}"/>` +
    `<rect x="86.5" y="25.5" width="10.5" height="7" rx="1.4" fill="${VIDRIO}"/>` +
    `<rect x="99" y="25.5" width="10" height="7" rx="1.4" fill="${VIDRIO}"/>` +
    `<rect x="98.4" y="25" width="11.2" height="16" rx="1" fill="none" stroke="${t.osc}" stroke-width=".6"/>` +
    `<path d="M112.6 25.6H115L120.5 33.6H112.6Z" fill="${VIDRIO}"/>` +
    `<rect x="127.4" y="37.3" width="2.6" height="2.2" rx=".6" fill="${FARO}"/>` +
    `<rect x="70" y="33" width="1.8" height="4" rx=".6" fill="${STOP}"/>` +
    rueda(80, t, 4.6) + rueda(119, t, 4.6),

  electrico: t =>
    sombraLado(40, 160) +
    `<rect x="60" y="11.6" width="76" height="5" rx="2" fill="${t.osc}"/>` +
    [63, 88, 113].map(x => `<rect x="${x}" y="12.6" width="21" height="1.2" rx=".6" fill="${t.claro}" opacity=".55"/>`).join('') +
    `<rect x="40" y="16" width="120" height="30" rx="7" fill="${t.c}" stroke="${t.borde}" stroke-width=".6"/>` +
    `<rect x="46" y="41" width="108" height="1.2" rx=".6" fill="${MENTA}"/>` +
    `<rect x="46" y="20" width="50" height="12" rx="3" fill="${VIDRIO}"/>` +
    `<rect x="108" y="20" width="26" height="12" rx="3" fill="${VIDRIO}"/>` +
    puerta(98.5, 20, 23.5, t) + puerta(136.5, 20, 23.5, t) +
    `<path d="M146.5 19H152Q159 19 159 27V37H146.5Z" fill="${VIDRIO}"/>` +
    `<circle cx="112" cy="37" r="3.6" fill="${VIDRIO_OSC}"/>` +
    `<path d="M112.6 34.1L110.2 37.5H112L111.2 40.1L113.9 36.4H112.1Z" fill="${MENTA}"/>` +
    `<rect x="156.8" y="38.2" width="3" height="2.2" rx="1" fill="${FARO}"/>` +
    `<rect x="40.4" y="36" width="1.8" height="4" rx=".6" fill="${STOP}"/>` +
    rueda(70, t, 5.5, METAL, 0.55) + rueda(128, t, 5.5, METAL, 0.55),

  dos_pisos: t =>
    sombraLado(40, 160) +
    `<rect x="40" y="4" width="120" height="42" rx="5" fill="${t.c}" stroke="${t.borde}" stroke-width=".6"/>` +
    faldon(40, 160, 40, t) +
    `<rect x="46" y="8" width="104" height="11" rx="1.8" fill="${VIDRIO}"/>` +
    [66, 86, 106, 126].map(x => `<rect x="${x}" y="8" width="1.4" height="11" fill="${t.c}"/>`).join('') +
    `<path d="M152 8H155.5Q158.6 8 158.6 11V19H152Z" fill="${VIDRIO}"/>` +
    `<rect x="46" y="23" width="48" height="10" rx="1.6" fill="${VIDRIO}"/>` +
    `<rect x="106" y="23" width="32" height="10" rx="1.6" fill="${VIDRIO}"/>` +
    `<rect x="70" y="23" width="1.4" height="10" fill="${t.c}"/>` +
    puerta(96.5, 23, 21, t) + puerta(140.5, 23, 21, t) +
    `<path d="M150.5 23H158.6V36H150.5Z" fill="${VIDRIO}"/>` +
    letrero(141, 19.9, 16) +
    `<rect x="157.6" y="38.6" width="2.4" height="2.6" rx=".6" fill="${FARO}"/>` +
    `<rect x="40" y="35.5" width="2" height="4" rx=".6" fill="${STOP}"/>` +
    rueda(70, t) + rueda(134, t),

  trompa: t =>
    sombraLado(40, 158) +
    `<path d="M140 30H152Q157.6 30.4 158 36V43Q158 46 155 46H140Z" fill="${t.c}" stroke="${t.borde}" stroke-width=".6"/>` +
    `<rect x="40" y="18" width="103" height="28" rx="3" fill="${t.c}" stroke="${t.borde}" stroke-width=".6"/>` +
    `<rect x="40.3" y="35" width="117.4" height="1.1" fill="${t.osc}"/>` +
    `<rect x="40.3" y="39.5" width="117.4" height="1.1" fill="${t.osc}"/>` +
    [46, 57, 68, 79, 90, 101, 112].map(x => `<rect x="${x}" y="21.5" width="9" height="9.5" rx="1.4" fill="${VIDRIO}"/>`).join('') +
    puerta(124, 21.5, 22.5, t, VIDRIO, 7) +
    `<path d="M133.5 21H140.5Q142.4 21 142.4 23V32H133.5Z" fill="${VIDRIO}"/>` +
    `<rect x="156.6" y="33" width="1.4" height="9" rx=".5" fill="${t.osc}"/>` +
    `<rect x="155.6" y="31.6" width="2.4" height="2.2" rx=".6" fill="${FARO}"/>` +
    `<rect x="40" y="30" width="2" height="4" rx=".6" fill="${STOP}"/>` +
    rueda(64, t) + rueda(149, t),

  panoramico: t =>
    sombraLado(37, 162) +
    `<path d="M37 24Q37 14 47 14H152Q162 14 162 24V43Q162 46 159 46H40Q37 46 37 43Z" fill="${t.c}" stroke="${t.borde}" stroke-width=".6"/>` +
    `<path d="M44 33V22Q44 17.5 49 17.5H146Q150 17.5 150 22V33Z" fill="${VIDRIO}"/>` +
    `<rect x="78" y="17.5" width="1.2" height="15.5" fill="${t.c}" opacity=".6"/>` +
    `<rect x="114" y="17.5" width="1.2" height="15.5" fill="${t.c}" opacity=".6"/>` +
    `<path d="M152 18.5Q160 19 160.4 27V36H152Z" fill="${VIDRIO}"/>` +
    `<rect x="70" y="36.5" width="20" height="6" rx="1" fill="${VIDRIO_OSC}"/>` +
    `<rect x="92" y="36.5" width="20" height="6" rx="1" fill="${VIDRIO_OSC}"/>` +
    `<rect x="159.2" y="38.4" width="2.6" height="2.6" rx=".6" fill="${FARO}"/>` +
    `<rect x="37" y="34.5" width="2" height="4.5" rx=".6" fill="${STOP}"/>` +
    rueda(60, t, 5.6) + rueda(138, t, 5.6),

  piso_bajo: t =>
    sombraLado(40, 160) +
    `<rect x="76" y="12.6" width="30" height="4.4" rx="1.4" fill="${t.osc}"/>` +
    `<rect x="40" y="16" width="120" height="30" rx="4" fill="${t.c}" stroke="${t.borde}" stroke-width=".6"/>` +
    faldon(40, 160, 41.5, t) +
    `<rect x="46" y="20" width="42" height="13" rx="1.8" fill="${VIDRIO}"/>` +
    `<rect x="112" y="20" width="26" height="13" rx="1.8" fill="${VIDRIO}"/>` +
    // Insignia de accesibilidad junto a la puerta del medio.
    `<rect x="90" y="21" width="9" height="9" rx="1.4" fill="${ACCESIBLE}"/>` +
    `<circle cx="94.6" cy="22.8" r=".9" fill="#fff"/>` +
    `<circle cx="94" cy="27.3" r="2.1" fill="none" stroke="#fff" stroke-width=".9"/>` +
    `<path d="M94.6 24V26.2H97.2L98 28.6" fill="none" stroke="#fff" stroke-width=".9" stroke-linecap="round" stroke-linejoin="round"/>` +
    puerta(101, 20, 25.6, t, VIDRIO, 9) +
    // La rampa desplegada, de la puerta a la acera.
    `<path d="M101 45.6H110L113 51.6H98Z" fill="${METAL}"/>` +
    puerta(141, 20, 25.6, t) +
    `<path d="M151.5 19H156.5Q159 19 159 21.5V37H151.5Z" fill="${VIDRIO}"/>` +
    `<rect x="157.6" y="38.6" width="2.4" height="2.6" rx=".6" fill="${FARO}"/>` +
    `<rect x="40" y="36.5" width="2" height="3.6" rx=".6" fill="${STOP}"/>` +
    rueda(66, t, 5) + rueda(134, t, 5),

  shuttle: t =>
    sombraLado(55, 145) +
    `<rect x="62" y="11.4" width="72" height="1.2" rx=".6" fill="${METAL}"/>` +
    [64, 76, 88, 100, 112, 124, 132].map(x => `<rect x="${x}" y="11.4" width="1" height="4.8" fill="${METAL}"/>`).join('') +
    `<rect x="55" y="16" width="90" height="30" rx="5" fill="${t.c}" stroke="${t.borde}" stroke-width=".6"/>` +
    faldon(55, 145, 41, t) +
    `<rect x="60" y="20" width="28" height="11" rx="1.8" fill="${VIDRIO}"/>` +
    `<rect x="112" y="20" width="20" height="11" rx="1.8" fill="${VIDRIO}"/>` +
    puerta(91, 20, 24, t, VIDRIO, 8.6) + puerta(100.4, 20, 24, t, VIDRIO, 8.6) +
    `<path d="M135 19H140Q143.6 19 143.6 22.5V36H135Z" fill="${VIDRIO}"/>` +
    `<rect x="142.4" y="38.6" width="2.6" height="2.4" rx=".6" fill="${FARO}"/>` +
    `<rect x="55" y="35.5" width="2" height="3.6" rx=".6" fill="${STOP}"/>` +
    rueda(70, t, 5) + rueda(128, t, 5),

  descapotable: t =>
    sombraLado(45, 155) +
    // Asientos que asoman sobre la pared del piso de arriba, y la baranda.
    [56, 70, 84, 98, 112, 126].map(x => `<rect x="${x}" y="12.6" width="8" height="3.6" rx="1" fill="${ASIENTO}"/>`).join('') +
    `<rect x="50" y="6.4" width="100" height="1.2" rx=".6" fill="${METAL}"/>` +
    [50, 63, 76, 89, 102, 115, 128, 141, 149].map(x => `<rect x="${x}" y="6.4" width="1" height="10" fill="${METAL}"/>`).join('') +
    `<path d="M45 16H155V43Q155 46 152 46H48Q45 46 45 43Z" fill="${t.c}" stroke="${t.borde}" stroke-width=".6"/>` +
    `<rect x="45.3" y="22" width="109.4" height="1" fill="${t.osc}"/>` +
    faldon(45, 155, 41, t) +
    `<rect x="50" y="25.5" width="71" height="9" rx="1.6" fill="${VIDRIO}"/>` +
    [68, 86, 104].map(x => `<rect x="${x}" y="25.5" width="1.4" height="9" fill="${t.c}"/>`).join('') +
    puerta(124, 25.5, 18.5, t) +
    `<path d="M141 25H153Q154.7 25 154.7 27V37H141Z" fill="${VIDRIO}"/>` +
    `<rect x="152.4" y="38.6" width="2.6" height="2.4" rx=".6" fill="${FARO}"/>` +
    `<rect x="45" y="35.5" width="2" height="3.6" rx=".6" fill="${STOP}"/>` +
    rueda(66, t) + rueda(141, t),
};

// ============================================================================
// DESDE ARRIBA: dibujado en 34 × 200 (se muestra de y = 8 a 192), el frente
// arriba.
// ============================================================================
function sombraArriba(x: number, y: number, w: number, h: number, r: number): string {
  return `<rect x="${x + 1.2}" y="${y + 1.6}" width="${w}" height="${h}" rx="${r}" fill="#000" opacity=".3"/>`;
}

function espejos(y: number, x0: number, x1: number, t: Tinta): string {
  return `<rect x="${x0 - 2}" y="${y}" width="2" height="4" rx=".8" fill="${t.osc}"/>` +
    `<rect x="${x1}" y="${y}" width="2" height="4" rx=".8" fill="${t.osc}"/>`;
}

function aire(y: number, alto: number, t: Tinta): string {
  return `<rect x="8" y="${y}" width="18" height="${alto}" rx="2" fill="${t.osc}"/>` +
    [0.25, 0.5, 0.75].map(f => `<rect x="10" y="${(y + alto * f - 0.6).toFixed(1)}" width="14" height="1.2" rx=".6" fill="${t.c}" opacity=".45"/>`).join('');
}

function escotilla(y: number, t: Tinta): string {
  return `<rect x="12" y="${y}" width="10" height="7" rx="1.2" fill="${t.osc}"/>`;
}

const ARRIBA: Record<ModeloBus, (t: Tinta) => string> = {
  urbano: t =>
    sombraArriba(2, 40, 30, 120, 4) + espejos(45, 2, 32, t) +
    `<rect x="2" y="40" width="30" height="120" rx="4" fill="${t.c}" stroke="${t.borde}" stroke-width=".6"/>` +
    `<rect x="4" y="41.6" width="26" height="6.5" rx="2.2" fill="${VIDRIO}"/>` +
    escotilla(62, t) + aire(84, 30, t) + escotilla(132, t) +
    `<rect x="6" y="154.5" width="22" height="3.8" rx="1.2" fill="${VIDRIO_OSC}"/>`,

  buseta: t =>
    sombraArriba(3, 60, 28, 80, 8) + espejos(67, 3, 31, t) +
    `<path d="M3 70Q3 60 17 60Q31 60 31 70V136Q31 140 27 140H7Q3 140 3 136Z" fill="${t.c}" stroke="${t.borde}" stroke-width=".6"/>` +
    `<path d="M6 69Q6 63.5 17 63.5Q28 63.5 28 69V71H6Z" fill="${VIDRIO}"/>` +
    escotilla(92, t) +
    `<rect x="7" y="135.5" width="20" height="3" rx="1" fill="${VIDRIO_OSC}"/>`,

  interurbano: t =>
    sombraArriba(2, 35, 30, 130, 3.5) + espejos(38, 2, 32, t) +
    `<rect x="2" y="35" width="30" height="130" rx="3.5" fill="${t.c}" stroke="${t.borde}" stroke-width=".6"/>` +
    `<rect x="4" y="36.6" width="26" height="7" rx="2" fill="${VIDRIO_OSC}"/>` +
    `<rect x="5" y="47" width="24" height="88" rx="2" fill="${t.claro}" opacity=".22"/>` +
    escotilla(60, t) + escotilla(98, t) + aire(140, 18, t),

  articulado: t =>
    sombraArriba(2, 10, 30, 180, 4) + espejos(15, 2, 32, t) +
    `<rect x="2" y="10" width="30" height="88.5" rx="4" fill="${t.c}" stroke="${t.borde}" stroke-width=".6"/>` +
    `<rect x="2" y="104.5" width="30" height="85.5" rx="4" fill="${t.c}" stroke="${t.borde}" stroke-width=".6"/>` +
    `<rect x="4" y="96" width="26" height="11" rx="1.5" fill="${FUELLE}"/>` +
    [98.5, 101, 103.5].map(y => `<rect x="4" y="${y - 0.4}" width="26" height=".8" fill="${FUELLE_PLIEGUE}"/>`).join('') +
    `<rect x="4" y="11.6" width="26" height="6.5" rx="2.2" fill="${VIDRIO}"/>` +
    escotilla(28, t) + aire(45, 26, t) + escotilla(115, t) + aire(135, 26, t) +
    `<rect x="6" y="184.5" width="22" height="3.6" rx="1.2" fill="${VIDRIO_OSC}"/>`,

  microbus: t =>
    sombraArriba(5, 70, 24, 60, 5) + espejos(81, 5, 29, t) +
    `<rect x="5" y="70" width="24" height="60" rx="5" fill="${t.c}" stroke="${t.borde}" stroke-width=".6"/>` +
    `<rect x="5.3" y="70.3" width="23.4" height="10" rx="4.6" fill="${t.claro}" opacity=".35"/>` +
    `<path d="M7 81Q17 78.6 27 81V86.5H7Z" fill="${VIDRIO}"/>` +
    `<rect x="8" y="89" width="18" height="36" rx="2" fill="${t.claro}" opacity=".2"/>` +
    `<rect x="8" y="126" width="18" height="2.6" rx="1" fill="${VIDRIO_OSC}"/>`,

  electrico: t =>
    sombraArriba(2, 40, 30, 120, 8) + espejos(47, 2, 32, t) +
    `<rect x="2" y="40" width="30" height="120" rx="8" fill="${t.c}" stroke="${t.borde}" stroke-width=".6"/>` +
    `<path d="M4.5 50Q4.5 42.2 17 42.2Q29.5 42.2 29.5 50V52H4.5Z" fill="${VIDRIO}"/>` +
    [62, 86, 110].map(y => `<rect x="8" y="${y}" width="18" height="20" rx="2" fill="${t.osc}"/>`).join('') +
    `<path d="M18 89.5L13.8 97H17L15.8 103L20.4 94.8H17.2Z" fill="${MENTA}"/>` +
    `<rect x="6" y="153.5" width="22" height="3.8" rx="1.8" fill="${VIDRIO_OSC}"/>`,

  dos_pisos: t =>
    sombraArriba(2, 40, 30, 120, 5) + espejos(46, 2, 32, t) +
    `<rect x="2" y="40" width="30" height="120" rx="5" fill="${t.c}" stroke="${t.borde}" stroke-width=".6"/>` +
    `<rect x="4" y="41.6" width="26" height="5.5" rx="2" fill="${VIDRIO}"/>` +
    // La ventana de techo del piso de arriba.
    `<rect x="6" y="72" width="22" height="32" rx="2.5" fill="${VIDRIO}"/>` +
    escotilla(56, t) + escotilla(128, t) +
    `<rect x="6" y="154.5" width="22" height="3.8" rx="1.2" fill="${VIDRIO_OSC}"/>`,

  trompa: t =>
    sombraArriba(2, 38, 30, 122, 4) + espejos(60, 2, 32, t) +
    `<rect x="7" y="38" width="20" height="22" rx="4" fill="${t.c}" stroke="${t.borde}" stroke-width=".6"/>` +
    `<rect x="10" y="38.6" width="14" height="2" rx="1" fill="${t.osc}"/>` +
    `<rect x="2" y="56" width="30" height="104" rx="3" fill="${t.c}" stroke="${t.borde}" stroke-width=".6"/>` +
    `<rect x="4" y="57.6" width="26" height="5" rx="1.6" fill="${VIDRIO}"/>` +
    [84, 108, 132].map(y => `<rect x="9" y="${y}" width="16" height="1.4" rx=".7" fill="${t.osc}"/>`).join('') +
    `<rect x="6" y="154.5" width="22" height="3.8" rx="1.2" fill="${VIDRIO_OSC}"/>`,

  panoramico: t =>
    sombraArriba(2, 37.5, 30, 125, 6) + espejos(44, 2, 32, t) +
    `<rect x="2" y="37.5" width="30" height="125" rx="6" fill="${t.c}" stroke="${t.borde}" stroke-width=".6"/>` +
    `<path d="M5 47Q5 40 17 40Q29 40 29 47Z" fill="${VIDRIO}"/>` +
    `<rect x="5" y="49" width="24" height="103" rx="3.5" fill="${VIDRIO}"/>` +
    [74, 100, 126].map(y => `<rect x="5" y="${y}" width="24" height="1" fill="${t.c}" opacity=".5"/>`).join('') +
    `<rect x="7" y="155.5" width="20" height="3.6" rx="1.2" fill="${VIDRIO_OSC}"/>`,

  piso_bajo: t =>
    sombraArriba(2, 40, 30, 120, 4) + espejos(45, 2, 32, t) +
    // La rampa desplegada asoma por el costado de la puerta del medio.
    `<rect x="31.6" y="98" width="2.4" height="11" rx=".6" fill="${METAL}"/>` +
    `<rect x="2" y="40" width="30" height="120" rx="4" fill="${t.c}" stroke="${t.borde}" stroke-width=".6"/>` +
    `<rect x="4" y="41.6" width="26" height="6.5" rx="2.2" fill="${VIDRIO}"/>` +
    escotilla(62, t) + aire(118, 26, t) +
    `<rect x="12" y="88" width="10" height="10" rx="1.6" fill="${ACCESIBLE}"/>` +
    `<circle cx="17" cy="95" r="2.4" fill="none" stroke="#fff" stroke-width=".9"/>` +
    `<circle cx="17.6" cy="89.9" r=".9" fill="#fff"/>` +
    `<rect x="6" y="154.5" width="22" height="3.8" rx="1.2" fill="${VIDRIO_OSC}"/>`,

  shuttle: t =>
    sombraArriba(3, 55, 28, 90, 5) + espejos(60, 3, 31, t) +
    `<rect x="3" y="55" width="28" height="90" rx="5" fill="${t.c}" stroke="${t.borde}" stroke-width=".6"/>` +
    `<rect x="5" y="56.6" width="24" height="6" rx="2" fill="${VIDRIO}"/>` +
    // Parrilla con maletas.
    `<rect x="7" y="70" width="20" height="50" rx="1.5" fill="none" stroke="${METAL}" stroke-width="1.1"/>` +
    [82.5, 95, 107.5].map(y => `<rect x="7" y="${y}" width="20" height=".8" fill="${METAL}"/>`).join('') +
    `<rect x="9" y="72.5" width="7" height="8" rx="1" fill="${VIDRIO}"/>` +
    `<rect x="18" y="74" width="7.5" height="6.5" rx="1" fill="${VIDRIO}"/>` +
    `<rect x="10" y="97" width="6.5" height="9" rx="1" fill="${VIDRIO}"/>` +
    `<rect x="18" y="96.5" width="7" height="8.5" rx="1" fill="${VIDRIO}"/>` +
    `<rect x="7" y="140" width="20" height="2.8" rx="1" fill="${VIDRIO_OSC}"/>`,

  descapotable: t =>
    sombraArriba(2, 45, 30, 110, 3) + espejos(49, 2, 32, t) +
    `<rect x="2" y="45" width="30" height="110" rx="3" fill="${t.c}" stroke="${t.borde}" stroke-width=".6"/>` +
    `<rect x="4" y="46.5" width="26" height="4" rx="1.5" fill="${VIDRIO}"/>` +
    // El piso de arriba sin techo: se ven las filas de asientos.
    `<rect x="4.5" y="52" width="25" height="92" rx="1.5" fill="${VIDRIO_OSC}"/>` +
    [56, 67, 78, 89, 100, 111, 122, 133].map(y =>
      `<rect x="7" y="${y}" width="8" height="6" rx="1" fill="${ASIENTO}"/><rect x="19" y="${y}" width="8" height="6" rx="1" fill="${ASIENTO}"/>`).join('') +
    `<rect x="7" y="146" width="20" height="6" rx="1" fill="${t.osc}"/>`,
};

// 'planta' es la vista de arriba acostada, con el frente a la derecha: queda
// alineada punto por punto con la de costado (el mismo largo en x), como en
// una ficha técnica.
export type VistaBus = 'arriba' | 'lado' | 'planta';

/** SVG del bus listo para insertar. El color se sanea adentro. */
export function svgBus(modelo: ModeloBus, vista: VistaBus, color: string | null | undefined): string {
  const t = tinta(color);
  const m = esModeloBus(modelo) ? modelo : MODELO_BUS_DEFECTO;
  if (vista === 'lado') return svg('0 0 200 56', LADO[m](t));
  // (x, y) → (200 − y, x): lo que en "arriba" estaba en y = 10 (el frente)
  // pasa a x = 190, a la derecha, igual que en la vista de costado.
  if (vista === 'planta') return svg('0 0 200 36', `<g transform="translate(200 0) rotate(90)">${ARRIBA[m](t)}</g>`);
  // Arriba se recorta el margen que ningún modelo usa (el articulado, el más
  // largo, va de y = 10 a y = 190 más su sombra).
  return svg('0 8 34 184', ARRIBA[m](t));
}
