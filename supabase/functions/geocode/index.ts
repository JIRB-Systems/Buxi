// Proxy hacia Nominatim (OpenStreetMap) para geocodificación de lugares.
// Llamado server-to-server: evita el bloqueo de CORS que sufre el navegador
// al llamar directo a Nominatim, y permite mandar un User-Agent identificable
// como pide su política de uso.
//
// Incluye rate-limit por IP (respaldado en Postgres, no en memoria) porque
// esta función es pública sin autenticación: sin límite, un abuso masivo
// podría agotar la cuota de invocaciones de Supabase o hacer que Nominatim
// bloquee nuestro User-Agent para siempre.

import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 20;

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

async function isRateLimited(ip: string): Promise<boolean> {
  const now = new Date();
  const { data: row } = await supabase
    .from("geocode_rate_limit")
    .select("window_start, count")
    .eq("ip", ip)
    .maybeSingle();

  if (!row) {
    await supabase.from("geocode_rate_limit").insert({ ip, window_start: now.toISOString(), count: 1 });
    return false;
  }

  const windowAge = now.getTime() - new Date(row.window_start).getTime();
  if (windowAge > RATE_LIMIT_WINDOW_MS) {
    await supabase.from("geocode_rate_limit").update({ window_start: now.toISOString(), count: 1 }).eq("ip", ip);
    return false;
  }

  if (row.count >= RATE_LIMIT_MAX) return true;

  await supabase.from("geocode_rate_limit").update({ count: row.count + 1 }).eq("ip", ip);
  return false;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

  if (await isRateLimited(ip)) {
    return new Response(JSON.stringify({ error: "too many requests" }), {
      status: 429,
      headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": "60" },
    });
  }

  const url = new URL(req.url);
  const q = url.searchParams.get("q");
  const limit = url.searchParams.get("limit") || "5";

  if (!q) {
    return new Response(JSON.stringify({ error: "missing q param" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const nominatimUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=${limit}&countrycodes=cr`;

  try {
    const res = await fetch(nominatimUrl, {
      headers: { "User-Agent": "BuxiApp/1.0 (contacto@buxi.cr)" },
    });
    const data = await res.json();
    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (_err) {
    return new Response(JSON.stringify([]), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
