// Calcul des regroupements de sites (Supercluster) hors du fil principal : l'interface reste fluide
// pendant la construction de l'index (plusieurs dizaines de milliers de points).
importScripts('../vendor/supercluster.min.js');

let index = null;

self.onmessage = ({ data: m }) => {
  if (m.type === 'charger') {
    const n = m.lat.length, pts = new Array(n);
    for (let i = 0; i < n; i++) pts[i] = { type: 'Feature', geometry: { type: 'Point', coordinates: [m.lng[i], m.lat[i]] }, properties: { i, surf: m.surf[i] } };
    index = new Supercluster({ radius: 60, maxZoom: 15, minPoints: 2, map: p => ({ surf: p.surf }), reduce: (a, p) => { a.surf += p.surf; } }).load(pts);
    self.postMessage({ type: 'charge', gen: m.gen });
  } else if (m.type === 'vue') {
    if (!index) return;
    const f = index.getClusters(m.bbox, m.zoom);
    // format compact : [lng, lat, i (point) | -1, cluster_id, nb, surf]
    const out = new Float64Array(f.length * 6);
    for (let k = 0; k < f.length; k++) {
      const x = f[k], p = x.properties, o = k * 6;
      out[o] = x.geometry.coordinates[0]; out[o + 1] = x.geometry.coordinates[1];
      if (p.cluster) { out[o + 2] = -1; out[o + 3] = p.cluster_id; out[o + 4] = p.point_count; out[o + 5] = p.surf; }
      else { out[o + 2] = p.i; out[o + 3] = 0; out[o + 4] = 1; out[o + 5] = p.surf; }
    }
    self.postMessage({ type: 'vue', req: m.req, gen: m.gen, data: out }, [out.buffer]);
  } else if (m.type === 'deplier') {
    const zoom = index.getClusterExpansionZoom(m.cid);
    const feuilles = zoom > 17 ? index.getLeaves(m.cid, 300).map(f => f.properties.i) : null;
    self.postMessage({ type: 'deplier', req: m.req, zoom, feuilles });
  }
};
