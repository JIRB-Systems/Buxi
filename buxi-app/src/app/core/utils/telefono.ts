// Teléfonos de Costa Rica: 8 dígitos, con o sin el código de país (+506).
// Se guardan siempre igual, "8888-8888", para que se lean y se busquen bien.

// null si no es un número de CR. Acepta espacios, guiones, paréntesis y +506.
export function normalizarTelefono(texto: string): string | null {
  let d = (texto || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('506')) d = d.slice(3);
  if (d.length !== 8) return null;
  // Celulares empiezan con 5, 6, 7 u 8; fijos con 2 o 4.
  if (!/^[245678]/.test(d)) return null;
  return `${d.slice(0, 4)}-${d.slice(4)}`;
}
