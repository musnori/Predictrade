import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 5173 },
  build: {
    rollupOptions: {
      input: {
        index: "index.html",
        create: "create.html",
        event: "event.html",
        dashboard: "dashboard.html",
      },
    },
  },
});
