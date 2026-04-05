import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.reelengine.app',
  appName: 'Reel Engine',
  webDir: 'dist',
  server: {
    // In development, point to your local server or Railway URL
    // url: 'http://localhost:5173',
    // In production, the web assets are bundled — the app talks to the backend via API_URL
    androidScheme: 'https'
  },
  ios: {
    contentInset: 'automatic'
  }
};

export default config;
