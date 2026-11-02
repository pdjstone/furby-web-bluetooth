// Furby Connect simulator engine.
// Reads the real Furby Connect personality files (eyes, sounds, action tables)
// straight from the public Furby-ReConnect/Furby GitHub repo, on demand.
'use strict';

const REPO = 'https://raw.githubusercontent.com/Furby-ReConnect/Furby/master/Furby-Files/Furby-NAND/Personalities/';

// File names differ in case between personalities, so list them exactly.
const PERSONALITIES = {
  Base:     { dir: 'Base',     apl: 'BASE.APL',     seq: 'BASE.SEQ',     xls: 'BASE.XLS',     amf: 'Base.AMF',     cel: 'Base.CEL',     pal: 'Base.PAL',     spr: 'Base.SPR', mtr: 'BASE.MTR' },
  Cat:      { dir: 'Cat',      apl: 'Cat.APL',      seq: 'Cat.SEQ',      xls: 'Cat.XLS',      amf: 'CAT.AMF',      cel: 'CAT.CEL',      pal: 'CAT.PAL',      spr: 'CAT.SPR', mtr: 'Cat.MTR' },
  DJ:       { dir: 'DJ',       apl: 'DJ.APL',       seq: 'DJ.SEQ',       xls: 'DJ.XLS',       amf: 'DJ.AMF',       cel: 'DJ.CEL',       pal: 'DJ.PAL',       spr: 'DJ.SPR', mtr: 'DJ.MTR' },
  Ninja:    { dir: 'Ninja',    apl: 'Ninja.APL',    seq: 'Ninja.SEQ',    xls: 'Ninja.XLS',    amf: 'NINJA.AMF',    cel: 'NINJA.CEL',    pal: 'NINJA.PAL',    spr: 'NINJA.SPR', mtr: 'Ninja.MTR' },
  Pirate:   { dir: 'Pirate',   apl: 'Pirate.APL',   seq: 'Pirate.SEQ',   xls: 'Pirate.XLS',   amf: 'Pirate.AMF',   cel: 'PIRATE.CEL',   pal: 'PIRATE.PAL',   spr: 'PIRATE.SPR', mtr: 'Pirate.MTR' },
  PopStar:  { dir: 'PopStar',  apl: 'Popstar.APL',  seq: 'PopStar.SEQ',  xls: 'Popstar.XLS',  amf: 'POPSTAR.AMF',  cel: 'POPSTAR.CEL',  pal: 'POPSTAR.PAL',  spr: 'POPSTAR.SPR', mtr: 'Popstar.MTR' },
  Princess: { dir: 'Princess', apl: 'Princess.APL', seq: 'Princess.SEQ', xls: 'Princess.XLS', amf: 'Princess.AMF', cel: 'Princess.CEL', pal: 'Princess.PAL', spr: 'Princess.SPR', mtr: 'Princess.MTR' },
};

// Action inputs (XLS index = Furby action "input" number minus 1).
const ACT = {
  HEAD: 0, BELLY: 1, BACK: 2, TAIL: 3, HUG: 4, FART: 6, TALK: 7, SHAKE: 8, UPSIDE: 9,
  ROCK: 11, FEED: 14, SING: 16, LOUD: 19, BORED: 23, WAKE: 26, SLEEP: 27, INTRO: 28, DLC: 74,
};

const FRAME_MS = 1000 / 15;   // eye animations run at 15 frames a second
const CEL_BYTES = 3072;

// ---------- fetching ----------
async function fetchBytes(url, start, end) {
  const opts = start === undefined ? {} : { headers: { Range: `bytes=${start}-${end}` } };
  for (let tries = 0; ; tries++) {
    try {
      const r = await fetch(url, opts);
      if (!r.ok) throw new Error(r.status + ' ' + url);
      return new Uint8Array(await r.arrayBuffer());
    } catch (e) {
      if (tries >= 2) throw e;
      await new Promise(res => setTimeout(res, 600 * (tries + 1)));
    }
  }
}
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

