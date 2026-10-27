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
  ('idf',      'IDF',      'Île-de-France',                        '#7A4FB6', 2),
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
  type        text not null check (type in ('appel','email','rdv','visite','devis','note','statut')),
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
create or replace function public.import_sites(rows jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  insert into public.sites as s (nom, enseigne, proprietaire, siren, siret, naf, naf_libelle,
                                 adresse, code_postal, ville, departement, pays, lat, lng,
                                 categorie_auto, surface_auto, annee_auto, statut, source, source_id, infos_od, updated_by)
  select r.nom, r.enseigne, r.proprietaire, r.siren, r.siret, r.naf, r.naf_libelle,
         r.adresse, r.code_postal, r.ville, r.departement, coalesce(r.pays,'FR'), r.lat, r.lng,
         r.categorie_auto, r.surface_auto, r.annee_auto, 'a_qualifier', r.source, r.source_id,
         coalesce(r.infos_od,'{}'::jsonb), 'import-opendata'
    from jsonb_to_recordset(rows) as r(nom text, enseigne text, proprietaire text, siren text, siret text,
         naf text, naf_libelle text, adresse text, code_postal text, ville text, departement text, pays text,
         lat double precision, lng double precision, categorie_auto text, surface_auto integer, annee_auto integer,
         source text, source_id text, infos_od jsonb)
  on conflict (source, source_id) do update set
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
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.import_sites(jsonb) from public, anon, authenticated;
do $$ begin
  execute 'grant execute on function public.import_sites(jsonb) to service_role';
exception when undefined_object then null; end $$;
