import * as L from 'leaflet';

// Un mapa embebido dentro de una página con scroll es una trampa: la rueda del
// mouse hace zoom en vez de bajar, y en móvil arrastrar con un dedo mueve el
// mapa en vez de desplazar la página. Si el mapa es alto, el usuario queda
// atrapado y no puede llegar al contenido de abajo.
//
// Esto aplica el mismo trato que usa Google Maps embebido: la rueda sola
// scrollea la página (con Ctrl hace zoom), y un dedo scrollea la página (con
// dos dedos se mueve el mapa). Cuando el usuario intenta el gesto "atrapado"
// se le muestra un cartel explicando cuál es el gesto correcto.
//
// Ojo: el mapa debe crearse con `scrollWheelZoom: false`, si no Leaflet se
// queda con la rueda antes de que lleguemos nosotros.

const HINT_VISIBLE_MS = 1400;

export function enableCooperativeGestures(map: L.Map): void {
  const container = map.getContainer();

  const hint = document.createElement('div');
  hint.className = 'map-gesture-hint';
  container.appendChild(hint);

  let hideTimer: any = null;

  const showHint = (text: string) => {
    hint.textContent = text;
    hint.classList.add('visible');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => hint.classList.remove('visible'), HINT_VISIBLE_MS);
  };

  const hideHint = () => {
    clearTimeout(hideTimer);
    hint.classList.remove('visible');
  };

  // ---- Rueda del mouse: sólo hace zoom con Ctrl/Cmd ----
  const onWheel = (e: WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) {
      // Sin preventDefault: el navegador scrollea la página normalmente.
      showHint('Usá Ctrl + rueda para hacer zoom');
      return;
    }
    e.preventDefault();
    hideHint();
    const point = map.mouseEventToContainerPoint(e);
    const zoomDelta = e.deltaY > 0 ? -0.6 : 0.6;
    map.setZoomAround(map.containerPointToLatLng(point), map.getZoom() + zoomDelta);
  };

  // ---- Táctil: sólo se arrastra con dos dedos ----
  // Se escucha en fase de captura para decidir antes de que el handler de
  // arrastre de Leaflet (que escucha en fase de burbujeo) tome el control.
  const onTouchStart = (e: TouchEvent) => {
    if (e.touches.length >= 2) {
      map.dragging.enable();
      hideHint();
    } else {
      map.dragging.disable();
    }
  };

  const onTouchMove = (e: TouchEvent) => {
    if (e.touches.length === 1) showHint('Movés el mapa con dos dedos');
  };

  container.addEventListener('wheel', onWheel, { passive: false });
  container.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
  container.addEventListener('touchmove', onTouchMove, { passive: true });

  map.on('unload', () => {
    clearTimeout(hideTimer);
    container.removeEventListener('wheel', onWheel);
    container.removeEventListener('touchstart', onTouchStart, { capture: true } as any);
    container.removeEventListener('touchmove', onTouchMove);
    hint.remove();
  });
}
