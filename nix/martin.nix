# The Martin tile server with the repo's function-source config and the
# symbol sprites, exactly as martin.Dockerfile runs it.
{
  writeShellApplication,
  martin,
  src,
}:
writeShellApplication {
  name = "orm-martin";
  runtimeInputs = [ martin ];
  text = ''
    export DATABASE_URL="''${DATABASE_URL:-postgresql://postgres@''${PGHOST:-localhost}:''${PGPORT:-5433}/gis}"
    export POSTGRES_RELOAD_INTERVAL="''${POSTGRES_RELOAD_INTERVAL:-10s}"
    exec martin --config ${src}/martin/configuration.yml --sprite ${src}/symbols \
      --listen-addresses "''${MARTIN_LISTEN:-127.0.0.1:3001}" "$@"
  '';
}
