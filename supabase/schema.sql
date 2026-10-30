-- =====================================================================
--  BIG Prospection — schéma Supabase
--  À exécuter UNE FOIS dans Supabase > SQL Editor (projet neuf conseillé).
--  Idempotent : peut être relancé sans casser les données existantes.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. Secteurs et équipe
-- ---------------------------------------------------------------------
create table if not exists public.secteurs (
  code     text primary key,               -- nord | idf | est | ouest | national
  libelle  text not null,
  zones    text not null default '',       -- texte affiché sous le nom du secteur
  couleur  text not null default '#505EB6',
  ordre    int  not null default 0
);

insert into public.secteurs (code, libelle, zones, couleur, ordre) values
  ('nord',     'Nord',     'Hauts-de-France, Grand Est, Belgique', '#505EB6', 1),
  ('idf',      'IDF',      'Île-de-France',                        '#D4549B', 2),
  ('est',      'Est',      'Auvergne-Rhône-Alpes, PACA',           '#C9772B', 3),
  ('ouest',    'Ouest',    'Reste de la France côté Ouest',        '#2E8B6A', 4),
  ('national', 'National', 'Tous secteurs',                        '#3B4796', 5)
on conflict (code) do update set libelle = excluded.libelle, zones = excluded.zones;

-- Répartition département -> secteur (modifiable à tout moment ici)
create table if not exists public.secteur_departements (
  departement text primary key,            -- '59', '2A', 'BE' pour la Belgique
  secteur     text not null references public.secteurs(code)
);

