#!/usr/bin/env python3
"""
Reprise de l'ancienne base (export Supabase de l'ébauche : sites_rows.csv + groupes_rows.csv)
→ reprise-ebauche.json, à importer dans l'appli (menu ▸ Importer des sites).

Usage : python3 reprise-ebauche.py sites_rows.csv groupes_rows.csv reprise-ebauche.json
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
        'infos_od': {'estimation': {'surface': not curated, 'annee': not curated},
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

json.dump({'format': 'big-prospection-reprise', 'groupes': list(groupes.values()), 'sites': out_sites, 'contacts': out_contacts},
          open(sortie, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print(f"{len(out_sites)} sites, {len(groupes)} groupes ({stats['groupes']} sites rattachés), {len(out_contacts)} contacts")
print(f"{stats['sans_position']} sites sans coordonnées, {stats['hors_metropole']} en outre-mer")
