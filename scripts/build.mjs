// Construit un fichier JSON compact par recette et par langue, à partir des données
// publiques du Palmarès des créateurs TRMNL (lecture seule, le site n'est jamais modifié).
//
//   dist/<langue>/<idRecette>.json   → tout ce qu'il faut au gabarit pour le créateur de cette recette
//
// La recette TRMNL interroge : https://<compte>.github.io/<dépôt>/<langue>/<idRecette>.json
// Usage : node scripts/build.mjs [--src dossier-local] [--out dist]

import fs from 'node:fs/promises';
import path from 'node:path';
import { LANGS, LOCALE, T } from './i18n.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, k, all) => (x.startsWith('--') ? a.concat([[x.slice(2), all[k + 1]]]) : a), []));
const SITE = (process.env.SITE_URL || 'https://nbbou81000.github.io/trmnl-leaderboard/').replace(/\/?$/, '/');
const OUT = args.out || 'dist';
const D = 86400e3;

async function load(rel, fallback) {
  try {
    if (args.src) return JSON.parse(await fs.readFile(path.join(args.src, rel), 'utf8'));
    const res = await fetch(SITE + rel, { headers: { 'cache-control': 'no-cache' } });
    if (!res.ok) throw new Error(`${res.status} ${rel}`);
    return await res.json();
  } catch (e) {
    if (fallback !== undefined) { console.warn(`(facultatif) ${rel} : ${e.message}`); return fallback; }
    throw e;
  }
}

// Le palmarès se met à jour chaque heure (relevé vers hh:07). Si ce passage-ci tombe avant
// la fin de sa mise à jour, on patiente un peu plutôt que de republier des chiffres d'il y a une heure.
let latest = await load('data/latest.json');
for (let k = 0; !args.src && k < 6 && Date.now() - Date.parse(latest.generated_at) > 55 * 60e3; k++) {
  console.log(`Données du palmarès du ${latest.generated_at} : mise à jour pas encore publiée, nouvel essai dans 2 min…`);
  await new Promise(r => setTimeout(r, 120e3));
  latest = await load('data/latest.json');
}
const [daily, weekly, breakout, spotHist, names] = await Promise.all([
  load('data/daily.json'),
  load('data/weekly.json', {}),
  load('data/breakout.json', { picks: [] }),
  load('data/spotlight-history.json', { shown: [] }),
  load('names.json', {}),
]);
if (!latest?.recipes?.length || !latest?.creators?.length) throw new Error('Données du palmarès vides : rien n’est publié.');

const nowMs = Date.parse(latest.generated_at);

// Seuls les libellés réellement utilisés par les gabarits partent dans les fichiers
const SRC = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'src');
const USED = new Set();
for (const f of await fs.readdir(SRC)) if (f.endsWith('.liquid')) for (const m of (await fs.readFile(path.join(SRC, f), 'utf8')).matchAll(/\bt\.(\w+)/g)) USED.add(m[1]);
const pick = L => Object.fromEntries(Object.entries(T[L]).filter(([k]) => USED.has(k)));

