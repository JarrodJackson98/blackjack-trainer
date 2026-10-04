#!/usr/bin/env node
/*
 * Builds strategy-odds.json — the Pre-calculated Hand Odds Matrix.
 *
 * Two-card situations: exact combinatorics on a 6-deck shoe (sampling without replacement)
 * for player card 1, player card 2 and the dealer upcard. Player blackjacks are excluded
 * (there's no decision to make).
 *
 * Multi-card situations (3–4 cards): exact enumeration of every path that reaches the hand
 * when you play correct basic strategy (surrender off) — i.e. you only get a third card if
 * the correct play on two cards was Hit. Only decision-relevant totals are kept
 * (hard 9–16, soft 13–19).
 *
 * Then an independent Monte Carlo simulation re-checks every value (default 20M hands;
 * override with --mc=N). Rows too rare for the simulation to measure to within 5% are
 * reported as skipped rather than silently passed.
 *
 * Usage: node scripts/build-odds.js [--mc=20000000]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const S = require('../strategy.js');
const G = require('../generator.js');

const VALUES = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const COUNT = (v) => (v === 10 ? 16 : 4) * G.DECKS;
const TOTAL = 52 * G.DECKS;

const mcArg = process.argv.find((a) => a.startsWith('--mc='));
const MC_HANDS = mcArg ? Number(mcArg.slice(5)) : 20_000_000;

function counts() {
  const c = {};
  for (const v of VALUES) c[v] = COUNT(v);
  return c;
}

// Correct play for a reachable hand, surrender off, splitting allowed on the initial two cards
function playAction(cards, up) {
  const two = cards.length === 2;
  return S.getAction(cards, up, { canDouble: two, canSplit: two, canSurrender: false }).action;
}

const keep = (cards) => {
  const { total, soft } = S.handValue(cards);
  if (total > 21) return false;
  return soft ? total >= 13 && total <= 19 : total >= 9 && total <= 16;
};

// ---------- exact ----------
const rows = new Map(); // id -> { cards, up, p }
const add = (cards, up, p) => {
  const id = G.situationId(cards, up);
  const r = rows.get(id);
  if (r) r.p += p;
  else rows.set(id, { cards: cards.slice().sort((a, b) => b - a), up, p });
};

const multi = new Map();
const addMulti = (cards, up, p) => {
  const id = G.situationId(cards, up);
  const r = multi.get(id);
  if (r) r.p += p;
  else multi.set(id, { cards: cards.slice().sort((a, b) => b - a), up, p });
};

// Extend a hand by one hit card, recursively, up to 4 player cards
function extend(cards, up, p, c, left) {
  for (const v of VALUES) {
    if (!c[v]) continue;
    const pv = p * (c[v] / left);
    const next = cards.concat(v);
    const { total } = S.handValue(next);
    if (total > 21) continue;
    if (keep(next)) addMulti(next, up, pv);
    if (next.length < 4 && playAction(next, up) === 'H') {
      c[v]--;
      extend(next, up, pv, c, left - 1);
      c[v]++;
    }
  }
}

const c = counts();
for (let i = 0; i < VALUES.length; i++) {
  for (let j = i; j < VALUES.length; j++) {
    const a = VALUES[i], b = VALUES[j];
    if (S.isBlackjack([a, b])) continue;
    const pPlayer = a === b
      ? (c[a] / TOTAL) * ((c[a] - 1) / (TOTAL - 1))
      : 2 * (c[a] / TOTAL) * (c[b] / (TOTAL - 1));
    for (const u of VALUES) {
      const cu = c[u] - (a === u) - (b === u);
      const p = pPlayer * (cu / (TOTAL - 2));
      add([a, b], u, p);
      if (playAction([a, b], u) === 'H') {
        c[a]--; c[b]--; c[u]--;
        extend([a, b], u, p, c, TOTAL - 3);
        c[a]++; c[b]++; c[u]++;
      }
    }
  }
}

// ---------- Monte Carlo check ----------
function monteCarlo(n) {
  const rng = G.mulberry32(20261004);
  const shoe = [];
  for (const v of VALUES) for (let k = 0; k < COUNT(v); k++) shoe.push(v);
  const L = shoe.length;
  const hit2 = new Map(), hitM = new Map();
  const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  const swaps = [];
  const draw = (k) => {
    // partial Fisher–Yates from the end; record swaps so the shoe can be restored
    const j = Math.floor(rng() * (L - k));
    const pos = L - 1 - k;
    const v = shoe[j];
    shoe[j] = shoe[pos];
    shoe[pos] = v;
    swaps.push(j, pos);
    return v;
  };
  for (let h = 0; h < n; h++) {
    swaps.length = 0;
    const p1 = draw(0), up = draw(1), p2 = draw(2), hole = draw(3);
    void hole;
    const cards = [p1, p2];
    if (!S.isBlackjack(cards)) {
      bump(hit2, G.situationId(cards, up));
      let k = 4;
      while (cards.length < 4 && playAction(cards, up) === 'H') {
        cards.push(draw(k++));
        if (S.handValue(cards).total > 21) break;
        if (keep(cards)) bump(hitM, G.situationId(cards, up));
      }
    }
    for (let s = swaps.length - 2; s >= 0; s -= 2) {
      const a = swaps[s], b = swaps[s + 1];
      const t = shoe[a]; shoe[a] = shoe[b]; shoe[b] = t;
    }
  }
  return { hit2, hitM };
}

function check(map, hits, n) {
  let pass = 0, fail = 0, skipped = 0, worst = 0;
  const failures = [];
  for (const [id, r] of map) {
    const expected = r.p * n;
    if (expected < 4000) { skipped++; continue; } // <4,000 expected hits: 5% isn't measurable
    const got = hits.get(id) || 0;
    const rel = Math.abs(got - expected) / expected;
    worst = Math.max(worst, rel);
    if (rel <= 0.05) pass++;
    else { fail++; failures.push(`${id}: exact ${r.p.toExponential(3)}, MC ${(got / n).toExponential(3)}`); }
  }
  return { pass, fail, skipped, worst, failures };
}

const t0 = Date.now();
const { hit2, hitM } = monteCarlo(MC_HANDS);
const mcSecs = ((Date.now() - t0) / 1000).toFixed(1);
const r2 = check(rows, hit2, MC_HANDS);
const rM = check(multi, hitM, MC_HANDS);

// ---------- output ----------
const out = [];
const pushRow = (r) => {
  const two = r.cards.length === 2;
  const opts = { canDouble: two, canSplit: two };
  out.push({
    id: G.situationId(r.cards, r.up),
    c: r.cards,
    u: r.up,
    p: Number(r.p.toPrecision(6)),
    a: S.getAction(r.cards, r.up, { ...opts, canSurrender: false }).action,
    as: S.getAction(r.cards, r.up, { ...opts, canSurrender: two }).action,
    cat: G.categorize(r.cards, r.up),
  });
};
for (const r of rows.values()) pushRow(r);
for (const r of multi.values()) pushRow(r);
out.sort((a, b) => b.p - a.p);

const sum2 = [...rows.values()].reduce((a, r) => a + r.p, 0);
const doc = {
  generated: new Date().toISOString(),
  rules: '6 decks, dealer hits soft 17, DAS, dealer peeks. Multi-card odds assume correct play with surrender off.',
  twoCardCount: rows.size,
  multiCardCount: multi.size,
  rows: out,
};
const file = path.join(__dirname, '..', 'strategy-odds.json');
fs.writeFileSync(file, JSON.stringify(doc));

console.log(`Two-card situations: ${rows.size} (sum of probabilities ${sum2.toFixed(6)} — the rest is player blackjacks)`);
console.log(`Multi-card situations: ${multi.size}`);
console.log(`Probability range: ${out[out.length - 1].p.toExponential(3)} .. ${out[0].p.toExponential(3)}`);
console.log(`Monte Carlo: ${MC_HANDS.toLocaleString()} hands in ${mcSecs}s`);
console.log(`  two-card:   ${r2.pass} pass, ${r2.fail} fail, ${r2.skipped} too rare to measure; worst error ${(r2.worst * 100).toFixed(2)}%`);
console.log(`  multi-card: ${rM.pass} pass, ${rM.fail} fail, ${rM.skipped} too rare to measure; worst error ${(rM.worst * 100).toFixed(2)}%`);
for (const f of [...r2.failures, ...rM.failures]) console.log('  FAIL ' + f);
console.log(`Wrote ${path.relative(process.cwd(), file)} (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
if (r2.fail || rM.fail) process.exit(1);
