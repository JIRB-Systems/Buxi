// Copia las tarifas vigentes de bus que ARESEP publica como datos abiertos a
// la tabla `tarifas_aresep`, y actualiza el precio de las rutas enlazadas a un
// tramo (ver la migración tarifas_aresep).
//
// La llama pg_cron una vez por semana con la clave pública, que no es un JWT;
// por eso la función va con verify_jwt = false y decide sola:
//   - Un admin_jirb con sesión fuerza la sincronización (botón en la consola).
//   - Cualquier otra llamada solo sincroniza si la última vez fue hace más de
//     6 días. Así, aunque alguien la llame mil veces, ARESEP recibe a lo sumo
//     una consulta por semana y nada se puede ensuciar: lo único que hace es
//     copiar datos oficiales.
//
// Si la respuesta de ARESEP viene rara (vacía, recortada, otro formato) no se
// toca nada: es preferible una tarifa de hace una semana a ninguna.

import { createClient } from "jsr:@supabase/supabase-js@2";

const FUENTE =
  "https://datos.aresep.go.cr/ws.datosabiertos/Services/IT/PliegoTarifario.svc/ObtenerPliegoTarifarioAutobus/0";
const MIN_ENTRE_SYNC_MS = 6 * 24 * 60 * 60 * 1000;
// Hoy son ~4.800 tramos. Menos que esto es una respuesta incompleta.
const MIN_FILAS = 1000;
const LOTE = 500;

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
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// ¿Quien llama es un admin_jirb con sesión válida?
async function esJirb(req: Request): Promise<boolean> {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token || !token.startsWith("eyJ")) return false;
  const { data } = await admin.auth.getUser(token);
  if (!data?.user) return false;
  const { data: perfil } = await admin.from("profiles").select("rol").eq("id", data.user.id).maybeSingle();
  return perfil?.rol === "admin_jirb";
}

const texto = (v: unknown) => (typeof v === "string" ? v.trim() : "");
function numero(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
const fecha = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

type Fila = Record<string, unknown>;

function convertir(r: Fila, ahora: string) {
  const codigo = texto(r.codigoFraccionamiento);
  const tarifa = numero(r.tarifaRegular);
  if (!codigo || tarifa === null || !texto(r.codigoRuta)) return null;
  return {
    codigo_fraccionamiento: codigo,
    codigo_ruta: texto(r.codigoRuta),
    nombre_ruta: texto(r.nombreRuta),
    codigo_ramal: texto(r.codigoRamal) || null,
    nombre_ramal: texto(r.nombreRamal) || null,
    nombre_fraccionamiento: texto(r.nombreFraccionamiento) || texto(r.nombreRamal),
    km: numero(r.promedioKmViaje),
    tarifa_regular: tarifa,
    tarifa_adulto_mayor: numero(r.tarifaAdultoMayor),
    resolucion: texto(r.resolucion) || null,
    fecha_vigencia: fecha(r.fechaVigencia),
    operadores: texto(r.operadores) || null,
    vigente: true,
    actualizado_at: ahora,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return responder(405, { error: "Método no permitido." });

  const forzar = await esJirb(req);
  const { data: estado } = await admin.from("tarifas_aresep_sync").select("ultima_ok").eq("id", 1).maybeSingle();
  if (!forzar && estado?.ultima_ok && Date.now() - Date.parse(estado.ultima_ok) < MIN_ENTRE_SYNC_MS) {
    return responder(200, { ok: true, omitido: true, ultima_ok: estado.ultima_ok });
  }

  const ahora = new Date().toISOString();
  await admin.from("tarifas_aresep_sync").update({ ultimo_intento: ahora }).eq("id", 1);

  const fallar = async (mensaje: string) => {
    await admin.from("tarifas_aresep_sync").update({ error: mensaje }).eq("id", 1);
    return responder(502, { error: mensaje });
  };

  let filas: Fila[];
  try {
    const res = await fetch(FUENTE, {
      headers: { "User-Agent": "Buxmap/1.0 (buxi.vercel.app)" },
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) return await fallar(`ARESEP respondió ${res.status}`);
    const cuerpo = await res.json();
    filas = Array.isArray(cuerpo?.value) ? cuerpo.value : [];
  } catch (e) {
    return await fallar(`No se pudo leer ARESEP: ${String(e).slice(0, 200)}`);
  }

  const convertidas = filas.map((r) => convertir(r, ahora)).filter((r) => r !== null);
  if (convertidas.length < MIN_FILAS) {
    return await fallar(`ARESEP devolvió ${convertidas.length} tramos; se esperaban más de ${MIN_FILAS}. No se tocó nada.`);
  }

  for (let i = 0; i < convertidas.length; i += LOTE) {
    const { error } = await admin.from("tarifas_aresep")
      .upsert(convertidas.slice(i, i + LOTE), { onConflict: "codigo_fraccionamiento" });
    if (error) return await fallar(`No se pudieron guardar las tarifas: ${error.message}`);
  }

  // Lo que ya no vino en esta descarga queda marcado, no borrado: una ruta
  // enlazada a ese tramo sigue teniendo su último precio conocido.
  await admin.from("tarifas_aresep").update({ vigente: false }).lt("actualizado_at", ahora);

  const { data: rutasActualizadas, error: errRutas } = await admin.rpc("aplicar_tarifas_aresep");
  if (errRutas) return await fallar(`Tarifas guardadas, pero no se actualizaron las rutas: ${errRutas.message}`);

  await admin.from("tarifas_aresep_sync").update({
    ultima_ok: ahora,
    filas: convertidas.length,
    rutas_actualizadas: rutasActualizadas ?? 0,
    error: null,
  }).eq("id", 1);

  return responder(200, { ok: true, filas: convertidas.length, rutas_actualizadas: rutasActualizadas ?? 0 });
});
