#!/usr/bin/env python3
"""
Reprise de l'ancienne base (export Supabase de l'ébauche : sites_rows.csv + groupes_rows.csv)
→ reprise-ebauche.json, à importer dans l'appli (menu ▸ Importer des sites).

Usage : python3 reprise-ebauche.py sites_rows.csv groupes_rows.csv reprise-ebauche.json [communes.geojson]

Exclus : outre-mer, établissements La Poste (SIREN 356000000 : bureaux de poste ; les plateformes
reviendront via l'import open data avec leur vraie surface).
Sites sans coordonnées : position retrouvée (1) via un autre site de l'ancienne base à la même adresse,
(2) sinon au centre de la commune (communes.geojson de github.com/gregoiredavid/france-geojson), (3) sinon laissés tels quels.
"""
import csv, json, re, sys, unicodedata, uuid

NS = uuid.UUID('6f1c1d1e-2b1a-4c3e-9a55-0b16b1e5a001')          # identifiants stables (ré-import sans doublon)
uid = lambda k: str(uuid.uuid5(NS, k))

def norm(s):
    s = unicodedata.normalize('NFD', s or '').encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]', '', s)

def titre(s):
    return re.sub(r"(^|[\s\-'’(/])([a-zà-ÿ])", lambda m: m.group(1) + m.group(2).upper(), (s or '').lower())

def dept_de_cp(cp):
    if not re.fullmatch(r'\d{5}', cp or ''): return None
    if cp.startswith('20'): return '2A' if cp < '20200' else '2B'
    if cp[:2] in ('97', '98'): return cp[:3]
    return cp[:2]

sites_csv, groupes_csv, sortie = sys.argv[1:4]
communes_geojson = sys.argv[4] if len(sys.argv) > 4 else None
sites = list(csv.DictReader(open(sites_csv, encoding='utf-8')))
gr_rows = list(csv.DictReader(open(groupes_csv, encoding='utf-8')))

# ---------------------------------------------------------------- groupes
groupes = {}                                   # clé normalisée → {id, nom}
def groupe(nom):
    k = norm(nom)
    if not k: return None
    if k not in groupes: groupes[k] = {'id': uid('groupe:' + k), 'nom': nom}
    elif nom != nom.upper() and groupes[k]['nom'] == groupes[k]['nom'].upper(): groupes[k]['nom'] = nom   # préfère la casse soignée
    return groupes[k]['id']

par_siren = {}
for g in gr_rows: par_siren[g['siren']] = g['groupe']; groupe(g['groupe'])
alias = {}
for g in list(groupes.values()):
    alias[norm(g['nom'])] = g['nom']
    for part in g['nom'].split(' / '): alias.setdefault(norm(part), g['nom'])
alias.update({norm(k): v for k, v in {
    'La Poste / DPD': 'La Poste', 'Sysco': 'Pomona / Sysco', 'FM': 'FM Logistic', 'Pernod Ricard': 'Pernod Ricard',
}.items()})
# premiers mots de raison sociale qui sont de vrais groupes (les autres — LA, TRANSPORTS, SARL… — sont ignorés)
GROUPES_MAJ = {'CHAUSSON': 'Chausson Matériaux', 'PERRENOT': 'Perrenot', 'SAMSE': 'Samse', 'GXO': 'GXO Logistics', 'GEDIMAT': 'Gedimat',
               'CIFFREO': 'Ciffréo Bona', 'BIGMAT': 'BigMat', 'SOFRILOG': 'Sofrilog', 'QUEGUINER': 'Quéguiner', 'NEOLOG': 'Néolog',
               'PRIMEVER': 'Primever', 'KNAUF': 'Knauf', 'CEVA': 'CEVA Logistics', 'MEDIACO': 'Mediaco', 'LARIVIERE': 'Larivière',
               'OLANO': 'Olano', 'STG': 'STG', 'GCA': 'Groupe GCA', 'VM': 'VM Matériaux', 'COMAFRANC': 'Comafranc', 'FRANS': 'Frans Bonhomme'}

def groupe_du_site(r):
    siren = r['siret'][:9]
    if siren in par_siren: return groupe(par_siren[siren])
    v = (r['groupe'] or '').strip()
    if not v: return None
    if norm(v) in alias: return groupe(alias[norm(v)])
    if r['source'] in ('manuel', 'excel'): return groupe(v if v != v.upper() else titre(v))
    if v != v.upper(): return groupe(v)                       # noms soignés de l'ancienne appli
    if v in GROUPES_MAJ: return groupe(GROUPES_MAJ[v])
    return None

