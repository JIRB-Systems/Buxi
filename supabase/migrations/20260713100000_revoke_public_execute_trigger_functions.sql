-- El linter de seguridad marca 6 funciones SECURITY DEFINER como invocables
-- por anon/authenticated via /rest/v1/rpc/<nombre>. Se revisó cada una:
--
-- get_my_role() y get_my_empresa_id() se dejan intactas a propósito: las usan
-- constantemente las policies de RLS que corren en contexto `authenticated`
-- (chofer enviando ubicación, admin_empresa gestionando su staff, etc.).
-- Revocar EXECUTE ahí rompería esas policies. El riesgo de dejarlas
-- invocables directo es mínimo: solo devuelven el rol/empresa del propio
-- usuario que llama, el mismo dato que ya puede leer de su fila en profiles.
--
-- Las otras 4 SÍ se revocan: son funciones de trigger (handle_new_user,
-- flag_anomalous_location, prevent_self_role_change) o de event trigger
-- (rls_auto_enable, inyectada por la plataforma de Supabase). Postgres ya
-- impide invocarlas directo como RPC (solo corren en su contexto de
-- trigger/event trigger) - la revocación es limpieza sin riesgo funcional.
revoke execute on function public.handle_new_user() from anon, authenticated;
revoke execute on function public.flag_anomalous_location() from anon, authenticated;
revoke execute on function public.prevent_self_role_change() from anon, authenticated;
revoke execute on function public.rls_auto_enable() from anon, authenticated;
