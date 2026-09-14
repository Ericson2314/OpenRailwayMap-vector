#!/usr/bin/env bash
# Refresh the recorded www.wikidata.org responses that the NixOS VM test
# (nix/checks.nix) serves to the API instead of the real site. Run this when
# the Wikidata/Wikimedia assertions in api/test/api.hurl are updated, then
# commit the changed JSON files.
set -euo pipefail
cd "$(dirname "$0")"

fetch() {
  curl -fsSL -H 'accept: application/json' -o "$1" "$2"
}

# WikidataAPI.wikidata_image_file: P18 statements of the item
fetch statements-Q660045.json \
  'https://www.wikidata.org/w/rest.php/wikibase/v1/entities/items/Q660045/statements?property=P18'

# WikidataAPI.wikimedia_file_attribution: extmetadata of the two files
fetch imageinfo-ostkreuz.json \
  'https://www.wikidata.org/w/api.php?action=query&prop=imageinfo&iiprop=extmetadata&titles=File%3A2012-03-06_Berlin_Ostkreuz_vom_Treptower.jpg&format=json'
fetch imageinfo-wuhletal.json \
  'https://www.wikidata.org/w/api.php?action=query&prop=imageinfo&iiprop=extmetadata&titles=File%3AU-Bahnhof%20Wuhletal.jpg&format=json'
