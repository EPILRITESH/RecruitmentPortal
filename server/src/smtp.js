// Minimal SMTP client that works on Cloudflare Workers (cloudflare:sockets) and on Node (node:tls / node:net).
// Used for free Gmail / Google Workspace (smtp.gmail.com:465 + App Password) and any other SMTP server.
const isWorkers = typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers';
const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64');

async function openSocket(host, port, mode) {
  // mode: 'tls' (implicit, port 465) | 'starttls' (587) | 'plain'
  if (isWorkers) {
    const { connect } = await import('cloudflare:sockets');
    const sock = connect({ hostname: host, port }, { secureTransport: mode === 'tls' ? 'on' : mode === 'starttls' ? 'starttls' : 'off', allowHalfOpen: false });
    return workersStream(sock);
  }
  return nodeStream(host, port, mode);
}

function workersStream(sock) {
  let writer = sock.writable.getWriter();
  let reader = sock.readable.getReader();
  return {
    async write(s) { await writer.write(enc.encode(s)); },
    async read() { const { value, done } = await reader.read(); return done ? null : dec.decode(value); },
    async upgrade() { writer.releaseLock(); reader.releaseLock(); const t = sock.startTls(); writer = t.writable.getWriter(); reader = t.readable.getReader(); },
    async close() { try { await writer.close(); } catch { /* closed */ } },
  };
}

async function nodeStream(host, port, mode) {
  const net = await import('node:net');
  const tls = await import('node:tls');
  let s = mode === 'tls' ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
  const queue = []; let waiting = null; let ended = false;
  const attach = (x) => {
    x.on('data', (d) => { const t = d.toString('utf8'); if (waiting) { const w = waiting; waiting = null; w(t); } else queue.push(t); });
    x.on('end', () => { ended = true; if (waiting) { const w = waiting; waiting = null; w(null); } });
    x.on('error', (e) => { ended = true; if (waiting) { const w = waiting; waiting = null; w(`599 ${e.message}\r\n`); } else queue.push(`599 ${e.message}\r\n`); });
  };
  attach(s);
  return {
    async write(t) { await new Promise((r, j) => s.write(t, (e) => (e ? j(e) : r()))); },
    async read() { if (queue.length) return queue.shift(); if (ended) return null; return new Promise((r) => { waiting = r; }); },
    async upgrade() { s.removeAllListeners('data'); s = tls.connect({ socket: s, servername: host }); attach(s); await new Promise((r) => s.once('secureConnect', r)); },
    async close() { s.end(); },
  };
}

/** Read one complete SMTP reply (handles multi-line "250-..." replies) */
async function reply(io, state) {
  for (;;) {
    const lines = state.buf.split('\r\n');
    for (let i = 0; i < lines.length - 1; i++) {
      if (/^\d{3} /.test(lines[i]) || /^\d{3}$/.test(lines[i])) {
        const text = lines.slice(0, i + 1).join('\n');
        state.buf = lines.slice(i + 1).join('\r\n');
        return { code: Number(lines[i].slice(0, 3)), text };
      }
    }
    const chunk = await io.read();
    if (chunk == null) throw new Error(`SMTP connection closed${state.buf ? `: ${state.buf.slice(0, 200)}` : ''}`);
    state.buf += chunk;
  }
}

async function cmd(io, state, line, expect, hide) {
  if (line != null) await io.write(`${line}\r\n`);
  const r = await reply(io, state);
  if (!expect.includes(r.code)) throw new Error(`SMTP ${hide ? '(auth)' : (line || 'greeting').split(' ')[0]} failed: ${r.text.slice(0, 200)}`);
  return r;
}

function buildMessage({ from, fromName, to, subject, text, html }) {
  const boundary = `b_${Math.random().toString(36).slice(2)}`;
  const wrap = (s) => b64(s).replace(/.{1,76}/g, '$&\r\n');
  const headers = [
    `From: =?UTF-8?B?${b64(fromName || from)}?= <${from}>`,
    `To: ${to.join(', ')}`,
    `Subject: =?UTF-8?B?${b64(subject || '')}?=`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${Date.now()}.${Math.random().toString(36).slice(2)}@${from.split('@')[1] || 'portal'}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  const body = [
    `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap(text || ''),
    `--${boundary}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap(html || text || ''),
    `--${boundary}--`, '',
  ];
  return [...headers, '', ...body].join('\r\n');
}

/**
 * Send one email.
 * opts: { host, port, security: 'tls'|'starttls'|'plain', user, pass, from, fromName, to: string|string[], subject, text, html }
 */
export async function smtpSend(opts) {
  const to = (Array.isArray(opts.to) ? opts.to : String(opts.to).split(',')).map((x) => x.trim()).filter(Boolean);
  const port = Number(opts.port) || (opts.security === 'tls' ? 465 : 587);
  const security = opts.security || (port === 465 ? 'tls' : 'starttls');
  const io = await openSocket(opts.host, port, security);
  const state = { buf: '' };
  const timer = new Promise((_, j) => setTimeout(() => j(new Error('SMTP timeout')), 20000));
  const work = (async () => {
    await cmd(io, state, null, [220]);
    await cmd(io, state, 'EHLO epil-portal', [250]);
    if (security === 'starttls') {
      await cmd(io, state, 'STARTTLS', [220]);
      await io.upgrade();
      await cmd(io, state, 'EHLO epil-portal', [250]);
    }
    if (opts.user) {
      await cmd(io, state, 'AUTH LOGIN', [334]);
      await cmd(io, state, b64(opts.user), [334], true);
      await cmd(io, state, b64(opts.pass || ''), [235], true);
    }
    await cmd(io, state, `MAIL FROM:<${opts.from}>`, [250]);
    for (const r of to) await cmd(io, state, `RCPT TO:<${r}>`, [250, 251]);
    await cmd(io, state, 'DATA', [354]);
    const msg = buildMessage({ ...opts, to }).replace(/\r\n\./g, '\r\n..'); // dot-stuffing
    await cmd(io, state, `${msg}\r\n.`, [250]);
    try { await io.write('QUIT\r\n'); } catch { /* ignore */ }
    await io.close();
    return { accepted: to };
  })();
  return Promise.race([work, timer]);
}
