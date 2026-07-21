import { ErrorHandler, Injectable } from '@angular/core';

// Cuando se despliega una versión nueva, los nombres (hash) de los chunks
// lazy cambian. Un usuario con la pestaña abierta de la versión vieja, al
// navegar a una página lazy (Rutas, Perfil, etc.), pide un chunk que ya no
// existe → "ChunkLoadError" → la navegación queda trabada y hay que recargar
// a mano. Este handler detecta ese caso y recarga la app una sola vez para
// traer la versión nueva, de forma transparente.
@Injectable()
export class ChunkErrorHandler implements ErrorHandler {
  private static readonly RELOAD_FLAG = 'buxi-chunk-reloaded';

  handleError(error: unknown): void {
    const msg = ((error as any)?.message ?? String(error)) || '';
    const isChunkError = /ChunkLoadError|Loading chunk [\w-]+ failed|dynamically imported module|Importing a module script failed/i.test(msg);

    if (isChunkError && !sessionStorage.getItem(ChunkErrorHandler.RELOAD_FLAG)) {
      // Evita bucle de recargas: sólo una vez por sesión.
      sessionStorage.setItem(ChunkErrorHandler.RELOAD_FLAG, '1');
      window.location.reload();
      return;
    }

    // eslint-disable-next-line no-console
    console.error(error);
  }
}
