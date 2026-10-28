import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        globals: true,
        root: "./",
        include: ["./test/**/*.spec.ts"],
        testTimeout: 30_000,
        hookTimeout: 30_000,
    },
});
