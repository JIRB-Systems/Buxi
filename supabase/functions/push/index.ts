// Notificaciones push (Web Push) para el pasajero. Ver la migración
// notificaciones_push.
//
// Recibe un cuerpo JSON con `tipo`:
//   - "clave":    devuelve la clave pública VAPID para suscribirse. La primera
//                 vez genera el par de claves y lo guarda en push_config, que
//                 solo puede leer esta función: la privada no sale de acá.
//   - "aviso":    `id` de un aviso de empresa recién creado (lo llama un
//                 trigger). Se lo manda a quienes siguen a la empresa, UNA vez.
//   - "llegadas": revisa las alertas "avisame cuando falten N minutos" (lo
//                 llama pg_cron cada minuto).
//   - "prueba":   manda "así te van a llegar los avisos" a los navegadores de
//                 quien llama (con su sesión). Solo a uno mismo.
//
// verify_jwt = false porque la llaman pg_cron y un trigger con la clave
// publicable. No confía en quien llama: el contenido sale de la base, cada
// aviso se manda una sola vez y una alerta se marca al avisar.

import { createClient } from "jsr:@supabase/supabase-js@2";
import * as webpush from "jsr:@negrel/webpush@0.5.0";

const CONTACTO = "mailto:hola@buxci.com";
const APP = "https://app.buxci.com";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function responder(status: number, cuerpo: Record<string, unknown>): Response {
  return new Response(JSON.stringify(cuerpo), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

// ---- Claves y servidor ----
let servidorListo: Promise<{ server: webpush.ApplicationServer; publica: string }> | null = null;

function servidor() {
  if (!servidorListo) servidorListo = crearServidor().catch((e) => { servidorListo = null; throw e; });
  return servidorListo;
}

async function crearServidor() {
  let { data } = await admin.from("push_config").select("vapid").eq("id", 1).maybeSingle();
  if (!data) {
    const nuevas = await webpush.generateVapidKeys({ extractable: true });
    const exportadas = await webpush.exportVapidKeys(nuevas);
    // Si dos instancias llegan a la vez, gana la primera y las dos usan esa.
    await admin.from("push_config").upsert({ id: 1, vapid: exportadas }, { onConflict: "id", ignoreDuplicates: true });
    ({ data } = await admin.from("push_config").select("vapid").eq("id", 1).single());
  }
  const vapidKeys = await webpush.importVapidKeys(data!.vapid, { extractable: false });
  const server = await webpush.ApplicationServer.new({ contactInformation: CONTACTO, vapidKeys });
  const publica = await webpush.exportApplicationServerKey(vapidKeys);
  return { server, publica };
}

interface Mensaje { title: string; body: string; url: string; tag: string }

// Manda a todos los navegadores de esos usuarios. Las suscripciones que el
// servicio de push da por muertas (410/404) se borran.
async function enviar(userIds: string[], m: Mensaje, urgente: boolean): Promise<number> {
  if (!userIds.length) return 0;
  const { server } = await servidor();
  const { data: subs } = await admin.from("push_suscripciones")
    .select("id, endpoint, p256dh, auth").in("user_id", userIds);
  let enviados = 0;
  await Promise.all((subs || []).map(async (s) => {
    try {
      await server.subscribe({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } })
        .pushTextMessage(JSON.stringify(m), {
          urgency: urgente ? webpush.Urgency.High : webpush.Urgency.Normal,
          ttl: urgente ? 15 * 60 : 6 * 60 * 60,
        });
      enviados++;
    } catch (e) {
      const status = (e as { response?: Response })?.response?.status;
      if (status === 404 || status === 410) await admin.from("push_suscripciones").delete().eq("id", s.id);
      else console.error("push falló", status, String(e).slice(0, 200));
    }
  }));
  return enviados;
}

// ---- Avisos de empresa ----
async function aviso(id: string): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return responder(400, { error: "id inválido" });
  const { data: n } = await admin.from("notificaciones_empresa")
    .select("id, empresa_id, ruta_id, tipo, titulo, mensaje, empresa:empresas(nombre)")
    .eq("id", id).maybeSingle();
  if (!n) return responder(404, { error: "No existe ese aviso" });

  // La fila es el candado: si ya existe, este aviso ya se mandó.
  const { error: yaEnviado } = await admin.from("push_avisos_enviados").insert({ notificacion_id: id });
  if (yaEnviado) return responder(200, { ok: true, omitido: true });

  const { data: seguidores } = await admin.from("favoritos_empresa").select("user_id").eq("empresa_id", n.empresa_id);
  const empresa = (n.empresa as unknown as { nombre?: string } | null)?.nombre || "Tu empresa";
  const enviados = await enviar((seguidores || []).map((f) => f.user_id), {
    title: `${empresa}: ${n.titulo}`,
    body: n.mensaje,
    url: n.ruta_id ? `${APP}/passenger/map?ruta=${n.ruta_id}` : `${APP}/passenger/map`,
    tag: `aviso-${n.id}`,
  }, n.tipo === "cancelacion" || n.tipo === "atraso");
  await admin.from("push_avisos_enviados").update({ destinatarios: enviados }).eq("notificacion_id", id);
  return responder(200, { ok: true, enviados });
}

