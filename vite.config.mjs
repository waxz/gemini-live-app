import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      root: path.join(__dirname, "src"),
      build: {
        emptyOutDir: true, // also necessary
        outDir: path.join(__dirname, "dist")
      },
      // define: {
      //   'process.env.GEMINI_BASE_URL': JSON.stringify(env.GEMINI_BASE_URL),
      //   'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      // },
      server: {
        allowedHosts: true
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});