# `nix flake check`: what the old GitHub workflow did with containers.
{
  pkgs,
  lib,
  src,
  orm,
  nixosModule,
}:
let
  # A dated Geofabrik extract so the test is reproducible. The test suites
  # assert on current Berlin data, so bump the date together with them
  # (Geofabrik keeps dated files for a limited time).
  berlin = pkgs.fetchurl {
    url = "https://download.geofabrik.de/europe/germany/berlin-260913.osm.pbf";
    hash = "sha256-gGgw9qeHbnUP9EqEJ+2IiC12pP88V3s+AmsJS9obt6Y=";
  };
  # The API's /wikidata and /wikimedia endpoints call www.wikidata.org, which
  # the sandboxed test container cannot reach. The responses the test suite depends
  # on are checked in under nix/test/wikidata (refresh them with the update
  # script there) and served inside the container by a plain-HTTP nginx virtual host
  # that the API is pointed at with WIKIDATA_BASE_URL (see below).
  wikidata = "${src}/nix/test/wikidata";
  wikidataPort = 8081;
in
{
  # import/Dockerfile's `test` stage: the Lua tag logic against the generated tables
  import-test =
    pkgs.runCommand "openrailwaymap-import-test" { nativeBuildInputs = [ pkgs.lua5_4 ]; }
      ''
        cp -r ${src}/import/test test
        cp ${src}/import/openrailwaymap.lua ${orm.generated}/tags.lua .
        lua test/test_all.lua
        touch $out
      '';

  # features/test/test.sh: every features/*.yaml against its JSON schema
  feature-test =
    pkgs.runCommand "openrailwaymap-feature-test" { nativeBuildInputs = [ pkgs.check-jsonschema ]; }
      ''
        cd ${src}/features
        for file in *.yaml; do
          check-jsonschema --schemafile "schema/$file" "$file"
        done
        touch $out
      '';

  formatting =
    (pkgs.treefmt.withConfig {
      runtimeInputs = [ pkgs.gitMinimal ];
      settings.formatter.nixfmt = {
        command = lib.getExe pkgs.nixfmt;
        includes = [ "*.nix" ];
      };
    }).check
      src;

  # The whole stack in a NixOS systemd-nspawn container with the Berlin
  # extract, then the API and proxy test suites against it, as the old
  # workflow did with Compose.
  container-test = pkgs.testers.runNixOSTest {
    name = "openrailwaymap";
    containers.machine = {
      imports = [ nixosModule ];
      services.openrailwaymap = {
        enable = true;
        osmFile = berlin;
        nginxCacheTtl = 0;
        clientCacheTtl = lib.genAttrs [
          "assetsFresh"
          "assetsStale"
          "apiFresh"
          "apiStale"
          "tilesFresh"
          "tilesStale"
        ] (_: 0);
        update.enable = false;
      };
      environment.systemPackages = [ pkgs.hurl ];

      # a stand-in for www.wikidata.org serving the recorded responses
      systemd.services.openrailwaymap-api.environment.WIKIDATA_BASE_URL =
        "http://127.0.0.1:${toString wikidataPort}";
      services.nginx.appendHttpConfig = ''
        map $arg_titles $wikidata_imageinfo {
          ~Ostkreuz ${wikidata}/imageinfo-ostkreuz.json;
          ~Wuhletal ${wikidata}/imageinfo-wuhletal.json;
          default "";
        }
      '';
      services.nginx.virtualHosts."wikidata-stub" = {
        listen = [
          {
            addr = "127.0.0.1";
            port = wikidataPort;
          }
        ];
        locations = {
          "= /w/rest.php/wikibase/v1/entities/items/Q660045/statements".alias =
            "${wikidata}/statements-Q660045.json";
          "~ ^/w/rest.php/wikibase/v1/entities/items/".return = "400";
          "= /w/api.php".extraConfig = ''
            if ($wikidata_imageinfo = "") { return 404; }
            default_type application/json;
            alias $wikidata_imageinfo;
          '';
        };
        extraConfig = "default_type application/json;";
      };
    };
    testScript = ''
      machine.wait_for_unit("openrailwaymap-import.service", timeout=1800)
      machine.wait_for_unit("openrailwaymap-martin.service")
      machine.wait_for_unit("openrailwaymap-api.service")
      machine.wait_for_unit("nginx.service")
      machine.wait_for_open_port(3001)
      machine.wait_for_open_port(5002)
      machine.wait_for_open_port(8000)
      machine.succeed("hurl --test --variable base_url=http://127.0.0.1:5002/api ${src}/api/test/api.hurl")
      machine.succeed("hurl --test --variable base_url=http://127.0.0.1:8000 ${src}/proxy/test/proxy.hurl")
    '';
  };
}
