export {};

const startedAt = Date.now();
const { main } = await import("./cli.ts");
process.exitCode = await main(process.argv.slice(2), startedAt);
