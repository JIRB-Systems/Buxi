// Aprueba o rechaza una solicitud de empresa EN UN SOLO PASO, del lado del
// servidor.
//
// Antes el panel de JIRB lo hacía desde el navegador en pasos sueltos: crear
// la empresa, crear la cuenta, convertirla en admin de la empresa y marcar la
// solicitud. Si fallaba un paso a la mitad quedaba una empresa sin cuenta, o
// una cuenta de pasajero común (el error del tercer paso ni se revisaba).
// Acá, si algo falla después de crear la empresa o la cuenta, se deshace lo
// creado y la solicitud queda pendiente como estaba.
//
// Solo un admin_jirb ACTIVO puede llamarla; el que llama sale del JWT
// verificado, nunca del body.

import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
const error = (mensaje: string, status: number) => json({ error: mensaje }, status);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return error("método no permitido", 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return error("Falta la sesión", 401);

  let body: { solicitudId?: string; accion?: string; password?: string; motivo?: string };
  try { body = await req.json(); } catch { return error("Pedido inválido", 400); }
  const { solicitudId, accion, password, motivo } = body;
  if (!solicitudId || (accion !== "aprobar" && accion !== "rechazar")) {
    return error("Falta la solicitud o la acción (aprobar | rechazar)", 400);
  }
  if (accion === "aprobar" && (!password || password.length < 8)) {
    return error("La contraseña temporal necesita al menos 8 caracteres", 400);
  }

  const url = Deno.env.get("SUPABASE_URL")!;
  const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) return error("Sesión inválida", 401);

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: caller } = await admin.from("profiles").select("rol, estado").eq("id", user.id).single();
  if (!caller || caller.rol !== "admin_jirb" || (caller.estado ?? "activo") !== "activo") {
    return error("No autorizado", 403);
  }

  const { data: sol } = await admin.from("solicitudes_empresa").select("*").eq("id", solicitudId).single();
  if (!sol) return error("La solicitud no existe", 404);
  if (sol.estado !== "pendiente") return error(`La solicitud ya está ${sol.estado}`, 409);

  const log = (accionLog: string, detalle: string) =>
    admin.from("activity_logs").insert({
      user_id: user.id, accion: accionLog, detalle, entidad: "solicitud", entidad_id: sol.id,
    });

  // ---- RECHAZAR ----
  if (accion === "rechazar") {
    const { data: filas, error: e } = await admin.from("solicitudes_empresa")
      .update({ estado: "rechazada", motivo_rechazo: motivo?.trim() || null })
      .eq("id", sol.id).eq("estado", "pendiente").select("id");
    if (e) return error(e.message, 500);
    if (!filas?.length) return error("La solicitud cambió mientras tanto; recargá", 409);
    await log("Rechazar solicitud", `${sol.nombre_empresa}${motivo ? ` — ${motivo.trim()}` : ""}`);
    return json({ ok: true });
  }

  // ---- APROBAR ----
  // Validaciones antes de crear nada.
  if (sol.cedula_juridica) {
    const { data: dup } = await admin.from("empresas").select("id, nombre")
      .eq("cedula_juridica", sol.cedula_juridica).maybeSingle();
    if (dup) return error(`Ya existe una empresa con esa cédula jurídica (${dup.nombre})`, 409);
  }

  let empresaId: string | null = null;
  let userId: string | null = null;
  const deshacer = async () => {
    if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {});
    if (empresaId) await admin.from("empresas").delete().eq("id", empresaId);
  };

  try {
    const { data: emp, error: eEmp } = await admin.from("empresas").insert({
      nombre: sol.nombre_empresa,
      cedula_juridica: sol.cedula_juridica || null,
      telefono: sol.telefono || null,
      email: sol.email || null,
      logo_url: sol.logo_url || null,
      estado: "activo",
    }).select("id").single();
    if (eEmp || !emp) throw new Error(eEmp?.message || "No se pudo crear la empresa");
    empresaId = emp.id;

    const { data: creado, error: eUser } = await admin.auth.admin.createUser({
      email: sol.email,
      password,
      email_confirm: true,
      user_metadata: { nombre_completo: sol.nombre_contacto, created_by_admin: true },
    });
    if (eUser || !creado?.user) {
      const msg = eUser?.message || "";
      throw new Error(/already|registered|exists/i.test(msg)
        ? `Ya existe una cuenta con el correo ${sol.email}`
        : (msg || "No se pudo crear la cuenta"));
    }
    userId = creado.user.id;

    // El perfil lo crea un trigger al nacer la cuenta; acá se lo convierte en
    // admin de la empresa. Se verifica que la fila exista y se haya cambiado.
    const { data: perfil, error: ePerfil } = await admin.from("profiles")
      .update({ rol: "admin_empresa", empresa_id: empresaId, nombre_completo: sol.nombre_contacto })
      .eq("id", userId).select("id");
    if (ePerfil || !perfil?.length) throw new Error(ePerfil?.message || "No se pudo asignar la cuenta a la empresa");

    const { data: filas, error: eSol } = await admin.from("solicitudes_empresa")
      .update({ estado: "aprobada" }).eq("id", sol.id).eq("estado", "pendiente").select("id");
    if (eSol || !filas?.length) throw new Error(eSol?.message || "La solicitud cambió mientras tanto; recargá");
  } catch (e) {
    await deshacer();
    return error((e as Error).message, 400);
  }

  await log("Aprobar solicitud", `${sol.nombre_empresa} + cuenta ${sol.email}`);
  return json({ ok: true, empresaId, email: sol.email });
});
