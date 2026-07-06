// Proxy hacia Nominatim (OpenStreetMap) para geocodificación de lugares.
// Llamado server-to-server: evita el bloqueo de CORS que sufre el navegador
// al llamar directo a Nominatim, y permite mandar un User-Agent identificable
// como pide su política de uso.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
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
