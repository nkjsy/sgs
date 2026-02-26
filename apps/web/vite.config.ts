import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@sgs/core": resolve(__dirname, "../../packages/core/src")
    }
  }
});
