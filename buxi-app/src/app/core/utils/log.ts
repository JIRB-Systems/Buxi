// Único lugar por donde salen los errores que hasta ahora se tragaba un
// `catch {}`. No hay Sentry ni telemetría en el proyecto, así que por ahora
// esto no es más que la consola — pero al estar centralizado, el día que se
// conecte un servicio de errores se cambia acá y no en cada catch suelto.
//
// El contexto importa tanto como el error: un PostgrestError suelto dice
// "relation does not exist" sin decir cuál de las diez consultas de la página
// lo produjo, y con el `catch` vacío ni siquiera decía eso.
export function logError(contexto: string, error: unknown): void {
  // eslint-disable-next-line no-console
  console.error(`[buxi] ${contexto}:`, error);
}
