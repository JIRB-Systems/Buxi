// buxci.com es la portada para empresas; la app (mapa, login, paneles) vive en
// app.buxci.com. Las dos sirven el mismo build: la portada solo muestra sus
// páginas y manda todo lo demás a la app, así la sesión queda siempre en un
// solo dominio.
export const DOMINIO_APP = 'https://app.buxci.com';

const PORTADA = ['buxci.com', 'www.buxci.com'];
const RUTAS_PORTADA = ['/', '/empresas', '/legal/privacy', '/legal/terms'];

export function esPortada(host: string = location.hostname): boolean {
  return PORTADA.includes(host);
}

// ¿Esta URL del router se queda en la portada?
export function quedaEnPortada(url: string): boolean {
  const ruta = url.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  return RUTAS_PORTADA.includes(ruta);
}
