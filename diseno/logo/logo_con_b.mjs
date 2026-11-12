// Logo de Buxci con la B de la marca como B del nombre (noviembre de 2026).
//
// Antes iban la marca (la B azul y verde) y al lado el nombre completo, y se
// leía "B Buxci", con dos B. Ahora la marca ES la B, y el resto sigue su
// diseño:
//   · "uxci" va inclinada como la B (12°: el asta de la B avanza 25,51 en 120
//     de alto) y apoyada en la misma base;
//   · la x va en verde;
//   · el punto de la i va en verde, rodeado de dos anillos de señal que en la
//     app laten (lo que está en vivo transmite). Los anillos se cortan donde
//     pasa el palito de la i, con un margen, para no encimarse con él.
//
// Sale de las piezas que ya existen, así que si cambia la marca o el nombre
// se vuelve a correr y listo:
//   node diseno/logo/logo_con_b.mjs
// Escribe buxi-app/src/assets/brand/buxci-logo.svg (letras blancas, para fondo
// oscuro) y buxci-logo-marino.svg (letras azul marino, para fondo claro), y
// muestra las medidas que usa la pantalla de bienvenida, que dibuja el logo en
// línea para animar cada pieza (splash.page.html).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const AQUI = dirname(fileURLToPath(import.meta.url));
const MARCA = join(AQUI, '../../buxi-app/src/assets/brand');

const marca = readFileSync(join(MARCA, 'buxci-mark.svg'), 'utf8').match(/<g>([\s\S]*)<\/g>/)[1];
const nombre = readFileSync(join(MARCA, 'buxci-nombre.svg'), 'utf8');
const trazo = nombre.match(/ d="([^"]+)"/)[1];
// "uxci": todo el trazo del nombre desde la u (la B del nombre se descarta).
const uxci = trazo.slice(trazo.indexOf('M93.94'));
// La x va en verde, como la panza de la B y la señal de la i: el verde
// recorre la palabra de punta a punta.
const iX = uxci.indexOf('M130.78'), iC = uxci.indexOf('M219.34');
if (iX < 0 || iC < 0) throw new Error('No encontré la x en el nombre');
const X = uxci.slice(iX, iC);
const SIN_X = uxci.slice(0, iX) + uxci.slice(iC);

const VERDE = '#00c853';
const BASE = 78;                              // línea de base del nombre
const esc = 76 / 120;                         // la B a la altura de las mayúsculas
const corre = (110.64 * esc + 7.6) - 71.67;   // misma separación B→u que el nombre
const k = 25.51 / 120;                        // inclinación de la B
const cx = 262.31 + k * (BASE - 9.65);        // el punto, sobre la i ya inclinada
const cy = 9.65;
const R = [11.6, 16.8];                       // los dos anillos
const GROSOR = 3.5;
const R_PUNTO = 7.2;

// El palito de la i, para cortar los anillos donde pasa.
const PALITO = 'M255.13 78V21H269.48V78Z';
if (!uxci.includes(PALITO)) throw new Error('No encontré el palito de la i en el nombre');
const INCLINAR = 'translate(' + (corre + k * BASE).toFixed(2) + ' 0) skewX(-12)';
const SENAL = 'translate(' + corre.toFixed(2) + ' 0)';

const arriba = +(cy - R[1] - GROSOR / 2 - 1).toFixed(2);
const ancho = +(cx + R[1] + GROSOR / 2 + corre + 2).toFixed(2);
const alto = +(80 - arriba).toFixed(2);

// Los anillos laten (no con movimiento reducido). Funciona también como <img>.
const ESTILO = '<style>.onda{animation:onda 2.4s ease-in-out infinite}.onda2{animation-delay:.35s}'
  + '@keyframes onda{0%,100%{opacity:1}50%{opacity:.2}}'
  + '@media (prefers-reduced-motion:reduce){.onda{animation:none}}</style>';

// Todo visible menos el palito de la i engordado 3,5 de cada lado.
const MASCARA = '<mask id="bx-sin-palito" maskUnits="userSpaceOnUse" x="0" y="' + arriba + '" width="' + ancho + '" height="' + alto + '">'
  + '<rect x="0" y="' + arriba + '" width="' + ancho + '" height="' + alto + '" fill="#fff"/>'
  + '<g transform="' + INCLINAR + '"><path d="' + PALITO + '" fill="#000" stroke="#000" stroke-width="7" stroke-linejoin="round"/></g></mask>';

const anillo = (r, clase) => '<circle class="' + clase + '" cx="' + cx.toFixed(2) + '" cy="' + cy + '" r="' + r + '"/>';

function logo(colorLetras) {
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 ' + arriba + ' ' + ancho + ' ' + alto + '" role="img" aria-label="Buxci"><title>Buxci</title>'
    + ESTILO + '<defs>' + MASCARA + '</defs>'
    + '<g transform="translate(0 2) scale(' + esc.toFixed(5) + ')">' + marca + '</g>'
    + '<g transform="' + INCLINAR + '"><path fill="' + colorLetras + '" d="' + SIN_X + '"/><path fill="' + VERDE + '" d="' + X + '"/></g>'
    + '<g transform="' + SENAL + '"><circle cx="' + cx.toFixed(2) + '" cy="' + cy + '" r="' + R_PUNTO + '" fill="' + VERDE + '"/></g>'
    + '<g mask="url(#bx-sin-palito)"><g transform="' + SENAL + '" fill="none" stroke="' + VERDE + '" stroke-width="' + GROSOR + '">'
    + anillo(R[0], 'onda') + anillo(R[1], 'onda onda2') + '</g></g></svg>';
}

writeFileSync(join(MARCA, 'buxci-logo.svg'), logo('#ffffff'));
writeFileSync(join(MARCA, 'buxci-logo-marino.svg'), logo('#0a1628'));

console.log(JSON.stringify({
  viewBox: '0 ' + arriba + ' ' + ancho + ' ' + alto,
  marca: 'translate(0 2) scale(' + esc.toFixed(5) + ')',
  letras: INCLINAR,
  senal: SENAL,
  palito: PALITO,
  punto: { cx: +cx.toFixed(2), cy, r: R_PUNTO },
  anillos: R,
  grosor: GROSOR,
  mascara: { x: 0, y: arriba, ancho, alto },
}));