insert into public.secteur_departements (departement, secteur)
select d, 'nord' from unnest(array['02','59','60','62','80','08','10','51','52','54','55','57','67','68','88','BE']) d
on conflict (departement) do nothing;
insert into public.secteur_departements (departement, secteur)
select d, 'idf' from unnest(array['75','77','78','91','92','93','94','95']) d
on conflict (departement) do nothing;
-- Est : AURA + PACA (+ Corse, Bourgogne-Franche-Comté, Gard, Hérault, Lozère comme dans l'ébauche)
insert into public.secteur_departements (departement, secteur)
select d, 'est' from unnest(array['01','03','07','15','26','38','42','43','63','69','73','74',
                                  '04','05','06','13','83','84','2A','2B',
                                  '21','25','39','58','70','71','89','90','30','34','48']) d
on conflict (departement) do nothing;
-- Ouest : tout le reste
insert into public.secteur_departements (departement, secteur)
select d, 'ouest' from unnest(array['14','27','50','61','76','22','29','35','56','44','49','53','72','85',
                                    '18','28','36','37','41','45','16','17','19','23','24','33','40','47',
                                    '64','79','86','87','09','11','12','31','32','46','65','66','81','82']) d
on conflict (departement) do nothing;

create table if not exists public.profils (
  email       text primary key check (email ilike '%@big-france.com'),
  user_id     uuid unique references auth.users(id) on delete set null,
  prenom      text not null,
  nom         text not null,
  secteur     text not null references public.secteurs(code),
  role        text not null default 'ca' check (role in ('ca','directeur','admin')),
  telephone   text,
  actif       boolean not null default true
);

insert into public.profils (email, prenom, nom, secteur, role) values
  ('enieps@big-france.com',     'Emeric',     'NIEPS',     'nord',     'ca'),
  ('zejjanhani@big-france.com', 'Zineb',      'EJJANHANI', 'idf',      'ca'),
  ('mguerreiro@big-france.com', 'Marie',      'GUERREIRO', 'est',      'ca'),
  ('mpineau@big-france.com',    'Mathis',     'PINEAU',    'ouest',    'ca'),
  ('cdragne@big-france.com',    'Christophe', 'DRAGNE',    'national', 'directeur')
on conflict (email) do nothing;

-- ---------------------------------------------------------------------
-- 2. Groupes (enseignes / maisons-mères) et sites
-- ---------------------------------------------------------------------
create table if not exists public.groupes (
  id          uuid primary key default gen_random_uuid(),
  nom         text not null,
  notes       text,
  supprime    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  text
);
create unique index if not exists groupes_nom_uidx on public.groupes (lower(nom)) where not supprime;

create table if not exists public.sites (
  id                   uuid primary key default gen_random_uuid(),
  -- Identification
  nom                  text not null,
  enseigne             text,
  proprietaire         text,
  siren                text,
  siret                text,
  naf                  text,
  naf_libelle          text,
  groupe_id            uuid references public.groupes(id) on delete set null,
  -- Localisation
  adresse              text,
  code_postal          text,
  ville                text,
  departement          text,
  pays                 text not null default 'FR',
  lat                  double precision,
  lng                  double precision,
  secteur              text references public.secteurs(code),
  -- Caractéristiques (valeur saisie > valeur open data)
  categorie            text,
  categorie_auto       text,
  surface_m2           integer,
  surface_auto         integer,
  annee_construction   integer,
  annee_auto           integer,
  -- Qualification commerciale
  statut               text not null default 'a_qualifier'
                       check (statut in ('a_qualifier','prospect','en_contact','rdv','devis','client','perdu','non_pertinent')),
  standard_tel         text,
  site_web             text,
  commentaire          text,
  date_dernier_appel   date,
  date_prochain_rappel date,
  date_rdv             timestamptz,
  assigne_a            text references public.profils(email) on delete set null,
  -- Traçabilité
  source               text not null default 'manuel',   -- bdnb | osm | import | manuel | demo
  source_id            text,
  infos_od             jsonb not null default '{}'::jsonb, -- données brutes open data (ICPE, usage, hauteur…)
  supprime             boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  updated_by           text
);
create unique index if not exists sites_source_uidx on public.sites (source, source_id);
create index if not exists sites_secteur_idx on public.sites (secteur);
create index if not exists sites_updated_idx on public.sites (updated_at);
create index if not exists sites_groupe_idx  on public.sites (groupe_id);

-- Contacts : rattachés à un site et/ou à un groupe (organigramme via parent_id)
create table if not exists public.contacts (
  id          uuid primary key default gen_random_uuid(),
  site_id     uuid references public.sites(id) on delete cascade,
  groupe_id   uuid references public.groupes(id) on delete cascade,
  parent_id   uuid references public.contacts(id) on delete set null,
  prenom      text,
  nom         text not null,
  fonction    text,
  telephone   text,
  email       text,
  role        text not null default 'contact' check (role in ('decideur','contact','standard','prescripteur')),
  ca_big      text references public.profils(email) on delete set null,
  notes       text,
  supprime    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  text
);
create index if not exists contacts_site_idx   on public.contacts (site_id);
create index if not exists contacts_groupe_idx on public.contacts (groupe_id);

-- Historique : appels, RDV, devis, notes, changements de statut
create table if not exists public.activites (
  id          uuid primary key default gen_random_uuid(),
  site_id     uuid references public.sites(id) on delete cascade,
  type        text not null check (type in ('appel','email','rdv','visite','devis','chantier','note','statut')),
  date        timestamptz not null default now(),
  statut      text not null default 'fait' check (statut in ('planifie','fait','annule')),
  montant     numeric,
  contenu     text,
  auteur      text references public.profils(email) on delete set null,
  supprime    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  text
);
create index if not exists activites_site_idx on public.activites (site_id);
create index if not exists activites_date_idx on public.activites (date);
create index if not exists activites_upd_idx  on public.activites (updated_at);

-- ---------------------------------------------------------------------
-- 3. Triggers
-- ---------------------------------------------------------------------
-- updated_at = heure serveur à chaque écriture (sert de curseur à la synchronisation incrémentale)
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end $$;

do $$ declare t text; begin
  foreach t in array array['groupes','sites','contacts','activites'] loop
    execute format('drop trigger if exists trg_touch on public.%I', t);
    execute format('create trigger trg_touch before insert or update on public.%I for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- Secteur calculé depuis le département / pays ; valeurs open data recopiées si non saisies
create or replace function public.sites_derive() returns trigger language plpgsql as $$
begin
  if new.pays = 'BE' then
    new.departement := 'BE';
  elsif (new.departement is null or new.departement = '') and new.code_postal ~ '^\d{5}$' then
    new.departement := case
      when left(new.code_postal,2) = '20' then (case when new.code_postal < '20200' then '2A' else '2B' end)
      when left(new.code_postal,2) in ('97','98') then left(new.code_postal,3)
      else left(new.code_postal,2) end;
  end if;
  select sd.secteur into new.secteur
    from public.secteur_departements sd
   where sd.departement = case when new.pays = 'BE' then 'BE' else new.departement end;
  -- NB : categorie / surface_m2 / annee_construction restent NULL tant qu'un chargé d'affaires
  -- ne les corrige pas ; l'appli affiche alors categorie_auto / surface_auto / annee_auto.
  return new;
end $$;
drop trigger if exists trg_sites_derive on public.sites;
create trigger trg_sites_derive before insert or update on public.sites
  for each row execute function public.sites_derive();

-- Lien profil <-> compte Auth + refus des emails hors @big-france.com
create or replace function public.on_auth_user_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email not ilike '%@big-france.com' then
    raise exception 'Seules les adresses @big-france.com sont autorisées';
  end if;
  update public.profils set user_id = new.id where lower(email) = lower(new.email);
  return new;
end $$;
drop trigger if exists trg_on_auth_user_created on auth.users;
create trigger trg_on_auth_user_created after insert on auth.users
  for each row execute function public.on_auth_user_created();

-- Rattrapage si des comptes existent déjà
update public.profils p set user_id = u.id from auth.users u
 where lower(u.email) = lower(p.email) and p.user_id is null;

-- ---------------------------------------------------------------------
-- 4. Sécurité (RLS) : seuls les membres actifs de l'équipe accèdent aux données
-- ---------------------------------------------------------------------
create or replace function public.est_membre() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profils where user_id = auth.uid() and actif);
$$;
create or replace function public.est_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profils where user_id = auth.uid() and actif and role in ('directeur','admin'));
$$;

