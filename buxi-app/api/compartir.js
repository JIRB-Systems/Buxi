// Vista previa de un bus compartido: https://app.buxci.com/v/<id del bus>
// (vercel.json reescribe /v/:bus a esta función).
//
// WhatsApp, Telegram, Facebook y compañía arman la tarjeta del enlace leyendo
// las etiquetas Open Graph del HTML, sin correr JavaScript. La app es una
// página que se dibuja con JavaScript, así que para ellos estaba vacía: el
// enlace salía pelado, sin tarjeta. Acá se devuelve un HTML mínimo con el bus
// (unidad, ruta y empresa) y la imagen de "Ubicación en vivo"; a las personas
// el mismo HTML las manda enseguida al mapa siguiendo ese bus.
//
// Sin dependencias y sin claves privadas: lee buses_en_vivo con la clave
// pública de la app (la misma que usa cualquier pasajero sin cuenta).

const SUPABASE_URL = 'https://gduxelmqqnqupimfcdeb.supabase.co';
const SUPABASE_CLAVE_PUBLICA = 'sb_publishable_s8kfM1PQVM125VtKlCK2uA_ZwGgA-d8';
const APP = 'https://app.buxci.com';
const IMAGEN = APP + '/assets/og/bus-en-vivo.jpg';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// El bus, si está transmitiendo (última hora). Si no, la tarjeta sale genérica.
async function buscarBus(id) {
  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/buses_en_vivo', {
      method: 'POST',
      headers: { apikey: SUPABASE_CLAVE_PUBLICA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_ruta_id: null, p_max_age_minutes: 60 }),
      signal: AbortSignal.timeout(2500),
    });
    if (!r.ok) return null;
    const filas = await r.json();
    return Array.isArray(filas) ? filas.find(f => f.bus_id === id) || null : null;
  } catch {
    return null;
  }
}

module.exports = async function handler(req, res) {
  const id = String((req.query && req.query.bus) || '').trim();
  const valido = UUID.test(id);
  const destino = valido ? '/passenger/map?bus=' + encodeURIComponent(id) : '/passenger/map';
  const enlace = valido ? APP + '/v/' + id : APP + '/passenger/map';

  let titulo = 'Seguí este bus en vivo en Buxci';
  let descripcion = 'Mirá en el mapa por dónde va, minuto a minuto.';
  const bus = valido ? await buscarBus(id) : null;
  if (bus) {
    // La placa, como en el mensaje que se comparte; la unidad va abajo.
    const placa = bus.placa || bus.numero_unidad || '';
    const unidad = bus.numero_unidad && bus.numero_unidad !== placa
      ? (/^\d+$/.test(bus.numero_unidad) ? 'Unidad ' + bus.numero_unidad : bus.numero_unidad)
      : '';
    titulo = 'Bus ' + placa + ' en vivo' + (bus.ruta_nombre ? ' · ' + bus.ruta_nombre : '');
    descripcion = [bus.empresa_nombre, unidad, 'Tocá para ver por dónde va en el mapa de Buxci.'].filter(Boolean).join(' · ');
  }

  const html = '<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<title>' + esc(titulo) + '</title>'
    + '<meta name="description" content="' + esc(descripcion) + '">'
    + '<meta property="og:type" content="website">'
    + '<meta property="og:site_name" content="Buxci">'
    + '<meta property="og:locale" content="es_CR">'
    + '<meta property="og:title" content="' + esc(titulo) + '">'
    + '<meta property="og:description" content="' + esc(descripcion) + '">'
    + '<meta property="og:url" content="' + esc(enlace) + '">'
    + '<meta property="og:image" content="' + IMAGEN + '">'
    + '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">'
    + '<meta property="og:image:alt" content="Ubicación en vivo del bus en el mapa de Buxci">'
    + '<meta name="twitter:card" content="summary_large_image">'
    // Las personas siguen al mapa enseguida. Meta refresh y no un script: la
    // política de seguridad del sitio no deja correr scripts en línea.
    + '<meta http-equiv="refresh" content="0; url=' + esc(destino) + '">'
    + '<meta name="theme-color" content="#0a1628">'
    + '</head><body style="margin:0;background:#0a1628;color:#fff;font-family:system-ui,sans-serif">'
    + '<p style="padding:24px">Abriendo el mapa… <a style="color:#00e676" href="' + esc(destino) + '">Tocá acá si no se abre</a>.</p>'
    + '</body></html>';

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // Un minuto: la tarjeta cambia poco y así una ola de vistas previas no
  // golpea la base.
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60');
  res.statusCode = 200;
  res.end(html);
};
