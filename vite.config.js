// vite.config.js
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        create: "create.html",
        dashboard: "dashboard.html",
        event: "event.html",
        history: "history.html", // ← これ追加
      },
    },
  },
});
