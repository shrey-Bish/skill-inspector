#!/usr/bin/env node
// The fake internet. One per run, on the host, reachable only by that run's sandbox.
//
// It pretends to be every server: a SOCKS5 proxy that says "connected", then answers
// as the destination, and a DNS server that resolves every name to a dead address.
// It NEVER opens an outbound connection. Everything it hears becomes a JSONL record
// that the control layer searches for decoy values.
//
// No dependencies. TLS certificates are minted per hostname with the openssl CLI.

import { createServer } from 'node:net';
import { Duplex } from 'node:stream';
import { createSocket } from 'node:dgram';
import { TLSSocket, createSecureContext } from 'node:tls';
import { appendFileSync, mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

const LOG = arg('log');
const WORK = arg('work', '/tmp/sink');
const SOCKS_PORT = Number(arg('socks-port', '0'));
const DNS_PORT = Number(arg('dns-port', '0'));
const MAX_CAPTURE = 64 * 1024;

if (!LOG) {
  console.error('usage: sink.mjs --log <file> [--work <dir>] [--socks-port n] [--dns-port n]');
  process.exit(2);
}
mkdirSync(WORK, { recursive: true });

function record(event) {
  appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n');
}

// --- Certificates ---------------------------------------------------------------

const CA_KEY = join(WORK, 'ca.key');
const CA_CERT = join(WORK, 'ca.crt');

function ensureCa() {
  if (existsSync(CA_CERT)) return;
  execFileSync('openssl', ['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', CA_KEY], { stdio: 'ignore' });
  execFileSync('openssl', ['req', '-x509', '-new', '-key', CA_KEY, '-sha256', '-days', '2',
    '-subj', '/CN=Skill Inspector test space', '-out', CA_CERT], { stdio: 'ignore' });
}

const contexts = new Map();

function contextFor(hostname) {
  const safe = /^[a-zA-Z0-9.-]{1,253}$/.test(hostname) ? hostname : 'unknown.invalid';
  if (contexts.has(safe)) return contexts.get(safe);
  const key = join(WORK, `${safe}.key`);
  const crt = join(WORK, `${safe}.crt`);
  const csr = join(WORK, `${safe}.csr`);
  const ext = join(WORK, `${safe}.ext`);
  execFileSync('openssl', ['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', key], { stdio: 'ignore' });
  execFileSync('openssl', ['req', '-new', '-key', key, '-subj', `/CN=${safe}`, '-out', csr], { stdio: 'ignore' });
  writeFileSync(ext, `subjectAltName=DNS:${safe}\n`);
  execFileSync('openssl', ['x509', '-req', '-in', csr, '-CA', CA_CERT, '-CAkey', CA_KEY, '-CAcreateserial',
    '-days', '2', '-sha256', '-extfile', ext, '-out', crt], { stdio: 'ignore' });
  const ctx = createSecureContext({ key: readFileSync(key), cert: readFileSync(crt) });
  contexts.set(safe, ctx);
  return ctx;
}

// --- Fake DNS -------------------------------------------------------------------

// Every name gets its own address in TEST-NET-3 (203.0.113.0/24), which is not routed
// on the internet. If traffic ever escaped the proxy, it would still go nowhere.
const nameByIp = new Map();
const ipByName = new Map();

function ipFor(name) {
  if (ipByName.has(name)) return ipByName.get(name);
  const ip = `203.0.113.${(ipByName.size % 253) + 1}`;
  ipByName.set(name, ip);
  nameByIp.set(ip, name);
  return ip;
}

function parseQuestion(msg) {
  let i = 12;
  const labels = [];
  while (i < msg.length && msg[i] !== 0) {
    const len = msg[i];
    if (len > 63 || i + 1 + len > msg.length) return null;
    labels.push(msg.subarray(i + 1, i + 1 + len).toString('latin1'));
    i += len + 1;
  }
  if (i + 5 > msg.length) return null;
  return { name: labels.join('.').toLowerCase(), qtype: msg.readUInt16BE(i + 1), end: i + 5 };
}

function dnsAnswer(msg, q) {
  const question = msg.subarray(12, q.end);
  const wantsA = q.qtype === 1;
  const header = Buffer.alloc(12);
  msg.copy(header, 0, 0, 2);
  header.writeUInt16BE(0x8180, 2); // response, recursion available, no error
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(wantsA ? 1 : 0, 6);
  if (!wantsA) return Buffer.concat([header, question]);
  const ip = ipFor(q.name).split('.').map(Number);
  const answer = Buffer.from([0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 30, 0, 4, ...ip]);
  return Buffer.concat([header, question, answer]);
}

const dns = createSocket('udp4');
dns.on('message', (msg, rinfo) => {
  if (msg.length < 13) return;
  const q = parseQuestion(msg);
  if (!q) return;
  record({ kind: 'dns', name: q.name, qtype: q.qtype });
  dns.send(dnsAnswer(msg, q), rinfo.port, rinfo.address);
});

// --- Fake servers ---------------------------------------------------------------

function looksLikeHttp(buf) {
  return /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) /.test(buf.subarray(0, 8).toString('latin1'));
}

