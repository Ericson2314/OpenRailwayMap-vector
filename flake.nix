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

      nixosConfigurations = {
        # Development: `sudo nixos-container create orm --flake .#container` on
        # NixOS, or on any Linux with systemd and Nix
        # `sudo nix run .#nixosConfigurations.container.config.system.build.nspawn`
        container = lib.nixosSystem {
          system = "x86_64-linux";
          modules = [
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
        };
        # A bootable example host; build an image with e.g.
        #   nix build .#nixosConfigurations.image.config.system.build.images.qemu-efi
        # (other variants: raw-efi, amazon, digital-ocean, lxc, proxmox, ...)
        # The production server (deployed by .github/workflows/deploy.yml).
        production = lib.nixosSystem {
          system = "x86_64-linux";
          modules = [
            self.nixosModules.default
            ./nix/production.nix
          ];
        };
        image = lib.nixosSystem {
          system = "x86_64-linux";
          modules = [
            self.nixosModules.default
            ./nix/example-host.nix
            ./nix/image.nix
          ];
        };
      };

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
            (with self.packages.${pkgs.system}; [
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