alter table public.secteurs              enable row level security;
alter table public.secteur_departements  enable row level security;
alter table public.profils               enable row level security;
alter table public.groupes               enable row level security;
alter table public.sites                 enable row level security;
alter table public.contacts              enable row level security;
alter table public.activites             enable row level security;

do $$ declare t text; begin
  foreach t in array array['secteurs','secteur_departements','profils','groupes','sites','contacts','activites'] loop
    execute format('drop policy if exists lecture on public.%I', t);
    execute format('create policy lecture on public.%I for select to authenticated using (public.est_membre())', t);
  end loop;
  foreach t in array array['groupes','sites','contacts','activites'] loop
    execute format('drop policy if exists ecriture on public.%I', t);
    execute format('drop policy if exists modification on public.%I', t);
    execute format('drop policy if exists suppression on public.%I', t);
    execute format('create policy ecriture on public.%I for insert to authenticated with check (public.est_membre())', t);
    execute format('create policy modification on public.%I for update to authenticated using (public.est_membre()) with check (public.est_membre())', t);
    -- suppression physique réservée au directeur (l'appli fait des suppressions « logiques »)
    execute format('create policy suppression on public.%I for delete to authenticated using (public.est_manager())', t);
  end loop;
end $$;

-- Chacun peut mettre à jour son propre téléphone ; le directeur gère l'équipe
drop policy if exists profil_maj on public.profils;
create policy profil_maj on public.profils for update to authenticated
  using (user_id = auth.uid() or public.est_manager())
  with check (user_id = auth.uid() or public.est_manager());
drop policy if exists secteur_dep_maj on public.secteur_departements;
create policy secteur_dep_maj on public.secteur_departements for all to authenticated
  using (public.est_manager()) with check (public.est_manager());

-- ---------------------------------------------------------------------
-- 5. Import open data (appelé par le script scripts/import-opendata.mjs avec la clé service_role)
--    Insère les nouveaux sites ; pour les sites existants, ne met à jour QUE les données open data
--    (jamais le nom, l'adresse ni la qualification saisis par l'équipe).
-- ---------------------------------------------------------------------
create index if not exists sites_lat_idx on public.sites (lat);
create index if not exists sites_siret_idx on public.sites (left(siret, 9));
create index if not exists sites_fusion_idx on public.sites ((infos_od->'fusion'->>'source_id'));

create or replace function public.import_sites(rows jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare
  r record; sid uuid; n integer := 0;
begin
  for r in select * from jsonb_to_recordset(rows) as x(nom text, enseigne text, proprietaire text, siren text, siret text,
         naf text, naf_libelle text, adresse text, code_postal text, ville text, departement text, pays text,
         lat double precision, lng double precision, categorie_auto text, surface_auto integer, annee_auto integer,
         source text, source_id text, infos_od jsonb)
  loop
    -- 1) déjà importé depuis cette source → mise à jour classique (plus bas)
    select id into sid from public.sites where source = r.source and source_id = r.source_id;
    if sid is null then
      -- 2) déjà fusionné lors d'un import précédent avec un site d'une autre origine ?
      select id into sid from public.sites
       where infos_od->'fusion'->>'source_id' = r.source_id and infos_od->'fusion'->>'source' = r.source limit 1;
      -- 3) sinon : même site déjà présent (ancienne base, import Excel, saisie) ?
      --    même SIREN à moins de 500 m, ou n'importe quel site à moins de ~130 m, pas encore fusionné
      if sid is null and r.lat is not null then
        select s.id into sid from public.sites s
         where s.source not in ('bdnb', 'osm') and not s.supprime and s.lat is not null
           and s.lat between r.lat - 0.005 and r.lat + 0.005 and s.lng between r.lng - 0.008 and r.lng + 0.008
           and s.infos_od->'fusion' is null
           and ( (coalesce(r.siren, left(r.siret, 9)) is not null and left(coalesce(s.siret, s.siren, ''), 9) = coalesce(r.siren, left(r.siret, 9)))
                 or ((s.lat - r.lat) ^ 2 + ((s.lng - r.lng) * 0.66) ^ 2) < 0.0012 ^ 2 )
         order by ((s.lat - r.lat) ^ 2 + ((s.lng - r.lng) * 0.66) ^ 2)
         limit 1;
      end if;
      if sid is not null then
        -- on enrichit le site existant avec les données open data (surface et année réelles remplacent les estimations)
        update public.sites s set
          categorie_auto = case when s.categorie_auto is null or s.categorie_auto = 'AUTRE' then r.categorie_auto else s.categorie_auto end,
          surface_auto   = coalesce(r.surface_auto, s.surface_auto),
          annee_auto     = coalesce(r.annee_auto, s.annee_auto),
          proprietaire   = coalesce(s.proprietaire, r.proprietaire),
          naf            = coalesce(s.naf, r.naf),
          naf_libelle    = coalesce(s.naf_libelle, r.naf_libelle),
          siret          = coalesce(s.siret, r.siret),
          adresse        = coalesce(s.adresse, r.adresse),
          nom            = case when public.nom_generique(s.nom) and not public.nom_generique(r.nom) then r.nom else s.nom end,
          infos_od       = (coalesce(s.infos_od, '{}'::jsonb) - 'estimation')
                           || coalesce(r.infos_od, '{}'::jsonb)
                           || jsonb_build_object('fusion', jsonb_build_object('source', r.source, 'source_id', r.source_id),
                                                 'estimation', jsonb_build_object(
                                                   'surface', r.surface_auto is null and coalesce((s.infos_od->'estimation'->>'surface')::boolean, false),
                                                   'annee',   r.annee_auto   is null and coalesce((s.infos_od->'estimation'->>'annee')::boolean, false))),
          updated_by     = 'import-opendata'
        where s.id = sid;
        n := n + 1;
        continue;
      end if;
    end if;
    insert into public.sites as s (nom, enseigne, proprietaire, siren, siret, naf, naf_libelle,
                                   adresse, code_postal, ville, departement, pays, lat, lng,
                                   categorie_auto, surface_auto, annee_auto, statut, source, source_id, infos_od, updated_by)
    values (r.nom, r.enseigne, r.proprietaire, r.siren, r.siret, r.naf, r.naf_libelle,
            r.adresse, r.code_postal, r.ville, r.departement, coalesce(r.pays, 'FR'), r.lat, r.lng,
            r.categorie_auto, r.surface_auto, r.annee_auto, 'a_qualifier', r.source, r.source_id,
            coalesce(r.infos_od, '{}'::jsonb), 'import-opendata')
    on conflict (source, source_id) do update set
           nom            = case when public.nom_generique(s.nom) and not public.nom_generique(excluded.nom) then excluded.nom else s.nom end,
           supprime       = case when s.supprime and s.updated_by = 'nettoyage-noms' and not public.nom_generique(excluded.nom) then false else s.supprime end,
           adresse        = coalesce(s.adresse, excluded.adresse),
           code_postal    = coalesce(s.code_postal, excluded.code_postal),
           ville          = coalesce(s.ville, excluded.ville),
           categorie_auto = excluded.categorie_auto,
           surface_auto   = excluded.surface_auto,
           annee_auto     = coalesce(excluded.annee_auto, s.annee_auto),
           naf            = coalesce(s.naf, excluded.naf),
           naf_libelle    = coalesce(s.naf_libelle, excluded.naf_libelle),
           siret          = coalesce(s.siret, excluded.siret),
           enseigne       = coalesce(s.enseigne, excluded.enseigne),
           proprietaire   = excluded.proprietaire,
           infos_od       = excluded.infos_od,
           updated_by     = 'import-opendata';
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.import_sites(jsonb) from public, anon, authenticated;
do $$ begin
  execute 'grant execute on function public.import_sites(jsonb) to service_role';