// SEQ / APL: u16 count, then u32 word offsets at `tableAt`; each list runs to the next offset.
function parseLists(b, tableAt) {
  const n = u16(b, 0), offs = [];
  for (let i = 0; i < n; i++) offs.push(u32(b, tableAt + i * 4));
  offs.push(b.length >> 1);
  const lists = [];
  for (let i = 0; i < n; i++) {
    const l = [];
    for (let w = offs[i]; w < offs[i + 1]; w++) l.push(u16(b, w * 2));
    lists.push(l);
  }
  return lists;
}

// XLS: action -> index -> sub -> record { items: [seq ids] }
function parseXLS(b) {
  const W = i => u16(b, i * 2), U = i => W(i) | (W(i + 1) << 16);
  const n0 = W(0), T = [];
  for (let a = 0; a < n0; a++) {
    const n1 = W(3 + a * 3), o1 = U(4 + a * 3), L1 = [];
    for (let i = 0; i < n1; i++) {
      const n2 = W(o1 + i * 3), o2 = U(o1 + i * 3 + 1), subs = [];
      for (let c = 0; c < n2; c++) {
        const r = o2 + c * 10, ni = W(r + 2), oi = U(r + 3), items = [];
        for (let k = 0; k < ni; k++) items.push(W(oi + k * 5));
        subs.push({ chance: W(r + 1), items });
      }
      L1.push(subs);
    }
    T.push(L1);
  }
  return T;
}

// SPR: entries of 14 bytes {u16 frames, u32 frame table (words), u32 e2, u32 e3}; frame = 9 u16.
function parseSPR(b) {
  const ents = [];
  let m = b.length;
  for (let i = 0; i * 14 < m; i++) {
    const n = u16(b, i * 14), t = u32(b, i * 14 + 2) * 2, e2 = u32(b, i * 14 + 6);
    const frames = [];
    for (let f = 0; f < n; f++) {
      const o = u32(b, t + f * 4) * 2;
      m = Math.min(m, o);
      const w = [];
      for (let k = 0; k < 8; k++) w.push(u16(b, o + k * 2));
      frames.push(w);
    }
    ents.push({ n, e2, frames });
  }
  return ents;
}

function parsePAL(b, fur) {
  const pals = [];
  for (let p = 0; p * 128 < b.length; p++) {
    const pal = new Uint32Array(64);
    const raw = [];
    for (let i = 0; i < 64; i++) raw.push(u16(b, p * 128 + i * 2));
    // Palettes whose colours 1-3 are pure green/red/blue are placeholders the toy
    // fills with the Furby's fur colour (they draw the eyelids).
    const placeholder = raw[1] === 0x03E0 && (raw[2] & 0x7C00) === 0x7C00 && raw[3] === 0x001F;
    for (let i = 0; i < 64; i++) {
      const w = raw[i];
      if (w & 0x8000) { pal[i] = 0; continue; }
      let r = ((w >> 10) & 31) << 3, g = ((w >> 5) & 31) << 3, bl = (w & 31) << 3;
      if (placeholder && i >= 1 && i <= 3) [r, g, bl] = fur[i - 1];
      pal[i] = (255 << 24) | (bl << 16) | (g << 8) | r;   // little-endian RGBA
    }
    pals.push(pal);
  }
  return pals;
}

function decodeCel(buf, off) {
  const px = new Uint8Array(4096);
  if (off + CEL_BYTES > buf.length) return px;
  for (let i = 0, j = 0; i < CEL_BYTES; i += 3, j += 4) {
    const x = buf[off + i], y = buf[off + i + 1], z = buf[off + i + 2];
    px[j] = x >> 2; px[j + 1] = ((x & 3) << 4) | (y >> 4); px[j + 2] = ((y & 15) << 2) | (z >> 6); px[j + 3] = z & 63;
  }
  return px;
}

// MTR: lists of motor moves. A word 0x20nn..0x23nn is a cam position (0-476),
// 0x28nn..0x2Bnn how long to take (x10 ms). Lists end in 0xF000.
function parseMTR(b) {
  const lists = parseLists(b, 6);
  return lists.map(l => {
    const steps = []; let pos = null;
    for (const w of l) {
      const c = w >> 10, v = w & 0x3FF;
      if (c === 8) pos = v;
      else if (c === 10 && pos !== null) { steps.push([pos, v * 10]); pos = null; }
    }
    if (pos !== null) steps.push([pos, 200]);
    return steps;
  });
}

