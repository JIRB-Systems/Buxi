// Recibe el formulario público "Llevá tu empresa a Buxci".
//
// Antes el navegador insertaba directo en `solicitudes_empresa` con una
// política que aceptaba cualquier cosa de cualquiera: sin límite, sin
// validación y hasta con el estado que quisiera ("aprobada"). Un bot podía
// llenar la tabla de basura en un minuto. Ahora la única puerta es esta
// función, que guarda con la clave de servicio después de pasar, en orden:
//
//   1. Trampa para bots: un campo oculto que una persona nunca llena.
//   2. Tiempo mínimo: nadie completa el formulario en menos de 3 segundos.
//      Lo mide el propio navegador (cuánto estuvo abierto el formulario) y no
//      se compara con la hora del servidor: un teléfono con el reloj adelantado
//      habría quedado descartado en silencio para siempre.
//   3. Límite por IP: 5 envíos por hora.
//   4. Captcha (Cloudflare Turnstile), si el secreto TURNSTILE_SECRET está
//      configurado. Sin secreto, este paso se salta y siguen valiendo los demás.
//   5. Validación de cada campo (largo y formato).
//   6. Una sola solicitud pendiente por correo.
//
// Las dos primeras responden "ok" sin guardar nada: al bot no le conviene
// saber que lo descubrieron.
//
// El logo también entra por acá. Antes se subía desde el navegador a un balde
// sin permiso de subida, el error se tragaba y TODAS las solicitudes llegaban
// sin logo. SVG ya no se acepta: puede llevar código adentro.

import { createClient } from "jsr:@supabase/supabase-js@2";

const ORIGENES = new Set([
  "https://app.buxci.com",
  "https://buxci.com",
  "https://buxi.vercel.app",
  "https://buxi-jirb.vercel.app",
  "http://localhost:4200",
  "http://localhost:8100",
  "https://localhost",
  "capacitor://localhost",
]);

const VENTANA_MS = 60 * 60 * 1000;
const MAX_POR_VENTANA = 5;
const TIEMPO_MINIMO_MS = 3000;
const CUERPO_MAX = 3 * 1024 * 1024;
const LOGO_MAX = 2 * 1024 * 1024;

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function cors(req: Request): Record<string, string> {
  const origen = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ORIGENES.has(origen) ? origen : "https://app.buxci.com",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function responder(req: Request, status: number, cuerpo: Record<string, unknown>): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { ...cors(req), "Content-Type": "application/json" },
  });
}

// Texto limpio: sin caracteres de control y con los espacios normalizados.
function limpio(valor: FormDataEntryValue | null): string {
  if (typeof valor !== "string") return "";
  return valor.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

// El mensaje sí puede tener saltos de línea.
function limpioMultilinea(valor: FormDataEntryValue | null): string {
  if (typeof valor !== "string") return "";
  return valor.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").replace(/[ \t]+/g, " ").trim();
}

type ErrorCampo = { campo: string; error: string };

function validar(f: FormData): { datos?: Record<string, string | null>; error?: ErrorCampo } {
  const nombre_empresa = limpio(f.get("nombre_empresa"));
  const nombre_contacto = limpio(f.get("nombre_contacto"));
  const email = limpio(f.get("email")).toLowerCase();
  const telefono = limpio(f.get("telefono"));
  const cedula = limpio(f.get("cedula_juridica"));
  const mensaje = limpioMultilinea(f.get("mensaje"));

  if (nombre_empresa.length < 2 || nombre_empresa.length > 120)
    return { error: { campo: "nombre_empresa", error: "El nombre de la empresa tiene que tener entre 2 y 120 caracteres." } };
  if (nombre_contacto.length < 2 || nombre_contacto.length > 100)
    return { error: { campo: "nombre_contacto", error: "El nombre de contacto tiene que tener entre 2 y 100 caracteres." } };
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))
    return { error: { campo: "email", error: "Revisá el correo." } };
  const digitos = telefono.replace(/\D/g, "");
  if (!/^[+\d\s()-]+$/.test(telefono) || digitos.length < 8 || digitos.length > 15)
    return { error: { campo: "telefono", error: "Revisá el teléfono: tiene que tener entre 8 y 15 números." } };
  if (cedula && (cedula.length > 20 || !/^[\d-]+$/.test(cedula)))
    return { error: { campo: "cedula_juridica", error: "La cédula jurídica solo lleva números y guiones." } };
  if (mensaje.length > 1000)
    return { error: { campo: "mensaje", error: "El mensaje puede tener hasta 1000 caracteres." } };

  return {
    datos: {
      nombre_empresa,
      nombre_contacto,
      email,
      telefono,
      cedula_juridica: cedula || null,
      mensaje: mensaje || null,
    },
  };
}

