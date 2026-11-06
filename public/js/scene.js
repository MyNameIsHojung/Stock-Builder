// Construction-site animation engine (Canvas 2D).
import { getSprite } from './assets.js';

export const LEVELS = {
  4: { label: '폭풍 건설', emoji: '🎉', desc: '모두가 신나서 미친 듯이 짓고 있어요! 폭죽 팡팡', speed: 2.2 },
  3: { label: '열심히 건설', emoji: '🔨', desc: '크레인까지 동원해서 열심히 올리는 중', speed: 1.7 },
  2: { label: '건설 중', emoji: '🧱', desc: '벽돌을 나르며 차곡차곡 쌓는 중', speed: 1.15 },
  1: { label: '느긋한 공사', emoji: '🚶', desc: '천천히, 느긋하게 한 층씩', speed: 0.6 },
  0: { label: '쉬는 중', emoji: '☕', desc: '변동 없음. 일꾼이 커피 마시며 쉬는 중', speed: 0.35 },
  '-1': { label: '조금 부수기', emoji: '🪓', desc: '망치로 벽을 조금씩 깨는 중', speed: 0.6 },
  '-2': { label: '철거 중', emoji: '🚜', desc: '굴삭기가 와서 본격 철거 시작', speed: 1.1 },
  '-3': { label: '대규모 철거', emoji: '💥', desc: '먼지 구름 속 대규모 철거반 투입', speed: 1.6 },
  '-4': { label: '폭파!', emoji: '🧨', desc: '건물 폭파! 잔해만 남았어요', speed: 2.0 },
};

const BASE_FLOORS = 6;
const MAX_FLOORS = 14;

export function levelFor(pct, tiers) {
  if (pct == null || !Number.isFinite(pct)) return 0;
  const a = Math.abs(pct);
  if (a < 0.05) return 0;
  const n = a >= tiers[2] ? 4 : a >= tiers[1] ? 3 : a >= tiers[0] ? 2 : 1;
  return pct > 0 ? n : -n;
}