// DLC: "FURBY" header, then up to 16 directory entries naming each section and its size.
function parseDLC(data) {
  const name = String.fromCharCode(...Array.from({ length: 5 }, (_, i) => u16(data, i * 2)));
  if (name !== 'FURBY') throw new Error('That is not a Furby Connect DLC file');
  const raw = {}; let cur = 0x288;
  for (let i = 0; i < 16; i++) {
    const p = 40 + i * 38;
    const tag = String.fromCharCode(...Array.from({ length: 9 }, (_, k) => u16(data, p + k * 2)));
    if (tag !== 'DLC_0000.') continue;
    const sec = String.fromCharCode(u16(data, p + 18), u16(data, p + 20), u16(data, p + 22));
    const size = u32(data, p + 30);
    raw[sec] = data.subarray(cur, cur + size); cur += size;
  }
  return raw;
}

// ---------- graphics set (one SPR/PAL/CEL trio) ----------
class GfxSet {
  constructor(p, fur, mem) { this.p = p; this.fur = fur; this.mem = mem; this.cels = new Map(); this.pending = new Map(); }
  async load() {
    const [spr, pal] = this.mem ? [this.mem.SPR, this.mem.PAL] :
      await Promise.all([fetchBytes(REPO + this.p.dir + '/' + this.p.spr), fetchBytes(REPO + this.p.dir + '/' + this.p.pal)]);
    this.ents = parseSPR(spr);
    this.palRaw = pal;
    this.pals = parsePAL(pal, this.fur);
    this.anims = this.ents.length >> 3;
  }
  setFur(fur) { this.fur = fur; this.pals = parsePAL(this.palRaw, fur); }
  celsFor(anim) {
    const s = new Set();
    for (let e = anim * 8; e < anim * 8 + 8 && e < this.ents.length; e++)
      for (const f of this.ents[e].frames)
        for (let q = 0; q < 4; q++) if (!(f[q * 2 + 1] & 4)) s.add(f[q * 2]);
    return s;
  }
  // Fetch every cel needed by these animations, merging neighbours into few range requests.
  async ensure(anims) {
    const need = new Set();
    for (const a of anims) if (a >= 0 && a < this.anims) for (const c of this.celsFor(a)) if (!this.cels.has(c)) need.add(c);
    if (this.mem) { for (const c of need) this.cels.set(c, decodeCel(this.mem.CEL, c * CEL_BYTES)); return; }
    const waits = [];
    const list = [...need].filter(c => { if (this.pending.has(c)) { waits.push(this.pending.get(c)); return false; } return true; }).sort((a, b) => a - b);
    const runs = [];
    for (const c of list) {
      const r = runs[runs.length - 1];
      if (r && c - r[1] <= 6 && c - r[0] < 96) r[1] = c; else runs.push([c, c]);
    }
    for (const [a, b] of runs) {
      const pr = fetchBytes(REPO + this.p.dir + '/' + this.p.cel, a * CEL_BYTES, (b + 1) * CEL_BYTES - 1).then(buf => {
        for (let c = a; c <= b; c++) {
          const off = (c - a) * CEL_BYTES;
          if (off + CEL_BYTES > buf.length) break;
          this.cels.set(c, decodeCel(buf, off));
          this.pending.delete(c);
        }
      });
      for (let c = a; c <= b; c++) this.pending.set(c, pr);
      waits.push(pr);
    }
    await Promise.all(waits);
  }
  // Eye colour bank merged onto palette 6, keeping palette 6's see-through colours.
  irisPal(eyePal) {
    if (this._irisSrc === eyePal) return this._iris;
    const base = this.pals[6], out = new Uint32Array(64);
    for (let i = 0; i < 64; i++) out[i] = base[i] ? (eyePal[i] || base[i]) : 0;
    this._irisSrc = eyePal; this._iris = out;
    return out;
  }
  frameCount(anim) { const e = this.ents[anim * 8]; return e ? e.n : 0; }
  // Draw frame `fr` of `anim` for eye `side` (0 left, 1 right) into a 128x128 Uint32 buffer.
  draw(buf, anim, fr, side, eyePal) {
    for (let L = 0; L < 4; L++) {
      const e = this.ents[anim * 8 + L * 2 + side];
      if (!e || !e.n) continue;
      const f = e.frames[Math.max(0, Math.min(fr, e.n - 1))];
      for (let q = 0; q < 4; q++) {
        const cel = f[q * 2], ref = f[q * 2 + 1];
        if (ref & 4) continue;
        const px = this.cels.get(cel);
        if (!px) continue;
        let p = ((e.e2 & 0xFFFF) >> 6) + (ref >> 10) - 6;
        p = ((p % this.pals.length) + this.pals.length) % this.pals.length;
        // Layer 0 palette 6 of the base set is the iris: swap in the chosen eye colour.
        const pal = (eyePal && this.isBase && L === 0 && p === 6) ? this.irisPal(eyePal) : this.pals[p];
        const ox = (q & 1) * 64, oy = (q >> 1) * 64;
        for (let y = 0; y < 64; y++) {
          let d = (oy + y) * 128 + ox, s = y * 64;
          for (let x = 0; x < 64; x++, d++, s++) { const c = pal[px[s]]; if (c) buf[d] = c; }
        }
      }
    }
  }
}

