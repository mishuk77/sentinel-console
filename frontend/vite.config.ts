import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  define: {
    // Embed build timestamp so the UI can prove which push is live.
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
})