// ---------- Outils ----------
const fill = (s, o = {}) => s.replace(/\{(\w+)\}/g, (_, k) => (o[k] ?? ''));
const tr = (L, key, n, o = {}) => fill(T[L][n === 1 && T[L][key + '_1'] ? key + '_1' : key], { n, ...o });
const NF = Object.fromEntries(LANGS.map(L => [L, new Intl.NumberFormat(LOCALE[L])]));
const NF1 = Object.fromEntries(LANGS.map(L => [L, new Intl.NumberFormat(LOCALE[L], { maximumFractionDigits: 1 })]));
const NF2 = Object.fromEntries(LANGS.map(L => [L, new Intl.NumberFormat(LOCALE[L], { maximumSignificantDigits: 2 })]));
// Espaces fines insécables (fr) → espace normale : glyphe sûr sur l'écran
const clean = s => s.replace(/[  ]/g, ' ');
const num = (L, n) => (n == null ? '—' : clean(NF[L].format(n)));
const signed = (L, n) => (n == null ? '—' : n > 0 ? '+' + num(L, n) : n < 0 ? '−' + num(L, -n) : '0');
const dateS = (L, iso, withYear = false) => clean(new Intl.DateTimeFormat(LOCALE[L], { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' }).format(new Date(iso)));
const display = (u) => names[u] || null;
const creatorName = (L, u) => display(u) || `${T[L].creator} #${u}`;
const r1 = x => Math.round(x * 10) / 10;

// ---------- Index ----------
const recipes = latest.recipes;
const recById = new Map(recipes.map(r => [r.id, r]));
const byCreator = new Map();
for (const r of recipes) { if (!byCreator.has(r.u)) byCreator.set(r.u, []); byCreator.get(r.u).push(r); }
for (const list of byCreator.values()) list.sort((a, b) => b.s - a.s || b.i - a.i);
const creators = latest.creators;               // déjà triés par rang
const cById = new Map(creators.map(c => [c.u, c]));
const totalAll = latest.totals.installs + latest.totals.forks;

// ---------- Historique quotidien : 31 derniers relevés, un par jour ----------
const ownerOf = new Map(daily.idx.map(([id, u]) => [id, u]));
const posOf = new Map(daily.idx.map(([id], k) => [id, k]));
const perDay = new Map();
for (const s of daily.snaps) perDay.set(s.t.slice(0, 10), s);          // le dernier relevé de chaque jour
const snaps = [...perDay.values()].sort((a, b) => a.t.localeCompare(b.t)).slice(-31);
const excluded = new Set(recipes.map(r => r.id));                       // recettes encore au palmarès
const snapTotals = snaps.map(s => {
  const tot = new Map();
  daily.idx.forEach(([id, u], k) => {
    if (!excluded.has(id) || s.i[k] == null) return;
    tot.set(u, (tot.get(u) || 0) + s.i[k] + (s.f[k] || 0));
  });
  return tot;
});
const snapRanks = snapTotals.map(tot => {
  const arr = [...tot.entries()].sort((a, b) => b[1] - a[1]);
  const m = new Map(); let rank = 0, prev = null;
  arr.forEach(([u, v], n) => { if (v !== prev) { rank = n + 1; prev = v; } m.set(u, rank); });
  return m;
});
const recipeSeries = id => { const k = posOf.get(id); return snaps.slice(-15).map(s => (k == null || s.i[k] == null ? null : s.i[k] + (s.f[k] || 0))); };

// Relevé le plus proche d'une date (pour « cette semaine »)
const snapAt = (ms) => { let best = null; for (const s of daily.snaps) if (Date.parse(s.t) <= ms + 20 * 60e3) best = s; return best; };
const weekFrom = weekly?.current?.from ? Date.parse(weekly.current.from) : null;
const weekSnap = weekFrom ? snapAt(weekFrom) : null;

// ---------- Courbes SVG (pré-calculées : aucune bibliothèque côté TRMNL) ----------
const W = 300, H = 100;
function line(values, { invert = false, pad = 6, minSpan = 0 } = {}) {
  const pts = values.map((v, k) => [k, v]).filter(([, v]) => v != null);
  if (pts.length < 2) return null;
  let lo = Math.min(...pts.map(p => p[1])), hi = Math.max(...pts.map(p => p[1]));
  if (hi - lo < minSpan) { const mid = (hi + lo) / 2; hi = mid + minSpan / 2; lo = mid - minSpan / 2; }
  if (hi === lo) { hi += 1; lo -= 1; }
  const n = values.length - 1 || 1;
  const xy = pts.map(([k, v]) => {
    const x = (k / n) * W;
    let y = (v - lo) / (hi - lo);
    if (!invert) y = 1 - y;
    return [r1(x), r1(pad + y * (H - 2 * pad))];
  });
  const last = xy[xy.length - 1];
  return { pts: xy.map(p => p.join(',')).join(' '), lx: last[0], ly: last[1] };
}
function bars(values) {
  const n = values.length; if (!n) return null;
  const hi = Math.max(1, ...values.map(v => Math.max(0, v ?? 0)));
  const slot = W / n, bw = Math.max(1, slot * 0.62);
  let d = '';
  values.forEach((v, k) => {
    const h = Math.max(0, v ?? 0) / hi * (H - 4);
    if (h <= 0) { d += `M${r1(k * slot + (slot - bw) / 2)} ${H - 1}h${r1(bw)}v1h-${r1(bw)}z`; return; }   // trait de base pour les jours sans gain
    d += `M${r1(k * slot + (slot - bw) / 2)} ${r1(H - h)}h${r1(bw)}v${r1(h)}h-${r1(bw)}z`;
  });
  return { d, max: hi };
}

const LADDER = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];
const nextMilestone = s => LADDER.find(m => m > s) ?? null;
const prevMilestone = s => [...LADDER].reverse().find(m => m <= s) ?? 0;
function eta(L, missing, perDayRate) {
  if (missing <= 0) return T[L].eta_soon;
  if (!(perDayRate > 0)) return T[L].eta_never;
  const d = Math.ceil(missing / perDayRate);
  if (d > 365) return T[L].eta_far;
  if (d <= 1) return tr(L, 'eta_days', 1);
  return tr(L, 'eta_days', d);
}

// ---------- Fichier d'un créateur, dans une langue ----------
function build(u, L, focusId) {
  const t = T[L];
  const c = cById.get(u);
  const mine = byCreator.get(u) || [];
  const of = creators.length;
  const idx = creators.findIndex(x => x.u === u);
  const above = idx > 0 ? creators[idx - 1] : null;
  const below = idx >= 0 && idx < creators.length - 1 ? creators[idx + 1] : null;

  // Séries 30 jours
  const tot = snapTotals.map(m => m.get(u) ?? null);
  tot[tot.length - 1] = c.s;                                         // dernier point = valeur actuelle
  const gains = tot.slice(1).map((v, k) => (v == null || tot[k] == null ? 0 : v - tot[k]));
  const rk = snapRanks.map(m => m.get(u) ?? null); rk[rk.length - 1] = c.r;
  const known = tot.filter(v => v != null);
  const rkKnown = rk.filter(v => v != null);
  const ln = line(tot), rl = line(rk, { invert: true }), br = bars(gains);
  const firstT = snaps.find((s, k) => tot[k] != null)?.t || snaps[0]?.t;

  const move = c.r7 != null ? c.r7 - c.r : null;
  const rate7 = (c.d7 ?? 0) / 7;
  const weekGain = weekSnap ? c.s - (snapTotals[snaps.indexOf(weekSnap)]?.get(u) ?? (() => {
    // relevé hors fenêtre des 31 jours : on recalcule
    let s = 0; daily.idx.forEach(([id, uu], k) => { if (uu === u && excluded.has(id) && weekSnap.i[k] != null) s += weekSnap.i[k] + (weekSnap.f[k] || 0); }); return s;
  })()) : null;

  const rows = mine.slice(0, 30).map(r => {
    const nx = nextMilestone(r.s), pv = prevMilestone(r.s);
    const rRate = (r.d7 ?? 0) / 7;
    const ser = recipeSeries(r.id), sp = line(ser, { pad: 4, minSpan: Math.max(6, Math.max(...ser.filter(v => v != null), 0) * 0.15) });
    return {
      id: r.id, name: r.n, focus: r.id === focusId,
      s: r.s, s_s: num(L, r.s), i_s: num(L, r.i), f_s: num(L, r.f),
      d24: r.d24 ?? 0, d24_s: signed(L, r.d24), d7: r.d7 ?? 0, d7_s: signed(L, r.d7), d30_s: signed(L, r.d30),
      rank: r.r, rank_s: '#' + num(L, r.r),
      next: nx, next_s: nx ? num(L, nx) : '—',
      pct: nx ? Math.max(2, Math.min(100, Math.round((r.s - pv) / (nx - pv) * 100))) : 100,
      eta_s: nx ? eta(L, nx - r.s, rRate) : '—',
      fund: r.s >= 50,
      spark: sp ? sp.pts : '',
      shot: r.sc || '',
      date_s: r.p ? dateS(L, r.p, true) : '',
    };
  });

  const fundOk = mine.filter(r => r.s >= 50).length;
  const fundCand = mine.filter(r => r.s < 50).sort((a, b) => b.s - a.s || (b.d7 ?? 0) - (a.d7 ?? 0)).map(r => ({ id: r.id, name: r.n, s: r.s }))[0];
  const best = rows[0];
  const hot = [...rows].sort((a, b) => b.d7 - a.d7 || b.d24 - a.d24)[0];
  const newest = [...mine].sort((a, b) => (b.p || '').localeCompare(a.p || ''))[0];

  // Temps forts
  const hl = [];
  const mile = (weekly?.current?.milestones || []).filter(m => m.u === u);
  for (const m of mile.slice(0, 2)) hl.push(fill(t.hl_milestone, { name: m.n, n: num(L, m.T) }));
  const nw = (weekly?.current?.new_list || []).filter(m => m.u === u);
  for (const m of nw.slice(0, 1)) hl.push(fill(t.hl_new, { name: m.n }));
  const sp = (spotHist?.shown || []).filter(x => x.u === u).sort((a, b) => b.date.localeCompare(a.date))[0];
  if (sp) hl.push(fill(t.hl_spotlight, { name: sp.n, date: dateS(L, sp.date) }));
  const bo = (breakout?.picks || []).filter(x => x.u === u).sort((a, b) => b.date.localeCompare(a.date))[0];
  if (bo) hl.push(fill(t.hl_breakout, { name: bo.n, date: dateS(L, bo.date) }));

  const pctTop = Math.max(1, Math.ceil(c.r / of * 100));
  const name = creatorName(L, u);

  return {
    v: 1,
    found: true,
    lang: L,
    updated: latest.generated_at,
    t: pick(L),
    profile_url: `${SITE}?lang=${L === 'fr' ? 'fr' : 'en'}#${L === 'fr' ? 'createur' : 'creator'}/${u}`,
    c: {
      id: u, name, claimed: !!display(u),
      rank: c.r, rank_s: '#' + num(L, c.r), of, of_s: fill(t.rank_of, { n: num(L, of) }),
      top_s: fill(t.top_pct, { n: num(L, pctTop) }),
      move, move_dir: move == null || move === 0 ? 'flat' : move > 0 ? 'up' : 'down',
      move_s: move == null || move === 0 ? t.move_flat : move > 0 ? tr(L, 'move_up', move) : tr(L, 'move_down', -move),
      total: c.s, total_s: num(L, c.s), installs_s: num(L, c.i), forks_s: num(L, c.f),
      recipes: c.n, recipes_s: num(L, c.n),
      d1_s: signed(L, c.d1), d24: c.d24 ?? 0, d24_s: signed(L, c.d24), d7: c.d7 ?? 0, d7_s: signed(L, c.d7), d30_s: signed(L, c.d30),
      week_s: signed(L, weekGain),
      per_day_s: fill(t.per_day, { n: clean(NF1[L].format(r1(rate7))) }),
      share_s: fill(t.share, { n: clean(NF2[L].format(c.s / totalAll * 100)) }),
      gap_up_s: above ? (above.s === c.s ? fill(t.gap_up_tie, { name: creatorName(L, above.u) }) : fill(t.gap_up, { n: num(L, above.s - c.s), name: creatorName(L, above.u) })) : t.leader,
      gap_down_s: below ? fill(t.gap_down, { n: num(L, c.s - below.s), name: creatorName(L, below.u) }) : '',
      since_s: c.first ? fill(t.since, { date: dateS(L, c.first, true) }) : '',
    },
    fund: {
      ok: fundOk, total: mine.length,
      label: fill(t.fund_ok, { n: num(L, fundOk), m: num(L, mine.length) }),
      next: fundCand ? tr(L, 'fund_next', 50 - fundCand.s, { name: fundCand.name }) : t.fund_all,
      next_eta: fundCand ? eta(L, 50 - fundCand.s, (mine.find(r => r.id === fundCand.id)?.d7 ?? 0) / 7) : '',
      pct: mine.length ? Math.round(fundOk / mine.length * 100) : 0,
    },
    chart: {
      line: ln?.pts || '', lx: ln?.lx ?? 0, ly: ln?.ly ?? 0,
      bars: br?.d || '', bars_max_s: br ? num(L, br.max) : '0',
      rank: rl?.pts || '', rlx: rl?.lx ?? 0, rly: rl?.ly ?? 0,
      min_s: known.length ? num(L, Math.min(...known)) : '', max_s: known.length ? num(L, Math.max(...known)) : '',
      rank_best_s: rkKnown.length ? '#' + num(L, Math.min(...rkKnown)) : '', rank_worst_s: rkKnown.length ? '#' + num(L, Math.max(...rkKnown)) : '',
      start_s: firstT ? dateS(L, firstT) : '', end_s: dateS(L, latest.generated_at),
    },
    best: best ? { name: best.name, s_s: best.s_s, shot: best.shot, rank_s: best.rank_s } : null,
    hot: hot && hot.d7 > 0 ? { name: hot.name, d7_s: hot.d7_s } : null,
    newest: newest ? { name: newest.n, date_s: newest.p ? dateS(L, newest.p, true) : '' } : null,
    highlights: hl.slice(0, 4),
    recipes: rows,
  };
}

// ---------- Écriture ----------
await fs.rm(OUT, { recursive: true, force: true });
let files = 0, bytes = 0;
for (const L of LANGS) {
  await fs.mkdir(path.join(OUT, L), { recursive: true });
  const cache = new Map();
  for (const r of recipes) {
    if (!cById.has(r.u)) continue;
    const json = JSON.stringify(build(r.u, L, r.id));
    await fs.writeFile(path.join(OUT, L, `${r.id}.json`), json);
    files++; bytes += json.length; cache.set(r.u, true);
  }
}
// Page d'accueil minimale (lien de vérification) et absence de traitement Jekyll
await fs.writeFile(path.join(OUT, '.nojekyll'), '');
await fs.writeFile(path.join(OUT, 'index.html'), `<!doctype html><meta charset="utf-8"><title>TRMNL Creator Stats data</title><p>Data feed for the TRMNL “Creator Stats” recipe. Updated ${latest.generated_at}. Source: <a href="${SITE}">${SITE}</a></p>`);
await fs.writeFile(path.join(OUT, 'status.json'), JSON.stringify({ updated: latest.generated_at, built: new Date().toISOString(), recipes: recipes.length, creators: creators.length, files }));
console.log(`OK : ${files} fichiers (${(bytes / 1e6).toFixed(1)} Mo), ${creators.length} créateurs, ${snaps.length} jours d'historique.`);