// ---------- audio ----------
class Voice {
  constructor() {
    this.ctx = null;
    this.worker = new Worker('a18worker.js');
    this.jobs = new Map(); this.nextId = 1;
    this.worker.onmessage = e => { const j = this.jobs.get(e.data.id); this.jobs.delete(e.data.id); e.data.error ? j.rej(new Error(e.data.error)) : j.res(e.data.pcm); };
    this.playing = new Set();
    this.level = 0;
  }
  start() {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }
  decode(bytes) {
    const id = this.nextId++;
    return new Promise((res, rej) => { this.jobs.set(id, { res, rej }); this.worker.postMessage({ id, buf: bytes.buffer }, [bytes.buffer]); });
  }
  toClip(pcm) {
    const buf = this.ctx.createBuffer(1, Math.max(1, pcm.length), 16000);
    const ch = buf.getChannelData(0);
    const env = new Float32Array(Math.ceil(pcm.length / 320));
    for (let i = 0; i < pcm.length; i++) { const v = pcm[i] / 32768; ch[i] = v; env[(i / 320) | 0] += v * v; }
    for (let i = 0; i < env.length; i++) env[i] = Math.min(1, Math.sqrt(env[i] / 320) * 4);
    return { buf, env };
  }
  play(clip) {
    return new Promise(res => {
      const src = this.ctx.createBufferSource();
      src.buffer = clip.buf; src.connect(this.ctx.destination);
      const t0 = this.ctx.currentTime;
      const h = { src, clip, t0 };
      this.playing.add(h);
      src.onended = () => { this.playing.delete(h); res(); };
      src.start();
    });
  }
  stopAll() { for (const h of this.playing) { try { h.src.stop(); } catch (e) {} } this.playing.clear(); }
  currentLevel() {
    let lv = 0;
    for (const h of this.playing) {
      const i = Math.floor((this.ctx.currentTime - h.t0) * 50);
      if (i >= 0 && i < h.clip.env.length) lv = Math.max(lv, h.clip.env[i]);
    }
    return lv;
  }
}

