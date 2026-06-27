import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // host: true → tüm ağ arayüzlerine bağlanır, başka cihazlardan LAN IP ile erişilir.
  server: { host: true, port: 5173, open: true },
  preview: { host: true, port: 4173 },
});
