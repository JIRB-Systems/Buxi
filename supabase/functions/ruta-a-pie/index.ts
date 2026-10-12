// Camino a pie entre dos puntos, para el "Cómo llegar" a la parada.
//
// Proxy hacia el enrutador peatonal de OpenStreetMap (FOSSGIS). El de OSRM que
// usa el trazado de rutas no sirve acá: su servidor público ignora el perfil y
// siempre calcula en carro, así que mandaba a dar la vuelta por los sentidos
// de vía y decía "5 minutos" para una caminata de media hora.
//
// Pasa por nuestro servidor, igual que la geocodificación, por dos motivos:
//  - Lo que se manda es la ubicación del pasajero. Llamando directo desde el
//    navegador, un tercero recibiría esa ubicación junto con su IP. Así solo
//    ve la IP de este servidor y dos coordenadas sin dueño.
//  - Permite identificarse con un User-Agent, como pide su política de uso.
//
// Exige sesión (verify_jwt) y limita por usuario: sin eso cualquiera podría
// usar esta función como enrutador gratis hasta que nos bloqueen.

import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;

// Caminar más que esto hasta una parada no es "cómo llegar a la parada".
const MAX_KM = 15;

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extra },
  });
}

// A quién se le cuenta el límite: al usuario de la sesión. La firma del token
// ya la validó la plataforma antes de llegar acá (verify_jwt), así que alcanza
// con leer el `sub`. Si por algo no se puede, se cae a la IP.
function quien(req: Request): string {
  try {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (typeof payload.sub === "string" && payload.sub) return `pie:${payload.sub}`;
  } catch (_e) { /* cae a la IP */ }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  return `pie:${ip}`;
}

// Misma tabla que la geocodificación: la clave lleva el prefijo "pie:" para
// que los dos contadores no se mezclen.
async function isRateLimited(clave: string): Promise<boolean> {
  const now = new Date();
  const { data: row } = await supabase
    .from("geocode_rate_limit")
    .select("window_start, count")
    .eq("ip", clave)
    .maybeSingle();

  if (!row) {
    await supabase.from("geocode_rate_limit").insert({ ip: clave, window_start: now.toISOString(), count: 1 });
    return false;
  }

  const windowAge = now.getTime() - new Date(row.window_start).getTime();
  if (windowAge > RATE_LIMIT_WINDOW_MS) {
    await supabase.from("geocode_rate_limit").update({ window_start: now.toISOString(), count: 1 }).eq("ip", clave);
    return false;
  }

  if (row.count >= RATE_LIMIT_MAX) return true;

  await supabase.from("geocode_rate_limit").update({ count: row.count + 1 }).eq("ip", clave);
  return false;
}

type Punto = { lat: number; lng: number };

// Coordenadas reales y dentro de Costa Rica (con margen, Isla del Coco incluida).
function punto(v: unknown): Punto | null {
  const p = v as Punto;
  if (!p || typeof p.lat !== "number" || typeof p.lng !== "number") return null;
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return null;
  if (p.lat < 5 || p.lat > 12 || p.lng < -88 || p.lng > -82) return null;
  return p;
}

function km(a: Punto, b: Punto): number {
  const R = 6371, rad = Math.PI / 180;
  const x = Math.sin((b.lat - a.lat) * rad / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lng - a.lng) * rad / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  if (await isRateLimited(quien(req))) {
    return json({ error: "too many requests" }, 429, { "Retry-After": "60" });
  }

  let cuerpo: { desde?: unknown; hasta?: unknown };
  try {
    cuerpo = await req.json();
  } catch (_e) {
    return json({ error: "invalid body" }, 400);
  }

  const desde = punto(cuerpo.desde);
  const hasta = punto(cuerpo.hasta);
  if (!desde || !hasta) return json({ error: "invalid coordinates" }, 400);
  if (km(desde, hasta) > MAX_KM) return json({ error: "too far" }, 400);

  // Cinco decimales son ~1 m: de sobra para caminar, y no se manda más
  // precisión de la que hace falta.
  const c = (n: number) => n.toFixed(5);
  const url = "https://routing.openstreetmap.de/routed-foot/route/v1/foot/" +
    `${c(desde.lng)},${c(desde.lat)};${c(hasta.lng)},${c(hasta.lat)}` +
    "?overview=full&geometries=geojson";

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "BuxiApp/1.0 (contacto@buxi.cr)" },
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json();
    const ruta = data?.routes?.[0];
    const coords = ruta?.geometry?.coordinates;
    if (data?.code !== "Ok" || !Array.isArray(coords) || coords.length < 2) {
      return json({ error: "no route" }, 502);
    }
    return json({ coords, metros: Math.round(ruta.distance), segundos: Math.round(ruta.duration) });
  } catch (_err) {
    // El cliente tiene su propio respaldo (línea recta y tiempo estimado).
    return json({ error: "router unavailable" }, 502);
  }
});