# ---------------------------------------------------------------- exclusions
def outre_mer(r):
    cp = (r['cp'] or '').strip()
    return cp[:2] in ('97', '98') or (r['dept'] or '') in ('97', '98') or len(r['dept'] or '') == 3 or re.search(r'\b97\d{3}\b', r['adresse'] or '')
LA_POSTE = '356000000'
avant = len(sites)
exclus = {'outre_mer': sum(1 for r in sites if outre_mer(r)), 'la_poste': sum(1 for r in sites if r['siret'][:9] == LA_POSTE and not outre_mer(r))}
sites = [r for r in sites if not outre_mer(r) and r['siret'][:9] != LA_POSTE]

# ---------------------------------------------------------------- positions manquantes
RENOMMEES = {'thaonlesvosges': 'capavenirvosges', 'herblaysurseine': 'herblay'}
def norm_ville(v):
    v = re.sub(r'\b(CEDEX\s*\d*|\d+\s*(E|EME|ER)\b)', ' ', (v or '').upper()).strip()
    v = re.sub(r"^(LE|LA|LES)\s+|^L[’']\s*", '', v)          # le fichier des communes n'a pas les articles (« Blanc » pour Le Blanc)
    v = norm(v); v = RENOMMEES.get(v, v)
    return re.sub(r'^ste(?=[a-z])', 'sainte', re.sub(r'^st(?=[a-z])', 'saint', v))
def norm_adr(a):
    return norm(re.sub(r'\s+\d{5}\s+.*$', '', a or ''))
geo = {'adresse': 0, 'commune': 0, 'aucune': 0}
manquants = [r for r in sites if not r['lat']]
if manquants:
    par_adr = {}
    for r in sites:
        if r['lat'] and norm_adr(r['adresse']) and len(norm_adr(r['adresse'])) > 8:
            par_adr.setdefault((norm_adr(r['adresse']), norm_ville(r['ville'])), (r['lat'], r['lng']))
    communes = {}
    if communes_geojson:
        for f in json.load(open(communes_geojson, encoding='utf-8'))['features']:
            code, g = f['properties']['code'], f['geometry']
            if not g: continue
            polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
            best = None
            for poly in polys:
                ring = poly[0]; a = cx = cy = 0
                for i in range(len(ring) - 1):
                    (x0, y0), (x1, y1) = ring[i][:2], ring[i + 1][:2]
                    k = x0 * y1 - x1 * y0; a += k; cx += (x0 + x1) * k; cy += (y0 + y1) * k
                if a and (best is None or abs(a) > best[0]): best = (abs(a), cx / (3 * a), cy / (3 * a))
            if best:
                dep = code[:3] if code.startswith('97') else code[:2]
                communes.setdefault((dep, norm_ville(f['properties']['nom'])), (round(best[2], 6), round(best[1], 6)))
        par_nom = {}
        for (dep, nom), pos in communes.items(): par_nom.setdefault(nom, []).append(pos)
    for r in manquants:
        cle = (norm_adr(r['adresse']), norm_ville(r['ville']))
        mv = re.search(r'\b(\d{5})\s+([^\d].*)$', r['ville'] or '')
        if mv and not r['cp']:
            prefixe = (r['ville'][:mv.start()]).strip(' -')
            r['cp'], r['ville'] = mv.group(1), mv.group(2)
            if not r['adresse'] and prefixe: r['adresse'] = prefixe
        dep = dept_de_cp((r['cp'] or '').strip()) or (r['dept'] if re.fullmatch(r'\d\d|2A|2B', r['dept'] or '') else None)
        if dep == '20': dep = None
        pos, precision = None, None
        if cle in par_adr: pos, precision = par_adr[cle], 'adresse'
        elif communes:
            v = norm_ville(r['ville'])
            if dep and (dep, v) in communes: pos, precision = communes[(dep, v)], 'commune'
            elif not dep and len(par_nom.get(v, [])) == 1 and r['dept'] not in ('na', 'DE', 'KY'): pos, precision = par_nom[v][0], 'commune'
            elif (r['dept'] or '') in ('20', '2A', '2B'):
                c = [communes.get((d, v)) for d in ('2A', '2B') if communes.get((d, v))]
                if len(c) == 1: pos, precision = c[0], 'commune'
        if pos:
            r['lat'], r['lng'] = str(pos[0]), str(pos[1]); r['_precision'] = precision; geo[precision] += 1
        else: geo['aucune'] += 1

