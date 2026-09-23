// Drop @powerhousedao/codegen's graphql-codegen generation deps from the install;
// vetra shims codegen and defers generation to `ph generate` in the reactor-project.
const STRIP = new Set([
  "@graphql-codegen/cli",
  "@graphql-codegen/add",
  "@graphql-codegen/typescript",
  "graphql-codegen-typescript-validation-schema",
]);

function readPackage(pkg) {
  if (pkg.name === "@powerhousedao/codegen" && pkg.dependencies) {
    for (const d of STRIP) delete pkg.dependencies[d];
  }
  return pkg;
}

module.exports = { hooks: { readPackage } };
