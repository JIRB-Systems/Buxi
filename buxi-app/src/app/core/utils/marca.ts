// Cómo se escriben y se pintan las piezas del transporte en la interfaz: el
// nombre corto de una ruta para su insignia y el color de texto que se lee
// sobre el color de cada línea.
//
// Funciones puras para poder probarlas solas, y para usarlas igual en las
// plantillas de Angular y en el HTML que se arma a mano para los marcadores
// del mapa.

import { colorSeguro, esc } from './html';

// "San José – Cartago", "San José - Cartago" o "San José—Cartago".
const SEPARADOR = /\s*[–—-]\s+|\s+[–—-]\s*/;

/**
 * Nombre corto de una ruta para su insignia: "San José – Cartago" pasa a
 * "SJ · Cartago". Con más de dos tramos se queda con el primero y el último
 * (de dónde sale y a dónde llega), y lo que va entre paréntesis se va: es
 * aclaración, no nombre. `invertir` da la vuelta, para un bus que va de
 * regreso.
 */
export function rutaCorta(nombre: string | null | undefined, invertir = false): string {
  const limpio = (nombre ?? '').replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  if (!limpio) return '';
  const partes = limpio.split(SEPARADOR).map(abreviar).filter(Boolean);
  if (partes.length < 2) return partes[0] ?? limpio;
  const extremos = [partes[0], partes[partes.length - 1]];
  if (invertir) extremos.reverse();
  return extremos.join(' · ');
}

function abreviar(parte: string): string {
  // San José es por lejos el extremo más común y el más largo de leer.
  // Sin \b: para JavaScript la "é" no es letra y \b nunca coincide después.
  return parte.trim().replace(/^San José(?=\s|$)/i, 'SJ');
}

/** Luminancia relativa (WCAG) de un color hex ya validado. */
function luminancia(hex: string): number {
  const h = hex.length === 4 ? hex.slice(1).split('').map(c => c + c).join('') : hex.slice(1);
  const canal = (i: number) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(0) + 0.7152 * canal(2) + 0.0722 * canal(4);
}

export function contraste(a: string, b: string): number {
  const [l1, l2] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

const TINTA_OSCURA = '#04101f';
const TINTA_CLARA = '#ffffff';

/**
 * Color del texto sobre el color de una ruta: el que más contraste da entre
 * la tinta oscura de la marca y el blanco. Las empresas eligen colores de
 * todo tipo; con texto fijo, un amarillo con blanco o un azul marino con
 * negro quedaban ilegibles.
 */
export function tintaSobre(color: string | null | undefined): string {
  const fondo = colorSeguro(color, '#8292aa');
  return contraste(fondo, TINTA_OSCURA) >= contraste(fondo, TINTA_CLARA) ? TINTA_OSCURA : TINTA_CLARA;
}

/**
 * La misma insignia, en HTML, para lo que se arma fuera de Angular
 * (marcadores y popups del mapa). Todo dato pasa por esc() y el color por
 * colorSeguro(): el nombre y el color los escribe una empresa.
 */
export function insigniaRutaHtml(nombre: string, color: string | null | undefined, invertir = false): string {
  const fondo = colorSeguro(color, '#8292aa');
  return `<span class="bx-ruta" style="--ruta:${fondo};--ruta-tinta:${tintaSobre(fondo)}" title="${esc(nombre)}">${esc(rutaCorta(nombre, invertir))}</span>`;
}