// Sound bank: one APL (playlists) + AMF (tracks), tracks fetched by range on demand.
class SoundBank {
  constructor(p, voice, mem) { this.p = p; this.voice = voice; this.mem = mem; this.clips = new Map(); }
  async load() {
    if (this.mem) {
      const apl = this.mem.APL, amf = this.mem.AMF;
      this.apl = parseLists(apl, 8);
      this.aplStart = (u16(apl, 2) - u16(apl, 0)) & 0xFFFF;
      const n = u32(amf, 0); this.offs = [];
      for (let i = 0; i < n; i++) this.offs.push(u32(amf, 4 + i * 4));
      return;
    }
    const apl = await fetchBytes(REPO + this.p.dir + '/' + this.p.apl);
    this.apl = parseLists(apl, 8);
    this.aplStart = (u16(apl, 2) - u16(apl, 0)) & 0xFFFF;
    if (this.aplStart > 4000) this.aplStart = 0;
    const url = REPO + this.p.dir + '/' + this.p.amf;
    const head = await fetchBytes(url, 0, 3);
    const n = u32(head, 0);
    const tab = await fetchBytes(url, 0, 4 + n * 4 - 1);
    this.offs = []; for (let i = 0; i < n; i++) this.offs.push(u32(tab, 4 + i * 4));
    this.sorted = [...this.offs].sort((a, b) => a - b);
  }
  async clip(track) {
    if (track >= this.offs.length) return null;
    if (this.clips.has(track)) return this.clips.get(track);
    const pr = (async () => {
      const off = this.offs[track];
      if (this.mem) {
        const len = u32(this.mem.AMF, off);
        if (!len || off + 6 + len > this.mem.AMF.length) return null;
        return this.voice.toClip(await this.voice.decode(this.mem.AMF.slice(off, off + 6 + len)));
      }
      const url = REPO + this.p.dir + '/' + this.p.amf;
      const hdr = await fetchBytes(url, off, off + 5);
      const len = u32(hdr, 0);
      if (!len || len > 2000000) return null;
      const bytes = await fetchBytes(url, off, off + 6 + len - 1);
      const pcm = await this.voice.decode(bytes);
      return this.voice.toClip(pcm);
    })().catch(() => null);
    this.clips.set(track, pr);
    return pr;
  }
  // A playlist is AMF track numbers with 0x1nnn pauses, ended by 0xF000.
  tracksOf(list) { return (this.apl[list] || []).filter(w => w < 0x1000); }
}

// ---------- the Furby ----------
class Furby {
  constructor(ui) {
    this.ui = ui;            // { leftCanvas, rightCanvas, onMove(kind, amount), onStatus(text), onBusy(bool) }
    this.voice = new Voice();
    this.fur = [[46, 196, 182], [24, 120, 112], [140, 232, 220]];
    this.ctxL = ui.leftCanvas.getContext('2d'); this.ctxR = ui.rightCanvas.getContext('2d');
    this.imgL = this.ctxL.createImageData(128, 128); this.imgR = this.ctxR.createImageData(128, 128);
    this.bufL = new Uint32Array(this.imgL.data.buffer); this.bufR = new Uint32Array(this.imgR.data.buffer);
    this.eye = null;         // { gfx, anim, start, hold }
    this.busy = false; this.asleep = false; this.token = 0;
    this.lastAction = performance.now();
    this.recent = [];
    this.personality = 'Base';
    requestAnimationFrame(t => this.tick(t));
  }

  async init() {
    this.ui.onStatus('Waking up Furby…');
    this.base = { gfx: new GfxSet(PERSONALITIES.Base, this.fur), snd: new SoundBank(PERSONALITIES.Base, this.voice) };
    this.base.gfx.isBase = true;
    const [seq, xls, mtr] = await Promise.all([
      fetchBytes(REPO + 'Base/' + PERSONALITIES.Base.seq), fetchBytes(REPO + 'Base/' + PERSONALITIES.Base.xls),
      fetchBytes(REPO + 'Base/BASE.MTR'),
      this.base.gfx.load(), this.base.snd.load(),
    ]);
    this.base.seq = parseLists(seq, 6); this.base.xls = parseXLS(xls); this.base.mtr = parseMTR(mtr);
    this.idleAnims = [1, 5, 6, 7, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21].filter(a => a < this.base.gfx.anims);
    await this.base.gfx.ensure([1, 7]);
    this.base.gfx.ensure(this.idleAnims);
    this.pers = null;
    this.setEye(this.base.gfx, 1, true);
    this.ui.onStatus('');
  }

