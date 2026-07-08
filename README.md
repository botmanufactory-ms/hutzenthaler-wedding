# Hochzeit Hutzenthaler – Foto-Portal

Gemeinsames Foto-Portal für die gesamte Hochzeitsgesellschaft.

- **Login nur mit Passwort** – die ganze Seite (ansehen, hochladen, herunterladen) ist passwortgeschützt; Gäste und Admin nutzen dasselbe Login-Feld mit unterschiedlichen Passwörtern
- **Alben ansehen** – alle Fotos & Videos in hoher Auflösung, mit Karussell/Lightbox
- **Hochladen** – Gäste können nur in das Album „Hochzeit – Gästeupload" hochladen; der Admin in jedes Album außer Fotobox (dort kann niemand hochladen)
- **Herunterladen** – einzelne Dateien oder ganze Alben als ZIP
- **Admin** – neue Alben anlegen über den Button „Neues Album" (nur als Admin sichtbar, Passwort-geschützt)

Die Regeln werden serverseitig per Supabase RLS/Storage-Policies erzwungen, nicht nur im Frontend.

## Technik

Statisches Frontend (HTML/CSS/JS, glassmorphic Design) + [Supabase](https://supabase.com) als Backend (Auth + Storage + Postgres/RPC). Der Storage-Bucket ist privat; Medien werden über signierte URLs (24 h gültig) geladen. Kein Build-Schritt nötig – einfach `index.html` hosten (z. B. GitHub Pages).

## Lokale Medien hochladen

```bash
WEDDING_ADMIN_PW='<Admin-Passwort>' node tools/upload-local.mjs
```

Lädt alle Dateien aus `Hutzenthalers/Hochzeit - Gästeupload` (nicht im Repo) in den Storage-Bucket. Bereits vorhandene Dateien werden übersprungen.

## Passwörter ändern

In Supabase (SQL-Editor):

```sql
-- Gäste-Passwort
update auth.users set encrypted_password = extensions.crypt('NEUES_PASSWORT', extensions.gen_salt('bf'))
where email = 'gast@hochzeit.local';

-- Admin-Passwort (Login)
update auth.users set encrypted_password = extensions.crypt('NEUES_PASSWORT', extensions.gen_salt('bf'))
where email = 'admin@hochzeit.local';

-- Admin-Passwort für „Neues Album" (sollte identisch zum Admin-Login sein)
update app_settings set value = extensions.crypt('NEUES_PASSWORT', extensions.gen_salt('bf'))
where key = 'admin_pin_hash';
```

## Deployment (Netlify)

```bash
rm -rf dist && mkdir dist && cp index.html styles.css app.js dist/
netlify deploy --prod --dir dist
```

Live: https://hutzenthaler-wedding.netlify.app
