// Los marcadores y popups de MapLibre se arman con strings de HTML que van
// directo a innerHTML / setHTML, fuera del sanitizador de Angular. Varios de
// esos strings llevaban datos que escribe una EMPRESA —placa, nombre de ruta,
// nombre de parada, color de ruta— sin escapar.
//
// Eso es inyección de HTML almacenada y cruzada entre tenants: una empresa
// podía meter HTML en el panel de JIRB y en el mapa de todos los pasajeros.
// En la web la CSP de vercel.json bloquea la ejecución de scripts, pero la app
// nativa de Capacitor no recibe esas cabeceras, así que ahí no había red de
// contención.
//
// Regla: todo dato que venga de la base y termine dentro de un template string
// de HTML pasa por `esc()`; todo color que termine dentro de un `style` pasa
// por `colorSeguro()`.

const ENTIDADES: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};

export function esc(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  return String(valor).replace(/[&<>"']/g, c => ENTIDADES[c]);
}

// Un color va dentro de un atributo `style="background:${color}"`. Escapar no
// alcanza ahí: `red;background-image:url(...)` no tiene ningún carácter
// especial y sigue siendo CSS arbitrario. Solo se aceptan colores hex; la base
// exige lo mismo con un CHECK en rutas.color (20260918000000).
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function colorSeguro(color: unknown, respaldo = '#00c853'): string {
  return typeof color === 'string' && HEX.test(color) ? color : respaldo;
}