  async setPersonality(name) {
    const tok = ++this.token;
    this.voice.stopAll(); this.busy = false;
    this.personality = name;
    if (name === 'Base') { this.pers = null; this.ui.onStatus(''); if (!this.asleep) this.act(ACT.HEAD, { force: true }); return; }
    this.ui.onStatus('Loading ' + name + '…');
    const p = PERSONALITIES[name];
    const pers = { name, gfx: new GfxSet(p, this.fur), snd: new SoundBank(p, this.voice) };
    const [seq, xls, mtr] = await Promise.all([fetchBytes(REPO + p.dir + '/' + p.seq), fetchBytes(REPO + p.dir + '/' + p.xls),
      fetchBytes(REPO + p.dir + '/' + p.mtr), pers.gfx.load(), pers.snd.load()]);
    pers.seq = parseLists(seq, 6); pers.xls = parseXLS(xls); pers.mtr = parseMTR(mtr);
    if (tok !== this.token) return;
    this.pers = pers;
    this.ui.onStatus('');
    // Picking a personality plays its intro (action 29 in the personality's table).
    if (!this.asleep) {
      const intro = this.pickFrom(pers, ACT.INTRO, 0);
      if (intro) this.runSeq(intro.seq); else this.act(ACT.HEAD, { force: true });
    }
  }

  setFur(fur) {
    this.fur = fur;
    this.base && this.base.gfx.setFur(fur);
    this.pers && this.pers.gfx.setFur(fur);
  }

  setEye(gfx, anim, hold) { this.eye = { gfx, anim, start: performance.now(), hold }; }

  // The iris colour: each personality has its own, the plain Furby has blue eyes.
  get eyePal() {
    if (this.pers && this.pers.gfx.pals.length > 1) return this.pers.gfx.pals[1];
    return this.base.gfx.pals[this.eyeBank || 8];
  }

  pickFrom(t, input, idx) {
    const A = t.xls[input];
    if (!A || !A[idx] || !A[idx].length) return null;
    const items = A[idx][0].items.filter(id => (id >> 12) === 2 || id < 0x1000);
    if (!items.length) return null;
    return this.resolve(items[Math.floor(Math.random() * items.length)]);
  }

  resolve(id) {
    if ((id >> 12) === 1 && this.dlc) return { seq: this.dlc.seq[id - 0x1000], own: this.dlc };
    if (id >= 0x2000 && id < 0x3000 && this.pers) return { seq: this.pers.seq[id - 0x2000], own: this.pers };
    if (id < 0x1000) return { seq: this.base.seq[id], own: this.base };
    return null;
  }

  // Pick a reaction for an action input, the way the toy's XLS table does.
  pickSeq(input) {
    const tables = this.pers ? [this.pers, this.base] : [this.base];
    if (this.dlc && input === ACT.DLC) tables.unshift(this.dlc);
    for (const t of tables) {
      const A = t.xls[input];
      if (!A || !A.length) continue;
      // index = mood; mostly happy/excited, sometimes grumpy or sleepy
      let idx = 0;
      if (A.length > 1) {
        const r = Math.random();
        idx = A.length >= 4 ? (r < 0.4 ? 0 : r < 0.8 ? 3 : r < 0.9 ? 1 : 2) : Math.floor(r * A.length);
        idx = Math.min(idx, A.length - 1);
      }
      const subs = A[idx];
      if (!subs.length) continue;
      const sub = subs[Math.floor(Math.random() * subs.length)];
      let items = sub.items.filter(id => (id >> 12) !== 0xF && ((id >> 12) !== 1 || this.dlc));
      if (!items.length) continue;
      const fresh = items.filter(id => !this.recent.includes(t === this.base ? id : id | 0x10000));
      if (fresh.length) items = fresh;
      const id = items[Math.floor(Math.random() * items.length)];
      this.recent.push(t === this.base ? id : id | 0x10000); if (this.recent.length > 12) this.recent.shift();
      const r = this.resolve(id);
      if (r && r.seq) return r;
    }
    return null;
  }

