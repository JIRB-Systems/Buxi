import { ErrorHandler, Injectable } from '@angular/core';

// Cuando se despliega una versión nueva, los nombres (hash) de los chunks
// lazy cambian. Un usuario con la pestaña abierta de la versión vieja, al
// navegar a una página lazy (Rutas, Perfil, etc.), pide un chunk que ya no
// existe → "ChunkLoadError" → la navegación queda trabada y hay que recargar
// a mano. Este handler detecta ese caso y recarga la app una sola vez para
// traer la versión nueva, de forma transparente.
@Injectable()
export class ChunkErrorHandler implements ErrorHandler {
  private static readonly LAST_RELOAD_KEY = 'buxi-chunk-reloaded-at';
  // Dos recargas separadas por menos de esto son un bucle, no dos despliegues.
  private static readonly LOOP_WINDOW_MS = 20_000;

  handleError(error: unknown): void {
    const msg = ((error as any)?.message ?? String(error)) || '';
    const isChunkError = /ChunkLoadError|Loading chunk [\w-]+ failed|dynamically imported module|Importing a module script failed/i.test(msg);

    if (isChunkError && this.shouldReload()) {
      sessionStorage.setItem(ChunkErrorHandler.LAST_RELOAD_KEY, String(Date.now()));
      window.location.reload();
      return;
    }

    // eslint-disable-next-line no-console
    console.error(error);
  }

  // Antes se guardaba una bandera de "ya recargué" que nunca se limpiaba, así
  // que sólo se recuperaba del PRIMER chunk caído de la sesión. Con la pestaña
  // abierta durante varios despliegues seguidos, el segundo fallo dejaba la
  // navegación muerta: el usuario tocaba un botón, no pasaba nada, y tenía que
  // recargar a mano. Ahora se recarga ante cada fallo, salvo que otro acabe de
  // ocurrir — eso sí sería un bucle.
  private shouldReload(): boolean {
    const last = Number(sessionStorage.getItem(ChunkErrorHandler.LAST_RELOAD_KEY) || 0);
    return !last || Date.now() - last > ChunkErrorHandler.LOOP_WINDOW_MS;
  }
}