exception when undefined_object then null; end $$;

-- ---------------------------------------------------------------------
-- 6. Agences des loueurs de matériel (Kiloutou…) — alimentée par scripts/import-agences.mjs
-- ---------------------------------------------------------------------
create table if not exists public.agences (
  id          text primary key,                 -- siret ou identifiant OpenStreetMap
  enseigne    text not null,                    -- 'kiloutou'
  nom         text not null,
  adresse     text,
  code_postal text,
  ville       text,
  departement text,
  pays        text not null default 'FR',
  lat         double precision not null,
  lng         double precision not null,
  telephone   text,
  site_web    text,
  source      text,
  maj         timestamptz not null default now()
);
create index if not exists agences_enseigne_idx on public.agences (enseigne);
alter table public.agences enable row level security;
drop policy if exists lecture on public.agences;
create policy lecture on public.agences for select to authenticated using (public.est_membre());

-- ---------------------------------------------------------------------
-- 7. v1.3 : formats d'email, décisionnaires, référencement BIG chez les groupes
-- ---------------------------------------------------------------------
alter table public.groupes  add column if not exists email_format   text;      -- ex. {p}{nom}@log.com
alter table public.groupes  add column if not exists reference      boolean not null default false;  -- BIG référencé chez ce groupe
alter table public.groupes  add column if not exists reference_note text;
alter table public.sites    add column if not exists email_format   text;
alter table public.contacts add column if not exists decisionnaire  boolean not null default false;
alter table public.contacts add column if not exists niveau_decision text;
do $$ begin
  alter table public.contacts add constraint contacts_niveau_chk check (niveau_decision in ('local','regional','national'));
exception when duplicate_object then null; end $$;

