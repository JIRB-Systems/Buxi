// Elimina o resetea la contraseña de un chofer EN NOMBRE del admin de su
// empresa (o de un admin JIRB). Igual que delete-account, el borrado real de
// auth.users necesita la service_role key, que nunca puede vivir en el
// navegador — por eso corre server-to-server acá.
//
// El id del que llama SIEMPRE se deriva del JWT verificado, nunca del body.
// El chofer objetivo sí viene en el body, pero se valida contra su propia
// fila en `profiles` (rol='chofer' y misma empresa que el que llama, salvo
// que el que llama sea admin_jirb) antes de tocar nada.

import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonError("missing authorization", 401);

  let body: { choferId?: string; action?: string; newPassword?: string };
  try {
    body = await req.json();
  } catch {
    return jsonError("invalid body", 400);
  }
  const { choferId, action, newPassword } = body;
  if (!choferId || (action !== "delete" && action !== "reset_password")) {
    return jsonError("choferId and a valid action are required", 400);
  }
  if (action === "reset_password" && (!newPassword || newPassword.length < 6)) {
    return jsonError("newPassword must be at least 6 characters", 400);
  }

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) return jsonError("invalid session", 401);

  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: callerProfile, error: callerError } = await adminClient
    .from("profiles")
    .select("rol, empresa_id")
    .eq("id", user.id)
    .single();
  if (callerError || !callerProfile) return jsonError("caller profile not found", 403);
  if (callerProfile.rol !== "admin_empresa" && callerProfile.rol !== "admin_jirb") {
    return jsonError("not authorized", 403);
  }

  const { data: target, error: targetError } = await adminClient
    .from("profiles")
    .select("rol, empresa_id")
    .eq("id", choferId)
    .single();
  if (targetError || !target) return jsonError("chofer not found", 404);
  if (target.rol !== "chofer") return jsonError("target is not a chofer", 403);
  if (callerProfile.rol === "admin_empresa" && target.empresa_id !== callerProfile.empresa_id) {
    return jsonError("not authorized for this chofer", 403);
  }

  if (action === "delete") {
    // buses.chofer_id no tiene FK a profiles/auth.users: si no se limpia acá
    // queda apuntando a un chofer que ya no existe.
    await adminClient.from("buses").update({ chofer_id: null }).eq("chofer_id", choferId);
    const { error } = await adminClient.auth.admin.deleteUser(choferId);
    if (error) return jsonError(error.message, 500);
  } else {
    const { error } = await adminClient.auth.admin.updateUserById(choferId, { password: newPassword });
    if (error) return jsonError(error.message, 500);
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