  // ----- DLC -----
  async loadDLC(bytes, name) {
    const raw = parseDLC(bytes);
    const dlc = { name, gfx: new GfxSet(null, this.fur, raw), snd: new SoundBank(null, this.voice, raw) };
    await Promise.all([dlc.gfx.load(), dlc.snd.load()]);
    dlc.seq = parseLists(raw.SEQ, 6); dlc.xls = parseXLS(raw.XLS); dlc.mtr = raw.MTR ? parseMTR(raw.MTR) : [];
    this.dlc = dlc;
    return this.dlcActions();
  }
  // Every DLC action (75 / 0 / a / b) that has a sequence.
  dlcActions() {
    const out = [], A = this.dlc && this.dlc.xls[ACT.DLC];
    if (!A || !A[0]) return out;
    A[0].forEach((sub, a) => sub.items.forEach((id, b) => { if ((id >> 12) === 1) out.push([75, 0, a, b]); }));
    return out;
  }
  async playDLC(action) {
    if (!this.dlc || this.asleep) return;
    const [, i, a, b] = action;
    const A = this.dlc.xls[ACT.DLC];
    const sub = A && A[i] && A[i][a];
    const id = sub && sub.items[b];
    const r = id !== undefined && this.resolve(id);
    if (r && r.seq) { this.lastAction = performance.now(); await this.runSeq(r.seq); }
  }

  // Resolve an eye-animation word to a graphics set + animation number.
  eyeOf(w) {
    const hi = w >> 8, n = w & 0xFF;
    if (hi === 0x80) return { gfx: this.base.gfx, anim: n };
    if (hi === 0x86 && this.pers) return { gfx: this.pers.gfx, anim: n };
    if (hi === 0x84 && this.dlc) return { gfx: this.dlc.gfx, anim: n };
    if ((w >> 12) === 0xA) return { gfx: this.base.gfx, anim: this.idleAnims[n % this.idleAnims.length] };
    return null;
  }
  motorOf(id) {
    if (this.pers && id >= 0x600 && this.pers.mtr[id - 0x600]) return this.pers.mtr[id - 0x600];
    if (this.base.mtr[id]) return this.base.mtr[id];
    if (this.dlc && this.dlc.mtr.length) return this.dlc.mtr[id % this.dlc.mtr.length];
    return null;
  }
  audioOf(w) {
    const id = w & 0xFFF;
    if (this.dlc && id >= this.dlc.snd.aplStart && id < this.dlc.snd.aplStart + this.dlc.snd.apl.length) return { snd: this.dlc.snd, list: id - this.dlc.snd.aplStart };
    if (this.pers && id >= this.pers.snd.aplStart && this.pers.snd.aplStart > 0) return { snd: this.pers.snd, list: id - this.pers.snd.aplStart };
    return { snd: this.base.snd, list: id };
  }

  async act(input, opts = {}) {
    if (!this.base) return;
    if (this.busy && !opts.force && performance.now() - this.seqStart < 1500) { this.ui.onMove('nudge', 1); return; }
    if (this.asleep && !opts.whileAsleep) return;
    const pick = this.pickSeq(input);
    if (!pick || !pick.seq) return;
    this.lastAction = performance.now();
    await this.runSeq(pick.seq, opts);
  }