async function excedeLimite(ip: string): Promise<boolean> {
  const ahora = new Date();
  const { data: fila } = await supabase
    .from("solicitud_rate_limit")
    .select("window_start, count")
    .eq("ip", ip)
    .maybeSingle();

  if (!fila || ahora.getTime() - new Date(fila.window_start).getTime() > VENTANA_MS) {
    await supabase.from("solicitud_rate_limit")
      .upsert({ ip, window_start: ahora.toISOString(), count: 1 });
    return false;
  }
  if (fila.count >= MAX_POR_VENTANA) return true;
  await supabase.from("solicitud_rate_limit").update({ count: fila.count + 1 }).eq("ip", ip);
  return false;
}

async function captchaValido(token: string, ip: string, secreto: string): Promise<boolean> {
  if (!token) return false;
  const cuerpo = new URLSearchParams({ secret: secreto, response: token });
  if (ip !== "desconocida") cuerpo.set("remoteip", ip);
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: cuerpo,
    });
    const r = await res.json();
    return r?.success === true;
  } catch {
    return false;
  }
}

// El tipo de archivo se confirma mirando los primeros bytes, no solo lo que
// dice el navegador, que se puede falsear.
const FIRMAS: { tipo: string; ext: string; es: (b: Uint8Array) => boolean }[] = [
  { tipo: "image/png", ext: "png", es: b => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { tipo: "image/jpeg", ext: "jpg", es: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    tipo: "image/webp", ext: "webp",
    es: b => String.fromCharCode(b[0], b[1], b[2], b[3]) === "RIFF" &&
      String.fromCharCode(b[8], b[9], b[10], b[11]) === "WEBP",
  },
];

async function subirLogo(archivo: File): Promise<{ url?: string; error?: string }> {
  if (archivo.size > LOGO_MAX) return { error: "El logo puede pesar hasta 2 MB." };
  const bytes = new Uint8Array(await archivo.arrayBuffer());
  const firma = FIRMAS.find(f => f.es(bytes));
  if (!firma) return { error: "El logo tiene que ser PNG, JPG o WebP." };

  const ruta = `solicitudes/${crypto.randomUUID()}.${firma.ext}`;
  const { error } = await supabase.storage.from("logos")
    .upload(ruta, bytes, { contentType: firma.tipo, upsert: false });
  if (error) return { error: "No pudimos guardar el logo. Probá sin logo o con otra imagen." };
  return { url: supabase.storage.from("logos").getPublicUrl(ruta).data.publicUrl };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return responder(req, 405, { error: "Método no permitido." });

  const largo = Number(req.headers.get("content-length") || "0");
  if (largo > CUERPO_MAX) return responder(req, 413, { error: "El envío es demasiado grande." });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return responder(req, 400, { error: "No pudimos leer el formulario." });
  }

  // 1 y 2: trampa y tiempo mínimo. "Ok" sin guardar nada.
  if (limpio(form.get("sitio_web"))) return responder(req, 200, { ok: true });
  const tiempoMs = Number(form.get("tiempo_ms"));
  if (!Number.isFinite(tiempoMs) || tiempoMs < TIEMPO_MINIMO_MS) {
    return responder(req, 200, { ok: true });
  }

  // 3: límite por IP.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "desconocida";
  if (await excedeLimite(ip)) {
    return responder(req, 429, { error: "Recibimos varias solicitudes desde tu conexión. Probá de nuevo en una hora." });
  }

  // 4: captcha, si está configurado.
  const secreto = Deno.env.get("TURNSTILE_SECRET");
  if (secreto) {
    const token = limpio(form.get("cf-turnstile-response"));
    if (!(await captchaValido(token, ip, secreto))) {
      return responder(req, 400, { campo: "captcha", error: "No pudimos verificar que sos una persona. Probá de nuevo." });
    }
  }

  // 5: validación.
  const { datos, error } = validar(form);
  if (!datos) return responder(req, 400, { ...error });

  // 6: una sola pendiente por correo.
  const { count } = await supabase.from("solicitudes_empresa")
    .select("id", { count: "exact", head: true })
    .eq("estado", "pendiente")
    // eq y no ilike: en un LIKE el "_" de un correo es comodín. Los correos
    // se guardan en minúscula, así que la comparación exacta alcanza.
    .eq("email", datos.email!);
  if ((count ?? 0) > 0) {
    return responder(req, 409, { campo: "email", error: "Ya tenemos una solicitud pendiente con ese correo. Te vamos a contactar pronto." });
  }

  let logo_url: string | null = null;
  const logo = form.get("logo");
  if (logo instanceof File && logo.size > 0) {
    const r = await subirLogo(logo);
    if (r.error) return responder(req, 400, { campo: "logo", error: r.error });
    logo_url = r.url!;
  }

  const { error: errInsert } = await supabase.from("solicitudes_empresa")
    .insert({ ...datos, logo_url, estado: "pendiente" });
  if (errInsert) return responder(req, 500, { error: "No pudimos guardar la solicitud. Intentá de nuevo." });

  return responder(req, 201, { ok: true });
});
