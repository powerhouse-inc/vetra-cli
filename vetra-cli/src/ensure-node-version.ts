// Side-effecting Node version guard. Imported first in main.ts so it fails
// fast before the import graph, which relies on Node 24+ APIs/syntax.
const MIN_MAJOR = 24;

const major = Number(process.versions.node.split('.')[0]);

if (Number.isFinite(major) && major < MIN_MAJOR) {
  console.error(
    `vetra-cli requires Node.js ${MIN_MAJOR} or later; running ${process.version}. ` +
      `Upgrade Node and try again.`,
  );
  process.exit(1);
}
