/**
 * GeoJSON overlays (proxy/js/overlay.mjs). The module is imported in the page, as ui.js gets it, so
 * the served files are tested too.
 */

const view = '9.88/52.5134/13.4024'

// a module of the page, imported there
const pageImport = specifier => cy.window().then(win => win.eval(`import('${specifier}')`))
const overlayModule = () => pageImport('/js/overlay.mjs')

// ui.js's map once its style has loaded (ui.js's `map` is a global binding, not a window property)
const loadedMap = (check = 'true') => cy.window({timeout: 30000})
  .should(win => {
    expect(win.eval(`typeof map.getStyle === 'function' && !!map.getStyle()?.layers?.length && (${check})`)).to.equal(true)
  })
  .then(win => win.eval('map'))

// a small style: tile layers of two vector sources, and a GeoJSON source
const tiles = {type: 'vector', url: 'https://example.com/tiles.json', promoteId: 'id'}
const style = () => ({
  version: 8,
  sources: {
    tiles,
    labels: {type: 'vector', url: 'https://example.com/labels.json'},
    markers: {type: 'geojson', data: {type: 'FeatureCollection', features: []}},
  },
  layers: [
    {id: 'background', type: 'background'},
    {id: 'track', type: 'line', source: 'tiles', 'source-layer': 'tracks', filter: ['==', ['get', 'state'], 'present']},
    {id: 'track_proposed', type: 'line', source: 'tiles', 'source-layer': 'tracks', filter: ['==', ['get', 'state'], 'proposed']},
    {id: 'platform', type: 'fill', source: 'tiles', 'source-layer': 'platforms'},
    {id: 'station', type: 'symbol', source: 'labels', 'source-layer': 'stations'},
    {id: 'marker', type: 'circle', source: 'markers'},
  ],
})

const track = {
  type: 'Feature',
  properties: {state: 'present', usage: 'main'},
  geometry: {type: 'LineString', coordinates: [[13.40, 52.51], [13.41, 52.52]]},
}
const removal = id => ({type: 'Feature', id, properties: null, geometry: null})
const collection = features => ({type: 'FeatureCollection', features})

// a style with the overlay in it
const withOverlay = (overlay, data, options) => overlay.parse(JSON.stringify(data)).then(parsed => {
  const result = style()
  overlay.addToStyle(result, parsed, options)
  return result
})

describe('overlay module', () => {
  beforeEach(() => {
    cy.visit(`/#view=${view}`)
    loadedMap()
  })

  it('the overlay survives its base64 form, gzipped or plain', () => {
    const data = {tracks: {added: collection([track]), removed: collection([removal(1)])}}
    overlayModule().then(async overlay => {
      expect(await overlay.load(await overlay.encodeBase64(data))).to.deep.equal(data)
      expect(await overlay.load(btoa(JSON.stringify(data)))).to.deep.equal(data)
    })
  })

  it('load gives null without an overlay or for a broken one', () => {
    overlayModule().then(async overlay => {
      expect(await overlay.load(null)).to.equal(null)
      expect(await overlay.load('not base64!')).to.equal(null)
      expect(await overlay.load(btoa('{"tracks": {"added": {"features": {}}}}'))).to.equal(null)
    })
  })

  it('parse rejects what the overlay cannot use', () => {
    overlayModule().then(async overlay => {
      for (const bad of [
        'not json',
        '[]',
        // a FeatureCollection not keyed by tile layer
        '{"type": "FeatureCollection", "features": []}',
        '{"tracks": []}',
        '{"tracks": {"added": []}}',
        '{"tracks": {"added": {"type": "FeatureCollection"}}}',
        '{"tracks": {"added": {"type": "FeatureCollection", "features": [null]}}}',
        '{"tracks": {"removed": {"type": "FeatureCollection", "features": [null]}}}',
        // removed features without ids, or with ids not all numbers or all strings
        '{"tracks": {"removed": {"type": "FeatureCollection", "features": [{"type": "Feature"}]}}}',
        '{"tracks": {"removed": {"type": "FeatureCollection", "features": [{"type": "Feature", "id": 1}, {"type": "Feature", "id": "2"}]}}}',
        '{"tracks": {"removed": {"type": "FeatureCollection", "features": [{"type": "Feature", "id": -1}]}}}',
      ]) {
        const rejected = await overlay.parse(bad).then(() => false, () => true)
        expect(rejected, bad).to.equal(true)
      }
    })
  })

  it('a source drawing a tile layer the overlay changes is patched with the source combinators', () => {
    overlayModule().then(overlay => withOverlay(overlay, {
      tracks: {added: collection([track]), removed: collection([removal(1)])},
      platforms: {removed: collection([removal(7)])},
    }).then(result => {
      // marked as added, and with the property the source promotes to feature ids, for hover
      const added = {...track, properties: {...track.properties, 'overlay:added': true, id: 'overlay-tracks-0'}}
      expect(result.sources.tiles).to.deep.equal({
        type: 'union',
        sources: [
          {
            type: 'difference',
            source: tiles,
            subtract: {type: 'geojson-layers', data: {tracks: collection([removal(1)]), platforms: collection([removal(7)])}},
            key: {tracks: ['id'], platforms: ['id']},
          },
          {type: 'geojson-layers', data: {tracks: collection([added])}},
        ],
        promoteId: 'id',
        attribution: undefined,
      })
      expect(overlay.isAdded(added)).to.equal(true)
      expect(overlay.isAdded(track)).to.equal(false)
      // the style's layers are left alone, and so are the sources the overlay does not change
      expect(result.layers).to.deep.equal(style().layers)
      expect(result.sources.labels).to.deep.equal(style().sources.labels)
      expect(result.sources.markers).to.deep.equal(style().sources.markers)
    }))
  })

  it('a source the overlay only adds to, or only removes from, gets only the combinator it needs', () => {
    overlayModule().then(overlay => withOverlay(overlay, {tracks: {added: collection([track])}, stations: {removed: collection([removal('node-1')])}}).then(result => {
      expect(result.sources.tiles.type).to.equal('union')
      expect(result.sources.tiles.sources[0]).to.deep.equal(tiles)
      expect(result.sources.labels).to.deep.equal({
        type: 'difference',
        source: style().sources.labels,
        subtract: {type: 'geojson-layers', data: {stations: collection([removal('node-1')])}},
        key: {stations: ['id']},
        promoteId: undefined,
        attribution: undefined,
      })
    }))
  })

  it('an added feature keeps an id of its own, and a source without promoted ids gets none', () => {
    const station = {type: 'Feature', properties: {name: 'New station'}, geometry: {type: 'Point', coordinates: [13.40, 52.51]}}
    overlayModule().then(overlay => withOverlay(overlay, {
      tracks: {added: collection([{...track, properties: {...track.properties, id: 'new-1'}}])},
      stations: {added: collection([station])},
    }).then(result => {
      expect(result.sources.tiles.sources[1].data.tracks.features[0].properties.id).to.equal('new-1')
      expect(result.sources.labels.sources[1].data.stations.features[0].properties).to.deep.equal({name: 'New station', 'overlay:added': true})
      expect(overlay.isPatched(result.sources.tiles)).to.equal(true)
      expect(overlay.isPatched(result.sources.markers)).to.equal(false)
    }))
  })

  it('removed features can be identified by another id than the feature id', () => {
    const featureId = sourceLayer => sourceLayer === 'tracks' ? ['to-number', ['get', 'way']] : ['id']
    overlayModule().then(overlay => withOverlay(overlay, {tracks: {removed: collection([removal(123)])}}, {featureId}).then(result => {
      expect(result.sources.tiles.key).to.deep.equal({tracks: ['to-number', ['get', 'way']]})
    }))
  })
})

