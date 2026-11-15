-- chofer_set_ocupacion (20261115120000) es solo para choferes con sesión.
-- El "revoke from public" no alcanza: Supabase le da execute a anon por
-- defecto a cada función nueva. No podía cambiar nada (sin sesión no hay
-- bus asignado), pero no tiene por qué poder llamarse.
revoke execute on function public.chofer_set_ocupacion(uuid, text) from anon;