// ---- Alertas de llegada ----
function km(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const r = (x: number) => (x * Math.PI) / 180;
  const dLat = r(bLat - aLat), dLng = r(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

// Las calles no son una línea recta: se estira la distancia un 30 %.
const FACTOR_CALLE = 1.3;
// Si el GPS no da velocidad (o el bus está parado en una parada), se asume
// la de un bus en ciudad.
const KMH_POR_DEFECTO = 22;

async function llegadas(): Promise<Response> {
  const ahora = new Date().toISOString();
  // Limpieza: lo vencido o avisado hace más de un día.
  await admin.from("alertas_llegada").delete().lt("expira_at", new Date(Date.now() - 86400000).toISOString());

  const { data: alertas } = await admin.from("alertas_llegada")
    .select("id, user_id, ruta_id, minutos, parada:paradas(nombre, latitud, longitud), ruta:rutas(nombre)")
    .is("avisada_at", null).gt("expira_at", ahora);
  if (!alertas?.length) return responder(200, { ok: true, alertas: 0 });

  // Los dos últimos puntos de cada bus de esas rutas: el último dice dónde
  // está, la diferencia con el anterior dice si se acerca o se aleja.
  const rutas = [...new Set(alertas.map((a) => a.ruta_id))];
  const { data: buses } = await admin.from("buses").select("id, ruta_id, placa").in("ruta_id", rutas).in("estado", ["activo", "en_ruta"]);
  const busIds = (buses || []).map((b) => b.id);
  const puntos = new Map<string, { latitud: number; longitud: number; velocidad: number | null }[]>();
  if (busIds.length) {
    const { data: locs } = await admin.from("bus_locations")
      .select("bus_id, latitud, longitud, velocidad, timestamp")
      .in("bus_id", busIds)
      .gt("timestamp", new Date(Date.now() - 3 * 60000).toISOString())
      .order("timestamp", { ascending: false });
    for (const l of locs || []) {
      const arr = puntos.get(l.bus_id) || [];
      if (arr.length < 2) arr.push(l);
      puntos.set(l.bus_id, arr);
    }
  }

  let avisadas = 0;
  for (const a of alertas) {
    const parada = a.parada as unknown as { nombre: string; latitud: number; longitud: number } | null;
    if (!parada) continue;
    let mejor: { min: number; placa: string } | null = null;
    for (const b of (buses || []).filter((x) => x.ruta_id === a.ruta_id)) {
      const [ult, ant] = puntos.get(b.id) || [];
      if (!ult) continue;
      const dAhora = km(ult.latitud, ult.longitud, parada.latitud, parada.longitud);
      const dAntes = ant ? km(ant.latitud, ant.longitud, parada.latitud, parada.longitud) : null;
      // Se acerca si la distancia bajó; si no hay punto anterior, solo vale
      // si ya está prácticamente en la parada.
      const seAcerca = dAntes === null ? dAhora < 0.3 : dAhora < dAntes - 0.01 || dAhora < 0.3;
      if (!seAcerca) continue;
      const kmh = ult.velocidad && ult.velocidad > 8 ? Math.min(ult.velocidad, 60) : KMH_POR_DEFECTO;
      const min = (dAhora * FACTOR_CALLE / kmh) * 60;
      if (!mejor || min < mejor.min) mejor = { min, placa: b.placa };
    }
    if (!mejor || mejor.min > a.minutos) continue;

    // Marcar antes de mandar: si dos corridas se pisan, solo una avisa.
    const { data: marcada } = await admin.from("alertas_llegada")
      .update({ avisada_at: ahora }).eq("id", a.id).is("avisada_at", null).select("id");
    if (!marcada?.length) continue;

    const ruta = (a.ruta as unknown as { nombre?: string } | null)?.nombre || "Tu bus";
    const minutos = Math.max(1, Math.round(mejor.min));
    await enviar([a.user_id], {
      title: `${ruta}: llega en ~${minutos} min`,
      body: `Está por llegar a ${parada.nombre}. Placa ${mejor.placa}.`,
      url: `${APP}/passenger/map?ruta=${a.ruta_id}`,
      tag: `llegada-${a.id}`,
    }, true);
    avisadas++;
  }
  return responder(200, { ok: true, alertas: alertas.length, avisadas });
}

async function prueba(req: Request): Promise<Response> {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token || !token.startsWith("eyJ")) return responder(401, { error: "Hace falta iniciar sesión" });
  const { data } = await admin.auth.getUser(token);
  if (!data?.user) return responder(401, { error: "Sesión inválida" });
  const enviados = await enviar([data.user.id], {
    title: "Listo, así te van a llegar los avisos",
    body: "Atrasos, desvíos y cuando tu bus esté por llegar.",
    url: `${APP}/passenger/map`,
    tag: "prueba",
  }, false);
  return responder(200, { ok: true, enviados });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return responder(405, { error: "Método no permitido." });
  let cuerpo: { tipo?: string; id?: string };
  try {
    cuerpo = await req.json();
  } catch {
    return responder(400, { error: "Cuerpo inválido" });
  }
  try {
    switch (cuerpo.tipo) {
      case "clave": return responder(200, { clave: (await servidor()).publica });
      case "aviso": return await aviso(String(cuerpo.id || ""));
      case "llegadas": return await llegadas();
      case "prueba": return await prueba(req);
      default: return responder(400, { error: "tipo desconocido" });
    }
  } catch (e) {
    console.error("push", cuerpo.tipo, String(e).slice(0, 300));
    return responder(500, { error: "No se pudo completar" });
  }
});