  async runSeq(seq, opts = {}) {
    const tok = ++this.token;
    this.voice.stopAll();
    this.seqStart = performance.now();
    this.busy = true; this.ui.onBusy(true);
    try {
      // Pre-load everything the sequence uses so it plays in time.
      const eyes = new Map(), audio = [];
      for (const w of seq) {
        const k = w >> 12;
        if (k === 8 || k === 0xA) { const e = this.eyeOf(w); if (e) { if (!eyes.has(e.gfx)) eyes.set(e.gfx, []); eyes.get(e.gfx).push(e.anim); } }
        if (k === 4) audio.push(this.audioOf(w));
      }
      const clipLoads = [];
      for (const a of audio) for (const t of a.snd.tracksOf(a.list)) clipLoads.push(a.snd.clip(t));
      const slow = setTimeout(() => this.ui.onStatus('Loading…'), 500);
      await Promise.all([...[...eyes].map(([g, l]) => g.ensure(l)), ...clipLoads]);
      clearTimeout(slow); this.ui.onStatus('');
      if (tok !== this.token) return;

      const sounds = [];
      for (const w of seq) {
        if (tok !== this.token) return;
        const k = w >> 12, v = w & 0xFFF;
        if (w === 0) break;
        if (k === 1) await this.sleepMs(v * 10);
        else if (k === 4) sounds.push(this.playList(this.audioOf(w), tok));
        else if (k === 8 || k === 0xA) { const e = this.eyeOf(w); if (e && e.anim < e.gfx.anims) this.setEye(e.gfx, e.anim, true); }
        else if (k === 0xC) { const m = this.motorOf(v); if (m && m.length) this.ui.onMove('motor', m); }
      }
      await Promise.all(sounds);
      if (tok !== this.token) return;
      // let the last eye animation finish
      if (this.eye) {
        const left = this.eye.gfx.frameCount(this.eye.anim) * FRAME_MS - (performance.now() - this.eye.start);
        if (left > 0) await this.sleepMs(Math.min(left, 4000));
      }
    } finally {
      if (tok === this.token) {
        this.busy = false; this.ui.onBusy(false);
        if (!opts.stayEyes) this.setEye(this.base.gfx, 1, true);
        this.lastAction = performance.now();
      }
    }
  }

  async playList(a, tok) {
    const list = a.snd.apl[a.list] || [];
    for (const w of list) {
      if (tok !== this.token) return;
      if (w === 0xF000) break;
      if ((w >> 12) === 1) { await this.sleepMs((w & 0xFFF) * 10); continue; }
      if (w >= 0x1000) continue;
      const clip = await a.snd.clip(w);
      if (clip && tok === this.token) await this.voice.play(clip);
    }
  }

  sleepMs(ms) { return new Promise(r => setTimeout(r, ms)); }

  async maskOn() {
    if (this.asleep) return;
    this.asleep = true;
    this.lastAction = performance.now();
    const pick = this.pickSeq(ACT.SLEEP);
    if (pick && pick.seq) await this.runSeq(pick.seq, { stayEyes: true });
    this.voice.stopAll();
  }

  async maskOff() {
    if (!this.asleep) return;
    this.asleep = false;
    this.token++; this.busy = false;
    await this.act(ACT.WAKE, { force: true });
  }

  tick(t) {
    // idle life: blink, glance around, get bored
    if (this.eye && this.base && !this.busy && !this.asleep) {
      if (!this.nextIdle) this.nextIdle = t + 3000;
      const done = t - this.eye.start > this.eye.gfx.frameCount(this.eye.anim) * FRAME_MS;
      if (done && t > this.nextIdle) {
        this.nextIdle = t + 2500 + Math.random() * 4500;
        const a = Math.random() < 0.65 ? 1 : this.idleAnims[Math.floor(Math.random() * this.idleAnims.length)];
        if (this.base.gfx.celsFor(a).size && [...this.base.gfx.celsFor(a)].every(c => this.base.gfx.cels.has(c))) this.setEye(this.base.gfx, a, true);
      }
      if (t - this.lastAction > 45000) { this.lastAction = t; this.act(ACT.BORED); }
    }
    try { this.render(t); } catch (err) { console.error(err); }
    this.ui.onMove('level', this.voice.ctx ? this.voice.currentLevel() : 0);
    requestAnimationFrame(t2 => this.tick(t2));
  }

  render(t) {
    const e = this.eye;
    this.bufL.fill(0xFFFFFFFF); this.bufR.fill(0xFFFFFFFF);
    if (e) {
      const n = e.gfx.frameCount(e.anim);
      let fr = Math.max(0, Math.floor((t - e.start) / FRAME_MS));
      fr = e.hold ? Math.min(fr, n - 1) : fr % n;
      const ep = this.eyePal;
      e.gfx.draw(this.bufL, e.anim, fr, 0, ep);
      e.gfx.draw(this.bufR, e.anim, fr, 1, ep);
    }
    this.ctxL.putImageData(this.imgL, 0, 0); this.ctxR.putImageData(this.imgR, 0, 0);
  }
}

window.FurbySim = { Furby, ACT, PERSONALITIES };