# ---------------------------------------------------------------- sites
STATUT = {'client': 'client', 'contact': 'en_contact'}
out_sites, out_contacts, stats = [], [], {'sans_position': 0, 'hors_metropole': 0, 'groupes': 0, 'contacts': 0}
for r in sites:
    cp = (r['cp'] or '').strip()
    ville_brute = (r['ville'] or '').strip()
    adr = (r['adresse'] or '').strip()
    m = re.match(r'^(.*?)\s+(\d{5})\s+(.+)$', adr)
    ville = m.group(3).strip() if m else (ville_brute if ville_brute != ville_brute.upper() else titre(ville_brute))
    if m: adr = m.group(1).strip(); cp = cp or m.group(2)
    elif norm(adr) == norm(ville_brute): adr = ''
    dep = dept_de_cp(cp) or (r['dept'] if re.fullmatch(r'\d\d|2A|2B', r['dept'] or '') else None)
    pays = 'DE' if r['dept'] == 'DE' else 'FR'
    if dep and len(dep) == 3: stats['hors_metropole'] += 1
    lat = float(r['lat']) if r['lat'] else None
    lng = float(r['lng']) if r['lng'] else None
    if lat is None: stats['sans_position'] += 1
    has_contact = r['contact'] not in ('', 'À qualifier')
    statut = STATUT.get(r['status'], 'prospect' if has_contact or r['rappel'] else 'a_qualifier')
    gid = groupe_du_site(r)
    if gid: stats['groupes'] += 1
    site_id = uid('site:' + r['id'])
    curated = r['id'].startswith(('avr-', 'pom-'))
    commentaire = '\n'.join(x for x in [r['notes'], r['note_contact'], r['info_decideur']] if x) or None
    out_sites.append({
        'id': site_id, 'nom': r['nom'].strip(), 'siret': r['siret'] or None, 'siren': r['siret'][:9] or None,
        'naf': r['naf'] or None, 'naf_libelle': r['naf_label'] or None, 'groupe_id': gid,
        'adresse': adr or None, 'code_postal': cp or None, 'ville': ville or None, 'departement': dep, 'pays': pays,
        'lat': lat, 'lng': lng,
        'categorie_auto': r['cat'] or None,
        'surface_auto': int(float(r['surf'])) if r['surf'] else None,
        'annee_auto': int(float(r['annee'])) if r['annee'] else None,
        'statut': statut, 'commentaire': commentaire,
        'date_prochain_rappel': r['rappel'] or None, 'date_dernier_appel': (r['contact_date'] or '')[:10] or None,
        'source': 'ebauche', 'source_id': r['id'],
        # surfaces/années saisies à la main pour Avril et Pomona ; ailleurs ce sont des estimations par tranche
        'infos_od': {'estimation': {'surface': not curated, 'annee': not curated}, **({'position_approx': r['_precision']} if r.get('_precision') else {}),
                     'ebauche': {'source': r['source'], 'groupe': r['groupe'] or None, 'score': r['score'], 'prio': r['prio'], 'secteur': r['sector'] or None}},
        'created_at': (r['created_at'] or '').replace(' ', 'T', 1).replace('+00', '+00:00') or None,
    })
    if has_contact:
        parts = r['contact'].split(' ', 1)
        out_contacts.append({
            'id': uid('contact:' + r['id']), 'site_id': site_id, 'groupe_id': gid,
            'prenom': parts[0] if len(parts) > 1 else None, 'nom': parts[-1],
            'fonction': r['contact_fonction'] or None,
            'telephone': r['tel'] if r['tel'] not in ('', 'À qualifier') else None,
            'email': r['mail'] or None, 'role': 'contact',
        })
        stats['contacts'] += 1

utilises = {x['groupe_id'] for x in out_sites if x['groupe_id']}
groupes = {k: g for k, g in groupes.items() if g['id'] in utilises}
json.dump({'format': 'big-prospection-reprise', 'groupes': list(groupes.values()), 'sites': out_sites, 'contacts': out_contacts},
          open(sortie, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print(f"{len(out_sites)} sites, {len(groupes)} groupes ({stats['groupes']} sites rattachés), {len(out_contacts)} contacts")
print(f"Exclus : {exclus['outre_mer']} outre-mer, {exclus['la_poste']} établissements La Poste")
print(f"Positions retrouvées : {geo['adresse']} par adresse identique, {geo['commune']} au centre de la commune ; {geo['aucune']} restent sans coordonnées")
print(f"{stats['sans_position']} sites sans coordonnées, {stats['hors_metropole']} en outre-mer")