-- ancien rôle « Décideur » → case Décisionnaire
update public.contacts set decisionnaire = true, role = 'contact' where role = 'decideur';

-- Formats relevés sur des annuaires publics (clay.com, prospeo.io) — indicatifs, à confirmer avec un vrai contact
update public.groupes g set email_format = v.f
  from (values ('geodis / sncf', '{prenom}.{nom}@geodis.com'), ('xpo', '{prenom}.{nom}@xpo.com'),
               ('kuehne+nagel', '{prenom}.{nom}@kuehne-nagel.com'), ('saint-gobain', '{prenom}.{nom}@saint-gobain.com'),
               ('dhl / deutsche post', '{prenom}.{nom}@dhl.com'), ('gxo logistics', '{prenom}.{nom}@gxo.com'),
               ('dsv', '{prenom}.{nom}@dsv.com'), ('db schenker', '{prenom}.{nom}@dbschenker.com'),
               ('air liquide', '{prenom}.{nom}@airliquide.com'), ('carrefour', '{prenom}_{nom}@carrefour.com'),
               ('lidl', '{prenom}.{nom}@lidl.com'), ('totalenergies', '{prenom}.{nom}@totalenergies.com'),
               ('lactalis', '{prenom}.{nom}@lactalis.fr'), ('fm logistic', '{p}{nom}@fmlogistic.com'),
               ('dachser', '{prenom}.{nom}@dachser.com')) as v(n, f)
 where lower(g.nom) = v.n and g.email_format is null;

-- ---------------------------------------------------------------------
-- 8. v1.4 : chantiers réalisés, contact lié aux échanges, couleurs des secteurs
-- ---------------------------------------------------------------------
alter table public.activites add column if not exists contact_id uuid references public.contacts(id) on delete set null;
alter table public.activites drop constraint if exists activites_type_check;
alter table public.activites add constraint activites_type_check
  check (type in ('appel','email','rdv','visite','devis','chantier','note','statut'));
