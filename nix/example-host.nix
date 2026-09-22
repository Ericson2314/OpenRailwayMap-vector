# Example host configuration shared by the dev container and the image:
# the US Northeast extract (New York, New Jersey, Connecticut and the rest of the region), site on port 8000. Copy and adjust for production
# (publicHost/publicProtocol, TLS in front of nginx, a bigger extract).
{ ... }:
{
  services.openrailwaymap = {
    enable = true;
    osmDownloadUrl = "https://download.geofabrik.de/north-america/us-northeast-latest.osm.pbf";
    openFirewall = true;
    # development: never serve stale tiles or TileJSON
    nginxCacheTtl = 0;
    clientCacheTtl = {
      assetsFresh = 0;
      assetsStale = 0;
      apiFresh = 0;
      apiStale = 0;
      tilesFresh = 0;
      tilesStale = 0;
    };
  };
  system.stateVersion = "25.11";
}
