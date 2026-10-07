# The npm packages of the root package.json: `yaml` and `chroma-js`, which the
# code generators in import/, proxy/js and api/ import, and the MapLibre style
# spec, which the web site serves for overlays. Node's ESM loader ignores
# NODE_PATH, so the generators are run from a directory that has this
# node_modules in it.
{
  buildNpmPackage,
  runCommand,
  src,
}:
buildNpmPackage {
  pname = "openrailwaymap-node-deps";
  version = "0.0.0";
  # only the manifest and lock file, so other changes to the tree do not
  # rebuild this
  src = runCommand "openrailwaymap-npm-manifest" { } ''
    mkdir $out
    cp ${src}/package.json ${src}/package-lock.json $out/
  '';
  npmDepsHash = "sha256-yEh++OmOPtDkBN1eger0tc+ZrzqWylAnkBOCR2rl05w=";
  dontNpmBuild = true;
  installPhase = ''
    mkdir -p $out
    cp -r node_modules $out/
  '';
}