-- couleurs bien distinctes pour la segmentation de la carte (si elles n'ont pas été personnalisées)
update public.secteurs set couleur = '#D4549B' where code = 'idf'   and couleur = '#7A4FB6';
update public.secteurs set couleur = '#C9772B' where code = 'est'   and couleur = '#C9772B';

-- ---------------------------------------------------------------------
-- 9. v1.5 : veille — appels d'offres (BOAMP) et actualités (presse, BODACC)
--    Alimentées chaque matin par scripts/veille.mjs (GitHub Actions) ; l'équipe y ajoute son suivi.
-- ---------------------------------------------------------------------
create table if not exists public.appels_offres (
  id               text primary key,                 -- 'boamp:<idweb>'
  source           text not null default 'boamp',
  titre            text not null,
  acheteur         text,
  description      text,
  departements     text[] not null default '{}',
  lieu             text,
  type_marche      text,
  procedure        text,
  date_publication date,
  date_limite      timestamptz,
  url              text,
  mots_cles        text[] not null default '{}',
  categorie        text,
  pertinence       integer not null default 0,
  -- suivi par l'équipe
  suivi            text not null default 'nouveau' check (suivi in ('nouveau','a_etudier','on_repond','repondu','sans_suite')),
  responsable      text references public.profils(email) on delete set null,
  note             text,
  maj              timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  updated_by       text
);
create index if not exists ao_limite_idx on public.appels_offres (date_limite);
create index if not exists ao_upd_idx on public.appels_offres (updated_at);

create table if not exists public.actualites (
  id               text primary key,                 -- empreinte du lien
  titre            text not null,
  url              text not null,
  media            text,
  date_publication timestamptz,
  categorie        text,                             -- incendie | defaillance | fermeture | ouverture | rachat | resultats | autre
  resume           text,
  departements     text[] not null default '{}',
  groupes          uuid[] not null default '{}',
  sites            uuid[] not null default '{}',
  requete          text,
  pertinence       integer not null default 0,
  source           text not null default 'presse',   -- presse | bodacc
  masque           boolean not null default false,   -- masquée par l'équipe (hors sujet)
  maj              timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  updated_by       text
);
create index if not exists actu_date_idx on public.actualites (date_publication);
create index if not exists actu_upd_idx on public.actualites (updated_at);

do $$ declare t text; begin
  foreach t in array array['appels_offres','actualites'] loop
    execute format('drop trigger if exists trg_touch on public.%I', t);
    execute format('create trigger trg_touch before insert or update on public.%I for each row execute function public.touch_updated_at()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists lecture on public.%I', t);
    execute format('drop policy if exists ecriture on public.%I', t);
    execute format('drop policy if exists modification on public.%I', t);
    execute format('create policy lecture on public.%I for select to authenticated using (public.est_membre())', t);
    execute format('create policy ecriture on public.%I for insert to authenticated with check (public.est_membre())', t);
    execute format('create policy modification on public.%I for update to authenticated using (public.est_membre()) with check (public.est_membre())', t);
  end loop;
end $$;


-- ---------------------------------------------------------------------
-- 10. v1.6 : établissements actifs / fermés, noms concrets
--     Vérification par scripts/verifier-etablissements.mjs (API Recherche d'entreprises / SIRENE).
-- ---------------------------------------------------------------------
alter table public.sites add column if not exists etat_etablissement text not null default 'inconnu';
alter table public.sites add column if not exists date_fermeture date;
do $$ begin
  alter table public.sites add constraint sites_etat_etab_chk check (etat_etablissement in ('actif','ferme','inconnu'));
exception when duplicate_object then null; end $$;

-- nom « générique » (bâtiment sans occupant identifié) : remplaçable par un nom d'entreprise
create or replace function public.nom_generique(n text) returns boolean
language sql immutable as $$
  select n is null or btrim(n) = '' or n ~* '^(bâtiment|batiment|site) (industriel|logistique)'
$$;

-- suivi des vérifications (non synchronisé dans l'appli : réservé au script)
create table if not exists public.verifications_sites (
  site_id    uuid primary key references public.sites(id) on delete cascade,
  verifie_le timestamptz not null default now(),
  resultat   jsonb
);
alter table public.verifications_sites enable row level security;

-- écriture groupée des résultats ; ne modifie un site que si quelque chose change
create or replace function public.maj_etablissements(rows jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0; k integer;
begin
  for r in select * from jsonb_to_recordset(rows) as x(id uuid, etat text, date_fermeture date, nom text, siret text, siren text, naf text,
                                                       naf_libelle text, nouvel_occupant jsonb, resultat jsonb)
  loop
    update public.sites s set
      etat_etablissement = coalesce(r.etat, s.etat_etablissement),
      date_fermeture     = case when coalesce(r.etat, s.etat_etablissement) = 'ferme' then coalesce(r.date_fermeture, s.date_fermeture) else null end,
      nom                = case when r.nom is not null and (public.nom_generique(s.nom) or lower(s.nom) = lower(coalesce(s.proprietaire, ''))) then r.nom else s.nom end,
      siret              = coalesce(s.siret, r.siret),
      siren              = coalesce(s.siren, r.siren),
      naf                = coalesce(s.naf, r.naf),
      naf_libelle        = coalesce(s.naf_libelle, r.naf_libelle),
      infos_od           = case when r.nouvel_occupant is null then coalesce(s.infos_od, '{}'::jsonb) - 'nouvel_occupant'
                                else coalesce(s.infos_od, '{}'::jsonb) || jsonb_build_object('nouvel_occupant', r.nouvel_occupant) end,
      updated_by         = 'verification'
    where s.id = r.id
      and ( s.etat_etablissement is distinct from coalesce(r.etat, s.etat_etablissement)
         or (coalesce(r.etat, s.etat_etablissement) = 'ferme' and s.date_fermeture is distinct from coalesce(r.date_fermeture, s.date_fermeture))
         or (r.nom is not null and (public.nom_generique(s.nom) or lower(s.nom) = lower(coalesce(s.proprietaire, ''))) and s.nom is distinct from r.nom)
         or (s.siret is null and r.siret is not null) or (s.siren is null and r.siren is not null) or (s.naf is null and r.naf is not null)
         or (s.infos_od->'nouvel_occupant') is distinct from r.nouvel_occupant );
    get diagnostics k = row_count; n := n + k;
    insert into public.verifications_sites (site_id, verifie_le, resultat) values (r.id, now(), r.resultat)
      on conflict (site_id) do update set verifie_le = now(), resultat = excluded.resultat;
  end loop;
  return n;
end $$;

-- sites à vérifier : jamais vérifiés d'abord, puis les plus anciennement vérifiés
create or replace function public.sites_a_verifier(nb integer, jours integer default 30) returns table (
  id uuid, nom text, proprietaire text, siret text, siren text, lat double precision, lng double precision, pays text, etat_etablissement text)
language sql security definer set search_path = public as $$
  select s.id, s.nom, s.proprietaire, s.siret, s.siren, s.lat, s.lng, s.pays, s.etat_etablissement
  from public.sites s left join public.verifications_sites v on v.site_id = s.id
  where not s.supprime and coalesce(s.pays, 'FR') = 'FR' and (v.verifie_le is null or v.verifie_le < now() - make_interval(days => jours))
  order by v.verifie_le nulls first, s.id
  limit nb
$$;

-- Belgique : retire les bâtiments sans nom jamais travaillés (aucun suivi, contact ni historique)
create or replace function public.nettoyer_sites_sans_nom(p_source text default 'osm') returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.sites s set supprime = true, updated_by = 'nettoyage-noms'
   where s.source = p_source and not s.supprime and public.nom_generique(s.nom)
     and coalesce(s.statut, 'a_qualifier') = 'a_qualifier' and s.assigne_a is null
     and s.commentaire is null and s.date_prochain_rappel is null
     and not exists (select 1 from public.contacts c where c.site_id = s.id and not c.supprime)
     and not exists (select 1 from public.activites a where a.site_id = s.id and not a.supprime);
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.maj_etablissements(jsonb) from public, anon, authenticated;
revoke all on function public.sites_a_verifier(integer, integer) from public, anon, authenticated;
revoke all on function public.nettoyer_sites_sans_nom(text) from public, anon, authenticated;
do $$ begin
  execute 'grant execute on function public.maj_etablissements(jsonb) to service_role';
  execute 'grant execute on function public.sites_a_verifier(integer, integer) to service_role';
  execute 'grant execute on function public.nettoyer_sites_sans_nom(text) to service_role';
exception when undefined_object then null; end $$;

-- ---------------------------------------------------------------------
-- 11. v1.7 : stratégie commerciale (missions confiées à un ou plusieurs chargés d'affaires)
--     Le périmètre est « vivant » (critères de filtre) ; l'avancement est calculé dans l'appli
--     à partir des contacts / activités. strategie_sites ne contient que les exceptions
--     (site attribué à la main, marqué fait ou sans objet).
-- ---------------------------------------------------------------------
create or replace function public.mon_email() returns text
language sql stable security definer set search_path = public as $$
  select email from public.profils where user_id = auth.uid() and actif limit 1;
$$;

create table if not exists public.strategies (
  id           uuid primary key default gen_random_uuid(),
  titre        text not null,
  modele       text not null default 'perso',
  consigne     text,
  criteres     jsonb not null default '{}',
  objectif     text not null default 'contacte',
  cible        integer,
  echeance     date,
  debut        date not null default current_date,
  statut       text not null default 'en_cours' check (statut in ('brouillon','en_cours','terminee')),
  membres      text[] not null default '{}',
  repartition  text not null default 'secteur' check (repartition in ('secteur','equitable','manuel')),
  personnelle  boolean not null default false,
  cree_par     text,
  supprime     boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   text
);
create index if not exists strategies_upd_idx on public.strategies (updated_at);

create table if not exists public.strategie_sites (
  id            text primary key,                 -- '<strategie_id>:<site_id>'
  strategie_id  uuid not null references public.strategies(id) on delete cascade,
  site_id       uuid not null references public.sites(id) on delete cascade,
  affecte_a     text,                             -- attribution manuelle à un chargé d'affaires
  etat          text check (etat in ('fait','sans_objet')),
  raison        text,
  supprime      boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    text
);
create index if not exists strat_sites_upd_idx on public.strategie_sites (updated_at);
create index if not exists strat_sites_strat_idx on public.strategie_sites (strategie_id);

do $$ declare t text; begin
  foreach t in array array['strategies','strategie_sites'] loop
    execute format('drop trigger if exists trg_touch on public.%I', t);
    execute format('create trigger trg_touch before insert or update on public.%I for each row execute function public.touch_updated_at()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists lecture on public.%I', t);
    execute format('drop policy if exists ecriture on public.%I', t);
    execute format('drop policy if exists modification on public.%I', t);
    execute format('create policy lecture on public.%I for select to authenticated using (public.est_membre())', t);
  end loop;
end $$;
-- stratégies : créées par tout membre ; modifiées par le directeur ou par leur auteur (stratégie personnelle)
create policy ecriture on public.strategies for insert to authenticated with check (public.est_membre());
create policy modification on public.strategies for update to authenticated
  using (public.est_manager() or cree_par = public.mon_email()) with check (public.est_manager() or cree_par = public.mon_email());
-- suivi site par site : tout membre (le chargé d'affaires coche ses sites)
create policy ecriture on public.strategie_sites for insert to authenticated with check (public.est_membre());
create policy modification on public.strategie_sites for update to authenticated using (public.est_membre()) with check (public.est_membre());

-- ---------------------------------------------------------------------
-- 12. v1.8 : pôle DALLAGE (accès réservé : directeur / admin, ou profils.acces_dallage)
--     Tables séparées « dal_* » : la partie Maintenance n'est pas touchée.
--     Secteur unique « nouvelle_aquitaine » (12 départements).
-- ---------------------------------------------------------------------
alter table public.profils add column if not exists acces_dallage boolean not null default false;

create or replace function public.est_dallage() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profils where user_id = auth.uid() and actif and (role in ('directeur','admin') or acces_dallage));
$$;

do $$ declare t text; begin
  foreach t in array array['groupes','sites','contacts','activites','appels_offres','actualites','strategies','strategie_sites'] loop
    execute format('create table if not exists public.%I (like public.%I including defaults including constraints including indexes)', 'dal_' || t, t);
  end loop;
end $$;
-- quelques valeurs par défaut propres au dallage
alter table public.dal_sites alter column source set default 'manuel';

create or replace function public.dal_departements() returns text[]
language sql immutable as $$
  select array['16','17','19','23','24','33','40','47','64','79','86','87']   -- Nouvelle-Aquitaine
$$;
create or replace function public.dal_sites_derive() returns trigger language plpgsql as $$
begin
  if (new.departement is null or new.departement = '') and new.code_postal ~ '^\d{5}$' then
    new.departement := case when left(new.code_postal,2) = '20' then (case when new.code_postal < '20200' then '2A' else '2B' end)
                            when left(new.code_postal,2) in ('97','98') then left(new.code_postal,3) else left(new.code_postal,2) end;
  end if;
  new.secteur := case when new.departement = any(public.dal_departements()) then 'nouvelle_aquitaine' else null end;
  return new;
end $$;
drop trigger if exists trg_dal_sites_derive on public.dal_sites;
create trigger trg_dal_sites_derive before insert or update on public.dal_sites for each row execute function public.dal_sites_derive();

do $$ declare t text; begin
  foreach t in array array['dal_groupes','dal_sites','dal_contacts','dal_activites','dal_appels_offres','dal_actualites','dal_strategies','dal_strategie_sites'] loop
    execute format('drop trigger if exists trg_touch on public.%I', t);
    execute format('create trigger trg_touch before insert or update on public.%I for each row execute function public.touch_updated_at()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists lecture on public.%I', t);
    execute format('drop policy if exists ecriture on public.%I', t);
    execute format('drop policy if exists modification on public.%I', t);
    execute format('drop policy if exists suppression on public.%I', t);
    execute format('create policy lecture on public.%I for select to authenticated using (public.est_dallage())', t);
    execute format('create policy ecriture on public.%I for insert to authenticated with check (public.est_dallage())', t);
    execute format('create policy modification on public.%I for update to authenticated using (public.est_dallage()) with check (public.est_dallage())', t);
  end loop;
end $$;

-- import des acteurs et projets (scripts/import-dallage.mjs) : les champs commerciaux ne sont jamais écrasés
create or replace function public.dal_import(rows jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  for r in select * from jsonb_to_recordset(rows) as x(nom text, enseigne text, proprietaire text, siren text, siret text,
         naf text, naf_libelle text, adresse text, code_postal text, ville text, departement text, pays text,
         lat double precision, lng double precision, categorie_auto text, surface_auto integer, annee_auto integer,
         standard_tel text, site_web text, source text, source_id text, infos_od jsonb)
  loop
    insert into public.dal_sites as s (nom, enseigne, proprietaire, siren, siret, naf, naf_libelle, adresse, code_postal, ville, departement, pays,
                                       lat, lng, categorie_auto, surface_auto, annee_auto, standard_tel, site_web, statut, source, source_id, infos_od, updated_by)
    values (r.nom, r.enseigne, r.proprietaire, r.siren, r.siret, r.naf, r.naf_libelle, r.adresse, r.code_postal, r.ville, r.departement, coalesce(r.pays, 'FR'),
            r.lat, r.lng, r.categorie_auto, r.surface_auto, r.annee_auto, r.standard_tel, r.site_web, 'a_qualifier', r.source, r.source_id, coalesce(r.infos_od, '{}'::jsonb), 'import-dallage')
    on conflict (source, source_id) do update set
      nom = case when s.updated_by in ('import-dallage') or s.nom is null then excluded.nom else s.nom end,
      enseigne = coalesce(s.enseigne, excluded.enseigne), proprietaire = coalesce(excluded.proprietaire, s.proprietaire),
      siren = coalesce(s.siren, excluded.siren), siret = coalesce(s.siret, excluded.siret), naf = coalesce(s.naf, excluded.naf),
      naf_libelle = coalesce(s.naf_libelle, excluded.naf_libelle), adresse = coalesce(s.adresse, excluded.adresse),
      code_postal = coalesce(s.code_postal, excluded.code_postal), ville = coalesce(s.ville, excluded.ville),
      lat = coalesce(s.lat, excluded.lat), lng = coalesce(s.lng, excluded.lng),
      categorie_auto = excluded.categorie_auto, surface_auto = coalesce(excluded.surface_auto, s.surface_auto), annee_auto = coalesce(excluded.annee_auto, s.annee_auto),
      standard_tel = coalesce(s.standard_tel, excluded.standard_tel), site_web = coalesce(s.site_web, excluded.site_web),
      infos_od = coalesce(s.infos_od, '{}'::jsonb) || coalesce(excluded.infos_od, '{}'::jsonb)
    where s.infos_od is distinct from coalesce(s.infos_od, '{}'::jsonb) || coalesce(excluded.infos_od, '{}'::jsonb)
       or s.categorie_auto is distinct from excluded.categorie_auto or s.lat is null;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.dal_import(jsonb) from public, anon, authenticated;
do $$ begin execute 'grant execute on function public.dal_import(jsonb) to service_role'; exception when undefined_object then null; end $$;
