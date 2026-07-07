# Hochzeit Hutzenthaler – Foto-Portal

Gemeinsames Foto-Portal für die gesamte Hochzeitsgesellschaft.

- **Alben ansehen** – alle Fotos & Videos in hoher Auflösung, mit Karussell/Lightbox
- **Hochladen** – jeder Gast kann Fotos und Videos in jedes Album hochladen
- **Herunterladen** – einzelne Dateien oder ganze Alben als ZIP
- **Admin** – neue Alben anlegen über den Button „Neues Album" (PIN-geschützt)

## Technik

Statisches Frontend (HTML/CSS/JS, glassmorphic Design) + [Supabase](https://supabase.com) als Backend (Storage + Postgres/RPC). Kein Build-Schritt nötig – einfach `index.html` hosten (z. B. GitHub Pages).

## Lokale Medien hochladen

```bash
node tools/upload-local.mjs
```

Lädt alle Dateien aus `Hutzenthalers/` (nicht im Repo) in den Storage-Bucket.

## Admin-PIN ändern

In Supabase (SQL-Editor):

```sql
update app_settings set value = crypt('NEUER_PIN', gen_salt('bf')) where key = 'admin_pin_hash';
```
