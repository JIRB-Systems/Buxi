// Contraseñas temporales para cuentas que crea un administrador en nombre de
// otra persona (la empresa que JIRB aprueba, un chofer, alguien del equipo).
//
// Antes la consola JIRB precargaba siempre la misma clave fija y la usaba si
// el campo quedaba vacío: todas las empresas aprobadas así terminaban con la
// misma contraseña, escrita en el código fuente.

// Sin 0/O, 1/l/I: la clave se dicta o se copia a mano y esos se confunden.
const MAYUSCULAS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const MINUSCULAS = 'abcdefghijkmnopqrstuvwxyz';
const DIGITOS = '23456789';
const TODOS = MAYUSCULAS + MINUSCULAS + DIGITOS;

// La misma regla que piden los formularios de la app: 8 o más caracteres, con
// mayúscula, minúscula y número.
export const REGLA_CLAVE = 'al menos 8 caracteres, con mayúscula, minúscula y número';

export function claveValida(clave: string | null | undefined): boolean {
  return !!clave && /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(clave);
}

// Índice uniforme en [0, n) sin sesgo de módulo: se descartan los valores del
// tramo final que no completa una vuelta entera.
function indice(n: number): number {
  const limite = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  do { crypto.getRandomValues(buf); } while (buf[0] >= limite);
  return buf[0] % n;
}

export function generarClaveTemporal(largo = 14): string {
  const n = Math.max(8, largo);
  const letras = [
    MAYUSCULAS[indice(MAYUSCULAS.length)],
    MINUSCULAS[indice(MINUSCULAS.length)],
    DIGITOS[indice(DIGITOS.length)],
  ];
  while (letras.length < n) letras.push(TODOS[indice(TODOS.length)]);
  // Mezcla (Fisher–Yates) para que las tres obligatorias no queden siempre
  // al principio.
  for (let i = letras.length - 1; i > 0; i--) {
    const j = indice(i + 1);
    [letras[i], letras[j]] = [letras[j], letras[i]];
  }
  return letras.join('');
}