function parseHttp(buf) {
  const text = buf.toString('utf8');
  const split = text.indexOf('\r\n\r\n');
  if (split < 0) return null;
  const lines = text.slice(0, split).split('\r\n');
  const [method, path] = lines[0].split(' ');
  const headers = {};
  for (const l of lines.slice(1)) {
    const c = l.indexOf(':');
    if (c > 0) headers[l.slice(0, c).toLowerCase()] = l.slice(c + 1).trim();
  }
  const body = text.slice(split + 4);
  const want = Number(headers['content-length'] || 0);
  return { method, path, headers, body, complete: Buffer.byteLength(body) >= want };
}

// Answer as the server would, record what was sent, and never go anywhere.
function serve(stream, dest, first, tlsInfo) {
  let data = first ?? Buffer.alloc(0);
  let done = false;

  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(idle);
    const http = looksLikeHttp(data) ? parseHttp(data) : null;
    record({
      kind: 'request',
      host: tlsInfo?.sni || http?.headers?.host || dest.host,
      dest,
      tls: Boolean(tlsInfo),
      http: http ? { method: http.method, path: http.path, headers: http.headers, body: http.body } : null,
      raw: http ? undefined : data.toString('latin1').slice(0, 4096),
      bytes: data.length,
    });
    if (http) {
      const body = '{"ok":true}';
      stream.write(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n${body}`);
    }
    stream.end();
  };

  const idle = setTimeout(finish, 1500);
  const check = () => {
    if (data.length >= MAX_CAPTURE) return finish();
    if (looksLikeHttp(data)) {
      const http = parseHttp(data);
      if (http?.complete) finish();
    }
  };
  stream.on('data', (chunk) => {
    if (data.length < MAX_CAPTURE) data = Buffer.concat([data, chunk]);
    check();
  });
  stream.on('end', finish);
  stream.on('error', () => { clearTimeout(idle); });
  check();
}

function handleTunnel(socket, dest) {
  socket.once('data', (first) => {
    if (first[0] !== 0x16) return serve(socket, dest, first, null);

    // TLS: present a certificate for whatever name the client asked for. A client that
    // trusts our CA will send us its request. One that doesn't still reveals the name.
    // TLSSocket reads a raw socket's handle directly and would miss the byte we already
    // consumed, so it gets a stream we control, with that first chunk put back.
    const pipe = new Duplex({
      read() {},
      write(chunk, enc, cb) { socket.write(chunk, enc, cb); },
      final(cb) { socket.end(cb); },
    });
    socket.on('data', (d) => pipe.push(d));
    socket.on('end', () => pipe.push(null));
    pipe.push(first);
    const info = { sni: null };
    const tls = new TLSSocket(pipe, {
      isServer: true,
      SNICallback: (name, cb) => {
        info.sni = name;
        try { cb(null, contextFor(name)); } catch (e) { cb(e); }
      },
      secureContext: contextFor(dest.host),
    });
    tls.on('secure', () => serve(tls, dest, null, info));
    tls.on('error', (err) => {
      record({ kind: 'tls-rejected', host: info.sni || dest.host, dest, reason: String(err.code || err.message) });
      socket.destroy();
    });
  });
}

// --- SOCKS5 ---------------------------------------------------------------------

function readDest(buf) {
  const atyp = buf[3];
  let host, offset;
  if (atyp === 1) {
    host = [...buf.subarray(4, 8)].join('.');
    offset = 8;
  } else if (atyp === 3) {
    const len = buf[4];
    host = buf.subarray(5, 5 + len).toString('latin1');
    offset = 5 + len;
  } else if (atyp === 4) {
    const parts = [];
    for (let i = 0; i < 16; i += 2) parts.push(buf.readUInt16BE(4 + i).toString(16));
    host = parts.join(':');
    offset = 20;
  } else {
    return null;
  }
  if (offset + 2 > buf.length) return null;
  const port = buf.readUInt16BE(offset);
  return { ip: atyp === 3 ? null : host, host: nameByIp.get(host) || host, port };
}

const REPLY_OK = Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
const REPLY_REFUSED = Buffer.from([5, 7, 0, 1, 0, 0, 0, 0, 0, 0]);

const socks = createServer((socket) => {
  socket.on('error', () => {});
  socket.once('data', (greeting) => {
    if (greeting[0] !== 5) return socket.destroy();
    socket.write(Buffer.from([5, 0])); // no authentication
    socket.once('data', (req) => {
      const dest = readDest(req);
      if (!dest) return socket.destroy();
      if (req[1] !== 1) {
        // UDP and BIND are refused, and recorded as attempts.
        record({ kind: 'refused', command: req[1], dest });
        socket.end(REPLY_REFUSED);
        return;
      }
      record({ kind: 'connect', dest });
      socket.write(REPLY_OK);
      handleTunnel(socket, dest);
    });
  });
});

// --- Start ----------------------------------------------------------------------

ensureCa();
await new Promise((ok) => dns.bind(DNS_PORT, '127.0.0.1', ok));
await new Promise((ok) => socks.listen(SOCKS_PORT, '127.0.0.1', ok));

// The control layer reads this line to learn the ports and the CA to trust.
console.log(JSON.stringify({ ready: true, socksPort: socks.address().port, dnsPort: dns.address().port, ca: CA_CERT }));

for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => process.exit(0));
