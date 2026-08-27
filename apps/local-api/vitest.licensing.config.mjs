export default {
  test: {
    fileParallelism: false,
    hookTimeout: 120_000,
    include: ["src/licensing/**/*.test.ts"],
    testTimeout: 30_000,
  },
};
