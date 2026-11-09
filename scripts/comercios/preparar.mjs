// Convierte los lugares de Overture (comercios-cr.json, de extraer.sql) en
// los comercios que dibuja el mapa del pasajero: comercios-cr.geojsonl, una
// línea por comercio, lista para tippecanoe.
//
// Uso: node preparar.mjs comercios-cr.json comercios-cr.geojsonl [resumen.md]
//
// - Se quedan los comercios: comida, tiendas, bancos, hospedaje, bombas y
//   talleres, peluquerías. Hospitales, escuelas, parques, iglesias y oficinas
//   públicas siguen saliendo del mapa base de MapTiler: cambian poco.
// - Fuera los cerrados y los de baja confianza (que existan de verdad).
// - Cada uno lleva el ícono del sprite de MapTiler que le corresponde, así se
//   ven igual que el resto del mapa.
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';

const [entrada, salida, resumen] = process.argv.slice(2);
if (!entrada || !salida) {
  console.error('Uso: node preparar.mjs comercios-cr.json comercios-cr.geojsonl [resumen.md]');
  process.exit(1);
}

// Overture da a cada lugar una "confianza" de que existe (0 a 1).
const CONFIANZA_MIN = 0.7;

// [grupo, ícono del sprite de MapTiler, palabras clave]. Se prueban en orden,
// de lo más específico a lo más general. Una palabra clave coincide con una
// categoría si es una de sus partes separadas por "_": "bar" coincide con
// "wine_bar" pero no con "barber_shop".
const REGLAS = [
  ['comida', 'cafe', ['cafe', 'coffee', 'coffee_shop', 'tea_room']],
  ['comida', 'ice_cream', ['ice_cream', 'gelato', 'frozen_yogurt']],
  ['comida', 'bakery', ['bakery', 'pastry', 'patisserie']],
  ['comida', 'bar', ['bar', 'pub', 'brewery', 'night_club', 'nightlife', 'lounge', 'cantina']],
  ['comida', 'fast_food', ['fast_food', 'burger', 'pizza', 'fried_chicken', 'hot_dog']],
  ['comida', 'restaurant', ['restaurant', 'eatery', 'diner', 'soda', 'food_court', 'food_and_drink']],
  ['finanzas', 'atm', ['atm']],
  ['finanzas', 'bank', ['bank', 'credit_union', 'financial_service', 'money_transfer']],
  ['auto', 'fuel', ['gas_station', 'fuel', 'petrol_station']],
  ['auto', 'car_rental', ['car_rental']],
  ['auto', 'car_repair', ['car_repair', 'auto_repair', 'automotive_repair', 'mechanic', 'tire_shop', 'car_wash', 'automotive']],
  ['hospedaje', 'lodging', ['hotel', 'hostel', 'motel', 'lodging', 'guest_house', 'bed_and_breakfast', 'resort', 'inn', 'accommodation', 'cabin']],
  ['servicios', 'hairdresser', ['hair_salon', 'barber', 'barber_shop', 'beauty_salon', 'hairdresser', 'nail_salon']],
  ['tiendas', 'pharmacy', ['pharmacy', 'drugstore']],
  ['tiendas', 'grocery', ['supermarket', 'grocery', 'grocery_store', 'hypermarket', 'butcher', 'market']],
  ['tiendas', 'convenience', ['convenience', 'convenience_store', 'pulperia', 'minimarket']],
  ['tiendas', 'clothing_store', ['clothing', 'clothing_store', 'fashion', 'shoe_store', 'shoes']],
  ['tiendas', 'hardware', ['hardware', 'hardware_store', 'home_improvement', 'building_supply']],
  ['tiendas', 'shop', ['shopping', 'retail', 'store', 'shop', 'shopping_mall', 'shopping_center', 'mall']],
];

const tiene = (categoria, clave) => `_${categoria}_`.includes(`_${clave}_`);

// Lo más específico primero: la básica, la principal y la jerarquía al revés.
function clasificar(p) {
  const etiquetas = [p.basica, p.primaria, ...[...(p.jerarquia || [])].reverse()]
    .filter(Boolean).map(s => String(s).toLowerCase());
  for (const etiqueta of etiquetas) {
    for (const [grupo, icono, claves] of REGLAS) {
      if (claves.some(c => tiene(etiqueta, c))) return { grupo, icono };
    }
  }
  return null;
}

const lugares = JSON.parse(readFileSync(entrada, 'utf8'));
const cuenta = { total: lugares.length, cerrados: 0, pocaConfianza: 0, noComercio: 0, salen: 0 };
const porGrupo = {};
const noClasificadas = {};
const lineas = [];

for (const p of lugares) {
  if (p.estado === 'permanently_closed' || p.estado === 'temporarily_closed') { cuenta.cerrados++; continue; }
  if ((p.confianza ?? 0) < CONFIANZA_MIN) { cuenta.pocaConfianza++; continue; }
  const c = clasificar(p);
  if (!c) {
    cuenta.noComercio++;
    const k = p.basica || p.primaria || '(sin categoría)';
    noClasificadas[k] = (noClasificadas[k] || 0) + 1;
    continue;
  }
  if (typeof p.lon !== 'number' || typeof p.lat !== 'number') continue;
  cuenta.salen++;
  porGrupo[c.grupo] = (porGrupo[c.grupo] || 0) + 1;
  lineas.push(JSON.stringify({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [Math.round(p.lon * 1e6) / 1e6, Math.round(p.lat * 1e6) / 1e6] },
    // Nombres cortos: van en cada tesela.
    properties: {
      n: String(p.nombre).slice(0, 60),
      c: c.icono,
      g: c.grupo,
      // Prioridad al chocar etiquetas: primero los de más confianza.
      r: Math.round((1 - p.confianza) * 100),
    },
  }));
}

writeFileSync(salida, lineas.join('\n') + '\n');

const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);
const texto = [
  '## Comercios de Costa Rica (Overture)',
  '',
  `- Lugares en el recuadro: ${cuenta.total}`,
  `- Cerrados: ${cuenta.cerrados}`,
  `- Con confianza menor a ${CONFIANZA_MIN}: ${cuenta.pocaConfianza}`,
  `- No son comercios (los sigue mostrando MapTiler o no van): ${cuenta.noComercio}`,
  `- **En el mapa: ${cuenta.salen}**`,
  '',
  '| Grupo | Comercios |', '|---|---|',
  ...top(porGrupo, 20).map(([g, n]) => `| ${g} | ${n} |`),
  '',
  '### Categorías que quedaron afuera (las 40 más comunes)',
  '', '| Categoría | Lugares |', '|---|---|',
  ...top(noClasificadas, 40).map(([k, n]) => `| ${k} | ${n} |`),
  '',
].join('\n');
console.log(texto);
if (resumen) appendFileSync(resumen, texto + '\n');

// Si algo se rompió en Overture (columna renombrada, recuadro vacío), mejor
// fallar acá que publicar un mapa sin comercios.
if (cuenta.salen < 1000) {
  console.error(`Solo ${cuenta.salen} comercios: no se publica.`);
  process.exit(2);
}
