# The pieces that compose.yaml wires together, as plain Nix packages. The
# NixOS module (module.nix) turns them into systemd services; they can also
# be run by hand (see README.md).
{
  pkgs,
  lib,
  src,
}:
let
  callPackage = lib.callPackageWith (pkgs // { inherit src; });
  node-deps = callPackage ./node-deps.nix { };
  generated = callPackage ./generated.nix { inherit node-deps; };
  proxy = callPackage ./proxy.nix { inherit generated; };
in
{
  inherit node-deps generated;
  orm-import = callPackage ./import.nix { inherit generated; };
  orm-martin = callPackage ./martin.nix { };
  orm-api = callPackage ./api.nix { inherit generated; };
  # static site files, and a function rendering the nginx server block
  inherit (proxy) public serverConf;
}
