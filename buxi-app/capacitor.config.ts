import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'cr.buxci.app',
  appName: 'Buxci',
  webDir: 'www',
  server: {
    androidScheme: 'https',
  },
  android: {
    // Lo pide el GPS de fondo del chofer (@capacitor-community/background-
    // geolocation): con el puente nuevo, Android corta las posiciones a los
    // 5 minutos con la pantalla apagada y el bus desaparece del mapa.
    useLegacyBridge: true,
  },
};

export default config;
