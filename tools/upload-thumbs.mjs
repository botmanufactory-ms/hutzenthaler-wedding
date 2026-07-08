// Lädt lokal generierte Thumbnails (thumbs/<album>/<datei>.jpg) in den Bucket.
// Aufruf: WEDDING_ADMIN_PW='<Admin-Passwort>' node tools/upload-thumbs.mjs <thumbs-ordner>
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const SUPABASE_URL = 'https://ttlvnxjlorejwntxxxzt.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR0bHZueGpsb3JlandudHh4eHp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0NjM5MjgsImV4cCI6MjA5OTAzOTkyOH0.B9OtpkmV7qNs6CK0EVzRNJcPtzBHNrj9NwN4repfXlI';
const BUCKET = 'wedding';

const ROOT = process.argv[2];
if (!ROOT || !process.env.WEDDING_ADMIN_PW) {
  console.error('Aufruf: WEDDING_ADMIN_PW=... node tools/upload-thumbs.mjs <thumbs-ordner>');
  process.exit(1);
}

const authRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: ANON_KEY, 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'admin@hochzeit.local', password: process.env.WEDDING_ADMIN_PW }),
});
if (!authRes.ok) { console.error('Login fehlgeschlagen'); process.exit(1); }
const { access_token: TOKEN } = await authRes.json();

let ok = 0, skip = 0, fail = 0;
for (const slug of await readdir(ROOT)) {
  const dir = path.join(ROOT, slug);
  const files = (await readdir(dir)).filter((f) => f.endsWith('.jpg'));
  console.log(`== thumbs/${slug} (${files.length}) ==`);
  const queue = [...files];
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const name = queue.shift();
      const body = await readFile(path.join(dir, name));
      for (let a = 1; a <= 3; a++) {
        const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/thumbs/${slug}/${name}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${TOKEN}`, apikey: ANON_KEY,
            'content-type': 'image/jpeg', 'x-upsert': 'true',
            'cache-control': 'max-age=31536000',
          },
          body,
        }).catch(() => null);
        if (res?.ok) { ok++; break; }
        if (res?.status === 400 && (await res.text()).includes('exists')) { skip++; break; }
        if (a === 3) { fail++; console.error(`✗ ${slug}/${name}`); }
        else await new Promise((r) => setTimeout(r, 1000 * a));
      }
    }
  }));
}
console.log(`FERTIG: ${ok} hochgeladen, ${skip} übersprungen, ${fail} fehlgeschlagen.`);
