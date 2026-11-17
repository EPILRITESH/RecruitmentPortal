// File storage for resumes / invoices.
//   Cloudflare: R2 bucket binding `env.FILES`
//   Node.js:    ./uploads folder
import crypto from 'node:crypto';

let store = null;

export function useR2(bucket) {
  store = {
    async put(name, buf, type) { await bucket.put(name, buf, { httpMetadata: { contentType: type || 'application/octet-stream' } }); },
    async get(name) {
      const o = await bucket.get(name);
      return o ? { body: Buffer.from(await o.arrayBuffer()), type: o.httpMetadata?.contentType } : null;
    },
  };
}

/** Files inside D1 (fallback when R2 is not enabled). D1 rows are limited to ~2 MB. */
export function useD1Files(d1) {
  store = {
    async put(name, buf, type) {
      if (buf.length > 1.9 * 1024 * 1024) {
        const e = new Error('File too large – please upload a file under 1.9 MB (or enable R2 storage)');
        e.status = 400;
        throw e;
      }
      await d1.prepare('INSERT INTO files(name, type, size, data, created_at) VALUES(?,?,?,?,?)')
        .bind(name, type || null, buf.length, new Uint8Array(buf), new Date().toISOString()).run();
    },
    async get(name) {
      const r = await d1.prepare('SELECT type, data FROM files WHERE name=?').bind(name).first();
      return r ? { body: Buffer.from(r.data), type: r.type } : null;
    },
  };
}

export async function useLocalDir(dir) {
  const fs = await import('node:fs');
  const path = await import('node:path');
  fs.mkdirSync(dir, { recursive: true });
  store = {
    async put(name, buf) { fs.writeFileSync(path.join(dir, name), buf); },
    async get(name) {
      const p = path.join(dir, path.basename(name));
      return fs.existsSync(p) ? { body: fs.readFileSync(p), type: null } : null;
    },
  };
}

const EXT_TYPE = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.txt': 'text/plain',
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };

/** Save a multer (memory) file, return the stored file name */
export async function saveUpload(file) {
  if (!file) return null;
  const m = /\.[a-z0-9]{2,5}$/i.exec(file.originalname || '');
  const ext = m ? m[0].toLowerCase() : '';
  const name = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
  await store.put(name, file.buffer, file.mimetype || EXT_TYPE[ext]);
  return name;
}

export async function readUpload(name) {
  if (!/^[\w.-]+$/.test(name)) return null;
  const f = await store.get(name);
  if (!f) return null;
  const m = /\.[a-z0-9]{2,5}$/i.exec(name);
  return { ...f, type: f.type || EXT_TYPE[m?.[0]?.toLowerCase()] || 'application/octet-stream' };
}
