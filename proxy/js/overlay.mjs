// GeoJSON overlays patched into a map style's sources, and their base64 form.
//
// Unlike the other modules here, which Node runs at build time, this one is
// loaded by the browser.

// the property that marks the features an overlay adds
const addedProperty = 'overlay:added';

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * The features of a FeatureCollection of the overlay, at `path`, or none if it is absent; throws an
 * error saying what is wrong if it is not one
 */
function features(collection, path) {
  if (collection === undefined) {
    return [];
  }
  if (!isObject(collection)) {
    throw new Error(`\`${path}\` is not a GeoJSON object`);
  }
  if (!Array.isArray(collection.features)) {
    throw new Error(`\`${path}\` is not a GeoJSON FeatureCollection, it has no \`features\` list`);
  }
  const invalidFeature = collection.features.findIndex(feature => !isObject(feature));
  if (invalidFeature !== -1) {
    throw new Error(`feature ${invalidFeature} of \`${path}\` is not a GeoJSON object`);
  }
  return collection.features;
}

/**
 * The overlay's data, if it has the shape the overlay needs; throws an error saying what is wrong
 * otherwise
 */
function validate(data) {
  if (!isObject(data)) {
    throw new Error('not an object of tile layers');
  }
  if (data.type === 'FeatureCollection') {
    throw new Error('a FeatureCollection, not an object of tile layers');
  }
  for (const [layer, patch] of Object.entries(data)) {
    if (!isObject(patch)) {
      throw new Error(`\`${layer}\` is not an object of \`added\` and \`removed\` features`);
    }
    features(patch.added, `${layer}.added`);
    const ids = features(patch.removed, `${layer}.removed`).map(feature => feature.id);
    const numbers = ids.every(id => Number.isInteger(id) && id >= 0);
    const strings = ids.every(id => typeof id === 'string' && id !== '');
    if (!numbers && !strings) {
      throw new Error(`the features of \`${layer}.removed\` do not all have ids, all numbers or all strings`);
    }
  }
  return data;
}

/**
 * Base64 of the gzip of the overlay's JSON text
 */
export async function encodeBase64(data) {
  const gzipped = new Blob([new TextEncoder().encode(JSON.stringify(data))]).stream().pipeThrough(new CompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(gzipped).arrayBuffer());
  return btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
}

/**
 * The validated overlay in base64 of its JSON text or of its gzip
 */
async function decodeBase64(base64) {
  const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
  const gzipped = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  const text = gzipped
    ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
    : new TextDecoder().decode(bytes);
  return validate(JSON.parse(text));
}

/**
 * decodeBase64, but null without an overlay or when it cannot be decoded (which is logged)
 */
export async function load(base64) {
  if (!base64) {
    return null;
  }
  try {
    const data = await decodeBase64(base64);
    console.info('Loaded overlay');
    return data;
  } catch (error) {
    console.error('Error during loading of overlay', error);
    return null;
  }
}

/**
 * The validated overlay in its JSON text; throws an error saying what is wrong otherwise
 */
export async function parse(text) {
  return validate(JSON.parse(text));
}

/**
 * Puts the overlay (validated data) into a style object.
 *
 * The overlay is keyed by tile layer (`source-layer`). Each vector source whose style layers draw a
 * tile layer the overlay changes is replaced by the source patched, with the source combinators of
 * MapLibre GL JS: its tiles less the overlay's `removed` features, and with its `added` features,
 * as `union(difference(source, removed), added)`. So the added features are drawn, hovered and
 * queried by the style's own layers as the source's own, and carry the property `isAdded` checks.
 *
 * A tile feature is removed when the id of a removed feature of its layer is the value of
 * `featureId(sourceLayer)`, an expression evaluated on the tile feature; by default its vector tile
 * feature id, `['id']`. Only the ids of removed features are used; the rest of them, a record of
 * what the overlay was made against, is not.
 */
export function addToStyle(style, data, {featureId = () => ['id']} = {}) {
  // the tile layers the style layers of each source draw
  const sourceLayers = new Map();
  for (const layer of style.layers) {
    if (layer['source-layer']) {
      sourceLayers.set(layer.source, new Set([...(sourceLayers.get(layer.source) ?? []), layer['source-layer']]));
    }
  }

  for (const [sourceId, layers] of sourceLayers) {
    const source = style.sources[sourceId];
    const patches = [...layers].filter(layer => Object.hasOwn(data, layer)).map(layer => [layer, data[layer]]);
    if (source?.type === 'vector' && patches.length > 0) {
      style.sources[sourceId] = patched(source, patches, featureId);
    }
  }
}

/**
 * A vector source patched by the patches of its tile layers
 */
function patched(source, patches, featureId) {
  const added = {};
  const removed = {};
  const keys = {};
  for (const [layer, patch] of patches) {
    const addedFeatures = features(patch.added);
    if (addedFeatures.length > 0) {
      added[layer] = {
        type: 'FeatureCollection',
        features: addedFeatures.map((feature, i) => addedFeature(feature, layer, i, source.promoteId)),
      };
    }
    if (features(patch.removed).length > 0) {
      removed[layer] = patch.removed;
      keys[layer] = featureId(layer);
    }
  }

  let result = source;
  if (Object.keys(removed).length > 0) {
    result = {type: 'difference', source: result, subtract: {type: 'geojson-layers', data: removed}, key: keys};
  }
  if (Object.keys(added).length > 0) {
    result = {type: 'union', sources: [result, {type: 'geojson-layers', data: added}]};
  }
  return result === source ? source : {...result, promoteId: source.promoteId, attribution: source.attribution};
}

/**
 * An added feature as the source holds it: marked as added, and with a value of the property the
 * source promotes to feature ids, if it has none, so that it has a feature id as tile features do
 */
function addedFeature(feature, layer, index, promoteId) {
  const idProperty = typeof promoteId === 'string' ? promoteId : promoteId?.[layer];
  const properties = {...feature.properties, [addedProperty]: true};
  if (idProperty && properties[idProperty] === undefined) {
    properties[idProperty] = `overlay-${layer}-${index}`;
  }
  return {...feature, properties};
}

/**
 * Whether a rendered feature is one an overlay added
 */
export function isAdded(feature) {
  return feature.properties?.[addedProperty] === true;
}

/**
 * Whether a style's source is one an overlay patched, which is not a vector source any more
 */
export function isPatched(source) {
  return source.type === 'union' || source.type === 'difference';
}