describe('overlay on the map', () => {
  const data = {
    railway_line_high: {
      added: {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          properties: {feature: 'rail', state: 'present', usage: 'main', name: 'New line'},
          geometry: {type: 'LineString', coordinates: [[13.40, 52.51], [13.41, 52.52]]},
        }],
      },
      removed: {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          id: 123456,
          properties: {feature: 'rail', state: 'present', usage: 'main'},
          geometry: {type: 'LineString', coordinates: [[13.40, 52.51], [13.42, 52.52]]},
        }],
      },
    },
  }

  // the overlay patches the sources of the tracks, and its added track is drawn
  const overlayDrawn = "Object.values(map.getStyle().sources).some(source => source.type === 'union') && map.queryRenderedFeatures().some(feature => overlay.isAdded(feature))"

  const expectOverlayIn = map => {
    const patched = Object.values(map.getStyle().sources).filter(source => source.type === 'union')
    expect(patched.length).to.be.greaterThan(0)
    patched.forEach(source => {
      // the removed way is subtracted from the tracks, by way
      expect(source.sources[0].type).to.equal('difference')
      expect(source.sources[0].subtract.data.railway_line_high.features.map(feature => feature.id)).to.deep.equal([123456])
      expect(source.sources[0].key.railway_line_high[0]).to.equal('to-number')
    })
  }

  it('an overlay in the link is drawn', () => {
    cy.visit(`/#view=${view}`)
    loadedMap()
    overlayModule().then(overlay => overlay.encodeBase64(data)).then(base64 => {
      cy.visit(`/#view=${view}&overlay-base64=${encodeURIComponent(base64)}`)
      cy.reload()
      loadedMap(overlayDrawn).then(expectOverlayIn)
    })
  })

  it('a patched source follows the language setting', () => {
    // the station labels are the tiles that are localized
    const localized = {...data, standard_railway_text_stations: {removed: collection([removal('node-1')])}}
    // the URLs of the vector sources a patched source is made of, as an expression for the page
    const innerUrls = "(function innerUrls(source) { return source.type === 'vector' ? [source.url] : (source.sources ?? [source.source, source.subtract]).filter(Boolean).flatMap(innerUrls) })"
    cy.visit(`/#view=${view}`)
    loadedMap()
    overlayModule().then(overlay => overlay.encodeBase64(localized)).then(base64 => {
      cy.visit(`/#view=${view}&overlay-base64=${encodeURIComponent(base64)}`)
      cy.reload()
      loadedMap(overlayDrawn)
      cy.window().then(win => win.eval("customLocalization('fr')"))
      loadedMap(`Object.values(map.getStyle().sources).filter(source => overlay.isPatched(source)).flatMap(${innerUrls}).some(url => url.includes('lang=fr'))`)
    })
  })

  it('an overlay pasted into the configuration is drawn and put in the link', () => {
    cy.visit(`/#view=${view}`)
    loadedMap()

    cy.get('.maplibregl-ctrl-configuration').click()
    cy.contains('Map configuration').should('be.visible')

    cy.get('#overlayJson').invoke('val', '{"type": "FeatureCollection"').trigger('change')
    cy.get('#overlayJson').should(field => expect(field[0].validationMessage).to.include('cannot be loaded'))
    cy.url().should('not.include', 'overlay-base64=')

    cy.get('#overlayJson').invoke('val', JSON.stringify(data)).trigger('change')
    cy.get('#overlayJson').should(field => expect(field[0].validationMessage).to.equal(''))
    cy.url().should('include', 'overlay-base64=')
    loadedMap(overlayDrawn).then(expectOverlayIn)

    cy.get('#overlayJson').invoke('val', '').trigger('change')
    cy.url().should('not.include', 'overlay-base64=')
  })
})
