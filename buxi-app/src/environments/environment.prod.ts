export const environment = {
  production: true,
  supabaseUrl: 'https://gduxelmqqnqupimfcdeb.supabase.co',
  supabaseAnonKey: 'sb_publishable_s8kfM1PQVM125VtKlCK2uA_ZwGgA-d8',
  maptilerKey: 'amhmtiayzOfzYvqSpmlE',
  // Comercios del mapa del pasajero (Overture, ver .github/workflows/
  // comercios-mapa.yml). Si el archivo no está, el mapa usa los de MapTiler.
  comerciosUrl: 'https://gduxelmqqnqupimfcdeb.supabase.co/storage/v1/object/public/mapa/comercios-cr.pmtiles',
  // Clave pública (sitekey) de Cloudflare Turnstile para el formulario de
  // solicitud de empresa. Vacía: el captcha no se muestra y el servidor sigue
  // protegido por la trampa, el tiempo mínimo y el límite por IP.
  turnstileSiteKey: '',
};
