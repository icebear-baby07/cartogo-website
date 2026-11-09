import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const host = process.env.CARTOGO_SITE_HOST?.trim() || "0.0.0.0";
  return {
    plugins: [react()],
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(
        env.VITE_SUPABASE_URL ?? env.SUPABASE_URL ?? "",
      ),
      "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(
        env.VITE_SUPABASE_ANON_KEY ?? env.SUPABASE_ANON_KEY ?? "",
      ),
    },
    server: {
      host,
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": "http://127.0.0.1:3001",
      },
    },
    preview: {
      host,
      port: 4173,
      strictPort: true,
    },
  };
});