export function floorsFor(pct, tiers) {
  if (pct == null || !Number.isFinite(pct)) return BASE_FLOORS;
  const f = Math.round(BASE_FLOORS + (pct / tiers[2]) * BASE_FLOORS);
  return Math.max(0, Math.min(MAX_FLOORS, f));
}

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function seeded(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

export class Scene {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.t = Math.random() * 10;
    this.particles = [];
    this.workers = [];
    this.level = null;
    this.floors = BASE_FLOORS;
    this.progress = Math.random();
    this.shake = 0;
    this.timers = { fw: 0, boom: 1.5, brick: 0, dust: 0 };
    this.seed = Math.floor(Math.random() * 1e6);
    this.clouds = Array.from({ length: 3 }, () => ({ x: Math.random(), y: rand(0.05, 0.3), s: rand(0.6, 1.2), v: rand(0.004, 0.012) }));
    this.W = 0;
    this.H = 0;
    this.resize();
  }

  setData(pct, tiers) {
    const level = levelFor(pct, tiers);
    this.floors = floorsFor(pct, tiers);
    if (level !== this.level) {
      this.level = level;
      this.cfg = LEVELS[level];
      this.particles = [];
      this.spawnWorkers();
    }
  }

  resize() {
    const r = this.c.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(r.width * dpr));
    const h = Math.max(1, Math.round(r.height * dpr));
    if (this.c.width !== w || this.c.height !== h) {
      this.c.width = w;
      this.c.height = h;
    }
    this.dpr = dpr;
    this.W = r.width;
    this.H = r.height;
  }

  spawnWorkers() {
    const L = this.level;
    const ws = [];
    const add = (role, place, x, extra = {}) =>
      ws.push({ role, place, x, dir: Math.random() < 0.5 ? 1 : -1, phase: Math.random() * 6.28, acc: Math.random(), ...extra });
    if (L === 0) {
      add('idle', 'ground', 0.3);
    } else if (L > 0) {
      const top = L >= 3 ? 2 : 1;
      for (let i = 0; i < top; i++) add('hammer', 'top', top === 1 ? 0.5 : 0.25 + i * 0.5);
      const carriers = L === 1 ? 1 : 2;
      for (let i = 0; i < carriers; i++) add('carry', 'left', Math.random());
      if (L === 4) {
        add('cheer', 'right', 0.3);
        add('cheer', 'right', 0.75);
      }
    } else {
      const a = -L;
      if (a <= 3) for (let i = 0; i < (a >= 2 ? 2 : 1); i++) add('hammer', 'top', a >= 2 ? 0.25 + i * 0.5 : 0.5);
      if (a === 1) add('carry', 'right', Math.random());
      if (a >= 3) for (let i = 0; i < (a === 4 ? 3 : 1); i++) add('panic', 'all', Math.random());
    }
    this.workers = ws;
  }

  layout() {
    const W = this.W, H = this.H, L = this.level;
    const groundY = H * 0.86;
    const top = H * 0.22;
    const fs = getSprite('floor');
    const aspect = fs ? fs.w / fs.h : 3;
    const slots = Math.max(this.floors + 1.8, 9);
    let fh = (groundY - top) / slots;
    let bw = fh * aspect;
    if (bw > W * 0.42) {
      bw = W * 0.42;
      fh = bw / aspect;
    }
    const center = L >= 3 ? W * 0.42 : L <= -2 ? W * 0.58 : W * 0.5;
    const bx = center - bw / 2;
    const ws = clamp(fh * 1.35, 16, H * 0.2);
    return { W, H, groundY, fh, bw, bx, ws, top };
  }

  // ---------- particles ----------
  emit(p) {
    if (this.particles.length > 400) return;
    this.particles.push({ vx: 0, vy: 0, g: 0, rot: 0, vr: 0, ...p, maxLife: p.life });
  }

  burst(x, y, n, kind, opts = {}) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(opts.minSp ?? 20, opts.maxSp ?? 90);
      this.emit({
        kind, x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (opts.up ?? 0),
        g: opts.g ?? 0, life: rand(opts.minLife ?? 0.4, opts.maxLife ?? 0.9),
        size: rand(opts.minSize ?? 1.5, opts.maxSize ?? 3.5),
        color: opts.colors ? opts.colors[Math.floor(Math.random() * opts.colors.length)] : opts.color,
        rot: rand(0, 6), vr: rand(-6, 6),
      });
    }
  }

  // ---------- update ----------
  update(dt) {
    if (!this.cfg) return;
    const L = this.level, sp = this.cfg.speed;
    const lay = this.layout();
    this.t += dt;
    this.shake = Math.max(0, this.shake - dt);
    for (const c of this.clouds) {
      c.x += c.v * dt * (L < 0 ? 2 : 1);
      if (c.x > 1.2) c.x = -0.2;
    }

    // building progress (top floor rising or crumbling)
    if (L !== 0) {
      this.progress += dt * sp * 0.22;
      if (this.progress >= 1) {
        this.progress = 0;
        const topY = lay.groundY - this.floors * lay.fh;
        if (L > 0) this.burst(lay.bx + lay.bw / 2, topY - lay.fh, 14, 'confetti', { colors: ['#ffd23f', '#ff6b6b', '#4ecdc4', '#ffffff'], g: 120, up: 60, maxSize: 4 });
        else this.burst(lay.bx + lay.bw / 2, topY, 10, 'dust', { color: '#b8a99a', minSp: 8, maxSp: 30, minSize: 6, maxSize: 14, maxLife: 1.4 });
      }
    }

    // workers
    for (const w of this.workers) {
      if (w.role === 'carry' || w.role === 'panic') {
        const v = w.role === 'panic' ? 0.45 : 0.12 * sp + 0.03;
        w.x += w.dir * v * dt;
        if (w.x > 1) { w.x = 1; w.dir = -1; }
        if (w.x < 0) { w.x = 0; w.dir = 1; }
        if (w.role === 'panic' && Math.random() < dt * 0.6) w.dir *= -1;
      }
      if (w.role === 'hammer') {
        w.acc += dt * sp * 1.6;
        if (w.acc >= 1) {
          w.acc -= 1;
          const pos = this.workerPos(w, lay);
          const hx = pos.x + lay.ws * 0.35 * (w.dir > 0 ? 1 : -1);
          if (L > 0) this.burst(hx, pos.y - lay.ws * 0.15, 5, 'spark', { color: '#ffe066', minSp: 30, maxSp: 80, maxLife: 0.35, maxSize: 2.5 });
          else this.burst(hx, pos.y - lay.ws * 0.1, 3, 'brick', { color: '#c0553a', g: 300, up: 60, minSp: 20, maxSp: 70, minLife: 0.8, maxLife: 1.4, minSize: 2.5, maxSize: 4.5 });
        }
      }
    }

    // ambient effects
    const T = this.timers;
    if (L === 4) {
      T.fw -= dt;
      if (T.fw <= 0) {
        T.fw = rand(0.5, 1.1);
        this.burst(rand(lay.W * 0.15, lay.W * 0.85), rand(lay.H * 0.12, lay.H * 0.4), 26, 'fw', {
          colors: ['#ff4d6d', '#ffd23f', '#4cc9f0', '#80ed99', '#c77dff'], minSp: 30, maxSp: 110, g: 40, minLife: 0.7, maxLife: 1.3, maxSize: 3,
        });
      }
    }
    if (L <= -2 && this.floors > 0) {
      T.brick -= dt;
      if (T.brick <= 0) {
        T.brick = rand(0.15, 0.5) / sp;
        const topY = lay.groundY - this.floors * lay.fh;
        this.emit({ kind: 'brick', x: rand(lay.bx, lay.bx + lay.bw), y: topY + rand(0, lay.fh), vx: rand(-30, 30), vy: rand(-20, 10), g: 320, life: 1.6, size: rand(2.5, 5), color: Math.random() < 0.5 ? '#c0553a' : '#8d8d8d', rot: rand(0, 6), vr: rand(-6, 6) });
      }
    }
    if (L <= -3) {
      T.dust -= dt;
      if (T.dust <= 0) {
        T.dust = rand(0.08, 0.2);
        this.emit({ kind: 'dust', x: rand(lay.bx - lay.bw * 0.3, lay.bx + lay.bw * 1.3), y: lay.groundY - rand(0, lay.fh), vx: rand(-15, 15), vy: rand(-25, -8), life: rand(1.2, 2.2), size: rand(8, 18), color: '#a89887' });
      }
    }
    if (L === -4) {
      T.boom -= dt;
      if (T.boom <= 0) {
        T.boom = rand(2.5, 4);
        this.shake = 0.45;
        const cx = lay.bx + lay.bw / 2, cy = lay.groundY - lay.fh;
        this.emit({ kind: 'flash', x: cx, y: cy, life: 0.5, size: lay.bw * 1.1 });
        this.burst(cx, cy, 30, 'brick', { colors: ['#c0553a', '#8d8d8d', '#5a4a42'], g: 320, up: 120, minSp: 60, maxSp: 220, minLife: 1, maxLife: 1.8, minSize: 2.5, maxSize: 5 });
        this.burst(cx, cy, 16, 'dust', { color: '#9e8c7a', minSp: 10, maxSp: 60, minSize: 10, maxSize: 22, minLife: 1.2, maxLife: 2.2 });
      }
    }

    for (const p of this.particles) {
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      p.life -= dt;
      if (p.kind === 'brick' && p.y > lay.groundY) {
        p.y = lay.groundY;
        p.vy *= -0.25;
        p.vx *= 0.6;
      }
      if (p.kind === 'dust') {
        p.size += dt * 6;
        p.vx *= 0.98;
      }
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  workerPos(w, lay) {
    const topY = this.buildingTopY(lay);
    if (w.place === 'top') return { x: lay.bx + lay.bw * w.x, y: topY };
    if (w.place === 'left') {
      const x0 = lay.ws * 0.6, x1 = Math.max(x0, lay.bx - lay.ws * 0.4);
      return { x: x0 + (x1 - x0) * w.x, y: lay.groundY };
    }
    if (w.place === 'right') {
      const x0 = lay.bx + lay.bw + lay.ws * 0.5, x1 = Math.max(x0, lay.W - lay.ws * 0.6);
      return { x: x0 + (x1 - x0) * w.x, y: lay.groundY };
    }
    return { x: lay.ws * 0.6 + (lay.W - lay.ws * 1.2) * w.x, y: lay.groundY };
  }

  buildingTopY(lay) {
    const n = this.floors;
    if (this.level < 0 && n > 0) return lay.groundY - (n - 1) * lay.fh - lay.fh * (1 - this.progress * 0.8);
    return lay.groundY - n * lay.fh;
  }

  // ---------- draw ----------
  sprite(name, cx, footY, h, { flip = false, rot = 0, alpha = 1, pivotY = 1 } = {}) {
    const ctx = this.ctx;
    const s = getSprite(name);
    const w = s ? h * (s.w / s.h) : h * 0.8;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, footY - h * (1 - pivotY));
    ctx.rotate(rot);
    if (flip) ctx.scale(-1, 1);
    if (s) ctx.drawImage(s.img, -w / 2, -h * pivotY, w, h);
    else {
      ctx.fillStyle = name.startsWith('worker') ? '#f4a259' : '#bbb';
      ctx.fillRect(-w / 2, -h * pivotY, w, h);
    }
    ctx.restore();
    return w;
  }

  drawSky(lay) {
    const ctx = this.ctx, L = this.level;
    const skies = {
      4: ['#5ec8ff', '#d6f3ff'], 3: ['#6ccfff', '#dff6ff'], 2: ['#7fd3ff', '#e6f7ff'], 1: ['#93d8f5', '#eaf8ff'],
      0: ['#a9d6ea', '#eef6f9'], '-1': ['#a4b8c4', '#e3e8ea'], '-2': ['#8c99a3', '#d4d0c8'], '-3': ['#6f6a6d', '#c9b8a3'], '-4': ['#4a3540', '#d98a5f'],
    };
    const [a, b] = skies[L] || skies[0];
    const g = ctx.createLinearGradient(0, 0, 0, lay.groundY);
    g.addColorStop(0, a);
    g.addColorStop(1, b);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, lay.W, lay.H);

    if (L >= 0) {
      const sx = lay.W * 0.86, sy = lay.H * 0.3, r = Math.min(lay.W, lay.H) * 0.07;
      ctx.fillStyle = L === 4 ? '#fff3a0' : '#ffe98a';
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
      if (L >= 3) {
        ctx.strokeStyle = 'rgba(255,233,138,0.6)';
        ctx.lineWidth = 2;
        for (let i = 0; i < 8; i++) {
          const a2 = this.t * 0.5 + (i * Math.PI) / 4;
          ctx.beginPath();
          ctx.moveTo(sx + Math.cos(a2) * r * 1.3, sy + Math.sin(a2) * r * 1.3);
          ctx.lineTo(sx + Math.cos(a2) * r * 1.8, sy + Math.sin(a2) * r * 1.8);
          ctx.stroke();
        }
      }
    }
    ctx.fillStyle = L < -1 ? 'rgba(90,90,95,0.55)' : 'rgba(255,255,255,0.85)';
    for (const c of this.clouds) {
      const cx = c.x * lay.W, cy = c.y * lay.H, r = Math.min(lay.W, lay.H) * 0.05 * c.s;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.arc(cx + r, cy + r * 0.2, r * 0.8, 0, Math.PI * 2);
      ctx.arc(cx - r, cy + r * 0.25, r * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawGround(lay) {
    const ctx = this.ctx;
    ctx.fillStyle = this.level < 0 ? '#8a7560' : '#7cb35a';
    ctx.fillRect(0, lay.groundY, lay.W, lay.H - lay.groundY);
    ctx.fillStyle = this.level < 0 ? '#6e5a47' : '#5e9442';
    ctx.fillRect(0, lay.groundY, lay.W, Math.max(2, (lay.H - lay.groundY) * 0.18));
  }

  drawCracks(lay, i) {
    const ctx = this.ctx, r = seeded(this.seed + i * 97);
    if (r() > 0.25 * -this.level) return;
    const y = lay.groundY - (i + 1) * lay.fh;
    ctx.strokeStyle = 'rgba(40,30,25,0.75)';
    ctx.lineWidth = Math.max(1, lay.fh * 0.05);
    ctx.beginPath();
    let x = lay.bx + lay.bw * (0.1 + r() * 0.8), yy = y + lay.fh * 0.1;
    ctx.moveTo(x, yy);
    for (let k = 0; k < 4; k++) {
      x += (r() - 0.5) * lay.fh * 0.6;
      yy += lay.fh * 0.22;
      ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }

  drawBuilding(lay) {
    const ctx = this.ctx, L = this.level, n = this.floors, fs = getSprite('floor');
    const drawFloor = (y) => {
      if (fs) ctx.drawImage(fs.img, lay.bx, y, lay.bw, lay.fh);
      else {
        ctx.fillStyle = '#e8c48a';
        ctx.fillRect(lay.bx, y, lay.bw, lay.fh);
      }
    };
    const solid = L < 0 && n > 0 ? n - 1 : n;
    for (let i = 0; i < solid; i++) {
      drawFloor(lay.groundY - (i + 1) * lay.fh);
      if (L <= -2) this.drawCracks(lay, i);
    }

    if (L > 0) {
      // floor under construction rises from the bottom
      const y0 = lay.groundY - (n + 1) * lay.fh;
      const p = this.progress;
      ctx.save();
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = 'rgba(60,60,60,0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(lay.bx + 0.5, y0 + 0.5, lay.bw - 1, lay.fh - 1);
      ctx.restore();
      ctx.save();
      ctx.beginPath();
      ctx.rect(lay.bx, y0 + lay.fh * (1 - p), lay.bw, lay.fh * p);
      ctx.clip();
      drawFloor(y0);
      ctx.restore();
      // scaffold
      ctx.strokeStyle = '#7a5c3a';
      ctx.lineWidth = Math.max(1.5, lay.fh * 0.07);
      const sTop = y0 - lay.fh * 0.25, sBot = lay.groundY - n * lay.fh + lay.fh;
      for (const sx of [lay.bx - lay.fh * 0.12, lay.bx + lay.bw + lay.fh * 0.12]) {
        ctx.beginPath();
        ctx.moveTo(sx, sTop);
        ctx.lineTo(sx, Math.min(lay.groundY, sBot));
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(lay.bx - lay.fh * 0.2, y0 + lay.fh * 0.5);
      ctx.lineTo(lay.bx + lay.bw + lay.fh * 0.2, y0 + lay.fh * 0.5);
      ctx.stroke();
    } else if (L === 0) {
      const rs = getSprite('roof');
      if (rs) {
        const rh = lay.bw * (rs.h / rs.w);
        ctx.drawImage(rs.img, lay.bx, lay.groundY - n * lay.fh - rh, lay.bw, rh);
      }
    } else if (n > 0) {
      // top floor crumbling with a jagged edge
      const y0 = lay.groundY - n * lay.fh;
      const cut = lay.fh * this.progress * 0.8;
      const r = seeded(this.seed + 7);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(lay.bx, y0 + lay.fh);
      const teeth = 7;
      for (let k = 0; k <= teeth; k++) {
        const x = lay.bx + (lay.bw * k) / teeth;
        ctx.lineTo(x, y0 + cut + (k % 2 ? r() * lay.fh * 0.25 : 0));
      }
      ctx.lineTo(lay.bx + lay.bw, y0 + lay.fh);
      ctx.closePath();
      ctx.clip();
      drawFloor(y0);
      ctx.restore();
      if (L <= -2) this.drawCracks(lay, n - 1);
    }

    // rubble piles
    if (L < 0) {
      const a = -L;
      const rw = a === 4 && n === 0 ? lay.bw * 1.5 : lay.bw * (0.35 + 0.15 * a);
      const rs = getSprite('rubble');
      const rh = rs ? rw * (rs.h / rs.w) : rw * 0.3;
      const rx = a === 4 && n === 0 ? lay.bx + lay.bw / 2 - rw / 2 : lay.bx + lay.bw - rw * 0.4;
      if (rs) ctx.drawImage(rs.img, rx, lay.groundY - rh * 0.92, rw, rh);
    }
  }

  drawMachines(lay) {
    const L = this.level;
    if (L >= 3) {
      const cs = getSprite('crane');
      const bh = this.floors * lay.fh;
      const ch = clamp(bh + lay.fh * 3, (lay.groundY - lay.top) * 0.75, lay.groundY - lay.H * 0.06);
      const cw = cs ? ch * (cs.w / cs.h) : ch * 0.9;
      const towerX = lay.bx + lay.bw + cw * 0.12;
      const left = towerX - cw * 0.66;
      this.sprite('crane', left + cw / 2, lay.groundY, ch);
      // hanging pallet of bricks
      const hookX = left + cw * 0.09, hookY = lay.groundY - ch + ch * 0.55;
      const swing = 0.5 + 0.5 * Math.sin(this.t * this.cfg.speed);
      const py = hookY + (lay.groundY - lay.fh * 0.6 - hookY) * swing;
      const ctx = this.ctx;
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(hookX, hookY);
      ctx.lineTo(hookX, py);
      ctx.stroke();
      ctx.fillStyle = '#c0553a';
      ctx.fillRect(hookX - lay.fh * 0.35, py, lay.fh * 0.7, lay.fh * 0.35);
      ctx.strokeStyle = '#7a2f1d';
      ctx.strokeRect(hookX - lay.fh * 0.35, py, lay.fh * 0.7, lay.fh * 0.35);
    }
    if (L <= -2 && L >= -3) {
      const eh = clamp(lay.fh * 2.4, lay.ws * 1.1, lay.H * 0.32);
      const es = getSprite('excavator');
      const ew = es ? eh * (es.w / es.h) : eh * 1.5;
      const cx = lay.bx - ew * 0.32;
      const rot = Math.sin(this.t * this.cfg.speed * 3) * 0.05;
      this.sprite('excavator', cx, lay.groundY, eh, { rot });
    }
  }

  drawWorkers(lay) {
    const L = this.level;
    for (const w of this.workers) {
      const pos = this.workerPos(w, lay);
      if (w.place === 'top' && this.floors === 0) continue;
      const h = lay.ws;
      if (w.role === 'hammer') {
        const a = w.acc;
        const rot = a < 0.7 ? -0.35 * (a / 0.7) : -0.35 + 0.6 * ((a - 0.7) / 0.3);
        const flip = w.x > 0.5;
        this.sprite(L < 0 && -L >= 3 ? 'worker_panic' : 'worker_hammer', pos.x, pos.y, h, { flip, rot: flip ? -rot : rot });
        w.dir = flip ? -1 : 1;
      } else if (w.role === 'carry') {
        const bob = Math.abs(Math.sin(this.t * 8 * this.cfg.speed + w.phase)) * h * 0.06;
        this.sprite('worker_carry', pos.x, pos.y - bob, h, { flip: w.dir < 0 });
      } else if (w.role === 'panic') {
        const bob = Math.abs(Math.sin(this.t * 14 + w.phase)) * h * 0.1;
        this.sprite('worker_panic', pos.x, pos.y - bob, h, { flip: w.dir < 0 });
      } else if (w.role === 'cheer') {
        const jump = Math.abs(Math.sin(this.t * 5 + w.phase)) * h * 0.45;
        this.sprite('worker_cheer', pos.x, pos.y - jump, h);
      } else {
        const bob = Math.sin(this.t * 1.5 + w.phase) * h * 0.02;
        this.sprite('worker_hammer', pos.x, pos.y + bob, h * 0.95, { rot: Math.sin(this.t * 0.8) * 0.04 });
        // steam from coffee
        const ctx = this.ctx;
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        for (let k = 0; k < 3; k++) {
          const ph = (this.t * 0.6 + k / 3) % 1;
          ctx.beginPath();
          ctx.arc(pos.x + h * 0.45 + Math.sin(ph * 6) * 3, pos.y - h * 0.8 - ph * h * 0.5, 2 + ph * 3, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.font = `${Math.round(h * 0.35)}px sans-serif`;
        ctx.fillText('☕', pos.x + h * 0.3, pos.y - h * 0.45);
      }
    }
  }

  drawParticles() {
    const ctx = this.ctx;
    for (const p of this.particles) {
      const a = clamp(p.life / p.maxLife, 0, 1);
      ctx.globalAlpha = p.kind === 'dust' ? a * 0.55 : a;
      if (p.kind === 'flash') {
        const r = p.size * (1.2 - a);
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        g.addColorStop(0, 'rgba(255,255,220,1)');
        g.addColorStop(0.4, 'rgba(255,170,60,0.9)');
        g.addColorStop(1, 'rgba(255,80,30,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.kind === 'dust') {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.kind === 'brick' || p.kind === 'confetti') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size, -p.size * 0.55, p.size * 2, p.size * 1.1);
        ctx.restore();
      } else {
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
    }
    ctx.globalAlpha = 1;
  }

  draw() {
    if (!this.cfg || this.W < 2) return;
    const ctx = this.ctx;
    const lay = this.layout();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (this.shake > 0) {
      const s = this.shake * 10;
      ctx.translate(rand(-s, s), rand(-s, s));
    }
    this.drawSky(lay);
    this.drawGround(lay);
    this.drawBuilding(lay);
    this.drawMachines(lay);
    this.drawWorkers(lay);
    this.drawParticles();
  }
}

// One shared animation loop for every scene on the page.
const scenes = new Set();
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  for (const s of scenes) {
    s.update(dt);
    s.draw();
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

export function registerScene(s) {
  scenes.add(s);
}
export function unregisterScene(s) {
  scenes.delete(s);
}
