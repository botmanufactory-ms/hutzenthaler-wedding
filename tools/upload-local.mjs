// Lädt alle lokalen Fotos/Videos in den Supabase-Storage-Bucket "wedding".
// Aufruf: WEDDING_ADMIN_PW='<Admin-Passwort>' node tools/upload-local.mjs
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SUPABASE_URL = 'https://ttlvnxjlorejwntxxxzt.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR0bHZueGpsb3JlandudHh4eHp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0NjM5MjgsImV4cCI6MjA5OTAzOTkyOH0.B9OtpkmV7qNs6CK0EVzRNJcPtzBHNrj9NwN4repfXlI';
const BUCKET = 'wedding';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// Fotobox ist bereits vollständig hochgeladen und per Policy für Uploads gesperrt.
const FOLDERS = [
  { local: 'Hutzenthalers/Hochzeit - Gästeupload', slug: 'gaesteupload' },
];

const MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  gif: 'image/gif', heic: 'image/heic', avif: 'image/avif',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', m4v: 'video/mp4',
};

function sanitize(name) {
  const dot = name.lastIndexOf('.');
  const base = (dot > 0 ? name.slice(0, dot) : name)
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/^-+|-+$/g, '') || 'datei';
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : 'bin';
  return `${base}.${ext}`;
}

const ADMIN_PW = process.env.WEDDING_ADMIN_PW;
if (!ADMIN_PW) {
  console.error('Bitte Admin-Passwort setzen: WEDDING_ADMIN_PW=... node tools/upload-local.mjs');
  process.exit(1);
}
const authRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: ANON_KEY, 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'admin@hochzeit.local', password: ADMIN_PW }),
});
if (!authRes.ok) {
  console.error('Login fehlgeschlagen:', (await authRes.text()).slice(0, 200));
  process.exit(1);
}
const { access_token: TOKEN } = await authRes.json();
console.log('Als Admin eingeloggt.');

async function uploadFile(localPath, remotePath, mime, size) {
  const body = await readFile(localPath);
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${remotePath}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      apikey: ANON_KEY,
      'content-type': mime,
      'x-upsert': 'false',
      'cache-control': 'max-age=31536000',
    },
    body,
  });
  if (res.status === 400) {
    const txt = await res.text();
    if (txt.includes('already exists') || txt.includes('Duplicate')) return 'skip';
    throw new Error(`${res.status}: ${txt.slice(0, 200)}`);
  }
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
  return 'ok';
}

let ok = 0, skip = 0, fail = 0;
const failures = [];

for (const { local, slug } of FOLDERS) {
  const dir = path.join(ROOT, local);
  const entries = (await readdir(dir)).filter((f) => MIME[f.split('.').pop().toLowerCase()]);
  entries.sort();
  console.log(`\n== ${local} -> ${slug}/ (${entries.length} Dateien) ==`);

  const queue = [...entries];
  const workers = Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const name = queue.shift();
      const localPath = path.join(dir, name);
      const { size } = await stat(localPath);
      const remotePath = `${slug}/${sanitize(name)}`;
      const mime = MIME[name.split('.').pop().toLowerCase()];
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const r = await uploadFile(localPath, remotePath, mime, size);
          if (r === 'skip') { skip++; console.log(`~ übersprungen (existiert): ${remotePath}`); }
          else { ok++; console.log(`✓ ${remotePath} (${(size / 1e6).toFixed(1)} MB) [${ok + skip + fail}]`); }
          break;
        } catch (err) {
          if (attempt === 3) {
            fail++;
            failures.push(`${remotePath}: ${err.message}`);
            console.error(`✗ ${remotePath}: ${err.message}`);
          } else {
            await new Promise((r) => setTimeout(r, 1500 * attempt));
          }
        }
      }
    }
  });
  await Promise.all(workers);
}

console.log(`\nFERTIG: ${ok} hochgeladen, ${skip} übersprungen, ${fail} fehlgeschlagen.`);
if (failures.length) {
  console.log('\nFehlgeschlagene Dateien:');
  failures.forEach((f) => console.log(' - ' + f));
}
