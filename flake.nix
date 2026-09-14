{
  description = "OpenRailwayMap vector tiles: database, import, tile server, API and web site as NixOS services";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs =
    {
      self,
      nixpkgs,
    }:
    let
      lib = nixpkgs.lib;
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      forAll = f: lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
      src = self;
      orm = pkgs: pkgs.callPackage ./nix { inherit src; };

      # The NixOS hosts, as their modules (see nixosConfigurations).
      hosts = {
        # Development: `sudo nixos-container create orm --flake .#container-x86_64-linux`
        # on NixOS, or on any Linux with systemd and Nix
        # `sudo nix run .#nixosConfigurations.container-x86_64-linux.config.system.build.nspawn`
        container = [
          self.nixosModules.default
          ./nix/example-host.nix
          (
            { modulesPath, ... }:
            {
              imports = [
                "${modulesPath}/virtualisation/nspawn-container"
                "${modulesPath}/virtualisation/guest-networking-options.nix"
              ];
              boot.isContainer = true;
            }
          )
        ];
        # The production server (deployed by .github/workflows/deploy.yml).
        production = [
          self.nixosModules.default
          ./nix/production.nix
        ];
        # A bootable example host; build an image with e.g.
        #   nix build .#nixosConfigurations.image-x86_64-linux.config.system.build.images.qemu-efi
        # (other variants: raw-efi, amazon, digital-ocean, lxc, proxmox, ...)
        image = [
          self.nixosModules.default
          ./nix/example-host.nix
          ./nix/image.nix
        ];
      };
    in
    {
      # The building blocks: generated files, wrapper scripts, static site.
      packages = forAll (pkgs: lib.filterAttrs (_: lib.isDerivation) (orm pkgs));

      # services.openrailwaymap.* for any NixOS host: production is a normal
      # NixOS deployment with this module enabled.
      nixosModules.default = { pkgs, ... }: {
        imports = [
          (import ./nix/module.nix {
            orm = orm pkgs;
            src = self;
          })
        ];
      };

      # Every host is built for each of `systems` as `<host>-<system>`, e.g.
      # `container-aarch64-linux`.
      nixosConfigurations = lib.concatMapAttrs (
        host: modules:
        lib.listToAttrs (
          map (
            system:
            lib.nameValuePair "${host}-${system}" (
              lib.nixosSystem {
                modules = modules ++ [ { nixpkgs.hostPlatform = system; } ];
              }
            )
          ) systems
        )
      ) hosts;

      # `nix fmt`: treefmt as nixpkgs itself uses it, with only nixfmt so the
      # upstream JS/Python/YAML stay untouched.
      formatter = forAll (
        pkgs:
        pkgs.treefmt.withConfig {
          runtimeInputs = [ pkgs.gitMinimal ];
          settings.formatter.nixfmt = {
            command = lib.getExe pkgs.nixfmt;
            includes = [ "*.nix" ];
          };
        }
      );

      checks = forAll (
        pkgs:
        import ./nix/checks.nix {
          inherit pkgs src;
          inherit (pkgs) lib;
          orm = orm pkgs;
          nixosModule = self.nixosModules.default;
        }
      );

      devShells = forAll (pkgs: {
        default = pkgs.mkShell {
          packages =
            (with self.packages.${pkgs.stdenv.hostPlatform.system}; [
              orm-import
              orm-martin
              orm-api
            ])
            ++ [
              pkgs.postgresql_18
              pkgs.osmium-tool
              pkgs.osm2pgsql
              pkgs.hurl
            ];
        };
      });
    };
}
