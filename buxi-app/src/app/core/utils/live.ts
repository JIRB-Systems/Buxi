import { RealtimeChannel } from '@supabase/supabase-js';

/**
 * Engancha un canal de Realtime a varias tablas y llama `onCambio` cuando
 * cualquiera de ellas se mueve.
 *
 * Por qué un refresco completo y no parchear la fila que llegó: los paneles
 * muestran datos derivados (contadores de pendientes, gráficos, joins a
 * empresas y rutas) que no se pueden reconstruir desde el payload de una sola
 * fila. Volver a pedir los datos es unas milésimas contra tablas de decenas de
 * filas, y no puede desincronizarse de lo que hay en la base — que es
 * exactamente el bug que se está arreglando. El día que alguna lista tenga
 * miles de filas, ESA lista se parchea a mano; el resto puede seguir así.
 *
 * El debounce importa: al aprobar una empresa o al resolver varias emergencias
 * caen varios eventos seguidos, y sin agrupar se dispararía un `loadData()` por
 * cada uno.
 *
 * Ojo: Realtime solo emite eventos de tablas que estén en la publicación
 * `supabase_realtime` (ver 20260917000000). Si una tabla no está ahí, esto se
 * suscribe sin error y no llega nada nunca.
 */
export function suscribirCambios(
  canal: RealtimeChannel,
  tablas: string[],
  onCambio: () => void,
  debounceMs = 400,
): RealtimeChannel {
  let timer: any = null;
  const disparar = () => {
    clearTimeout(timer);
    timer = setTimeout(onCambio, debounceMs);
  };

  for (const table of tablas) {
    canal.on(
      'postgres_changes' as any,
      { event: '*', schema: 'public', table },
      disparar,
    );
  }
  return canal;
}
