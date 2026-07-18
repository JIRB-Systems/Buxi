-- La migración 20260713100000 intentó revocar EXECUTE de estas 4 funciones
-- trigger/event-trigger, pero lo hizo `from anon, authenticated`. Esos roles
-- nunca tuvieron el privilegio directamente: lo heredan de PUBLIC, al que
-- Postgres otorga EXECUTE por defecto en toda función nueva. Revocar de un
-- rol específico NO quita el privilegio heredado de PUBLIC, así que el revoke
-- anterior no tuvo efecto (has_function_privilege seguía devolviendo true).
-- Se revoca de PUBLIC, que es donde realmente vive el grant. Los triggers
-- siguen corriendo normal (no dependen del EXECUTE del rol que dispara el
-- evento; corren como SECURITY DEFINER), y postgres/service_role conservan
-- su acceso.
revoke execute on function public.handle_new_user() from public;
revoke execute on function public.flag_anomalous_location() from public;
revoke execute on function public.prevent_self_role_change() from public;
revoke execute on function public.rls_auto_enable() from public;
