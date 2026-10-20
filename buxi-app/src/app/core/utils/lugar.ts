// Nombres de lugar legibles.
//
// El buscador de direcciones devuelve la dirección entera, con calle, barrio,
// cantón, provincia, código postal y país:
//
//   "Terminal de Buses de Liberia, Calle 12, Los Ángeles, Liberia,
//    Guanacaste, 50101, Costa Rica"
//
// Guardado así, el nombre de la parada no entra en ninguna lista y además
// cuatro rutas distintas empiezan igual, que es justo lo que las diferencia.
// Acá se queda con la parte que de verdad nombra el lugar.

// Lo que nunca aporta al final de una dirección tica.
const COLA = /^(costa rica|provincia de .+|\d{4,6})$/i;

// Las palabras que describen QUÉ es el lugar, no CUÁL es. Si al quitarlas no
// queda nada ("Terminal de Buses Municipal"), el tramo no nombra un lugar
// concreto y hay que decir de dónde es; si queda algo ("Terminal de Buses de
// Liberia" → "Liberia"), ya se sabe cuál es.
const DESCRIPTIVAS = /\b(terminal(es)?|estaci[oó]n|parada[s]?|bus stop|autobuses|buses|municipal|central|de|del|la|el|los|las)\b/gi;

// Tramos que son vías, no lugares: no sirven para completar un nombre.
const VIA = /^(calle|avenida|av\.?|ruta|carretera|autopista|camino|v[ií]a|diagonal)\b/i;

/**
 * El nombre corto de un lugar a partir de lo que devuelve el buscador.
 * Si ya viene corto, lo deja igual.
 */
export function nombreCortoLugar(etiqueta: string | null | undefined, maxLargo = 42): string {
  const texto = (etiqueta || '').trim();
  if (!texto) return '';

  const partes = texto
    .split(',')
    .map(p => p.trim())
    .filter(p => p.length > 0 && !COLA.test(p));

  if (partes.length === 0) return recortar(texto, maxLargo);

  let nombre = partes[0];

  // Un portal ("12") o una letra suelta no nombran nada: se pega al siguiente.
  if (/^\d+$/.test(nombre) || nombre.length <= 2) {
    nombre = [nombre, partes[1]].filter(Boolean).join(' ');
  } else if (necesitaContexto(nombre)) {
    // "Parada de buses" o "Terminal de Buses Municipal": se les agrega el
    // primer tramo que sea un lugar y no una calle.
    const lugar = partes.slice(1).find(p => !VIA.test(p) && !/^\d+$/.test(p));
    if (lugar) nombre = `${nombre}, ${lugar}`;
  }

  return recortar(nombre, maxLargo);
}

// Sin nombre propio detrás de las palabras descriptivas, el tramo podría ser
// la terminal de cualquier pueblo.
function necesitaContexto(tramo: string): boolean {
  // lastIndex se reinicia a mano: DESCRIPTIVAS es global y se comparte.
  DESCRIPTIVAS.lastIndex = 0;
  return tramo.replace(DESCRIPTIVAS, ' ').replace(/[^\p{L}\p{N}]+/gu, '').length === 0;
}

// Corta por palabra, no a la mitad de una, y solo si hace falta.
function recortar(texto: string, maxLargo: number): string {
  if (texto.length <= maxLargo) return texto;
  const corte = texto.slice(0, maxLargo);
  const espacio = corte.lastIndexOf(' ');
  return (espacio > maxLargo * 0.6 ? corte.slice(0, espacio) : corte).trimEnd() + '…';
}
