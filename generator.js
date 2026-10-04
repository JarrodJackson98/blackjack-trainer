/*
 * Rare Hand Generation Filter — Weighted RNG Card Generator controlled by a
 * Dynamic Probability Threshold Slider, plus the shoe and the Conditional Dealing Loop.
 * Works in the browser (window.BJGenerator) and Node.
 */
(function (root) {
  'use strict';

  const S = typeof module !== 'undefined' && module.exports ? require('./strategy.js') : root.BJStrategy;

  const DECKS = 6;
  const SUITS = ['♠', '♥', '♦', '♣'];
  const FACES = { 2: ['2'], 3: ['3'], 4: ['4'], 5: ['5'], 6: ['6'], 7: ['7'], 8: ['8'], 9: ['9'], 10: ['10', 'J', 'Q', 'K'], 11: ['A'] };

  // ---------- categories ----------
  const CATEGORIES = [
    { id: 'softDoubles', label: 'Soft doubles (A,2–A,7 vs 2–6)' },
    { id: 'soft18', label: 'Soft 18 (A,7) vs 2, 9, 10, A' },
    { id: 'a8v6', label: 'A,8 vs 6' },
    { id: 'stiffs', label: 'Stiff hands (12 vs 2–4, 13 vs 2, 15 vs 10, 16 vs 7–A)' },
    { id: 'hardDoubles', label: 'Hard doubles (9 vs 2/7, 10 vs 9/10, 11 vs 10/A)' },
    { id: 'trickyPairs', label: 'Tricky pairs' },
    { id: 'rare', label: 'Rare deals (A,A vs any, pairs vs A)' },
    { id: 'all', label: 'Any situation (slider decides)' },
    { id: 'multi', label: 'Multi-card hands (3–4 cards, no double)' },
    { id: 'surrender', label: 'Surrender spots', needsSurrender: true },
  ];

  // Categories for a situation: cards = player card values, up = upcard value
  function categorize(cards, up) {
    const cats = [];
    const n = cards.length;
    const { total, soft } = S.handValue(cards);
    const isPair = n === 2 && cards[0] === cards[1];
    const pairV = isPair ? cards[0] : 0;
    const has = (list) => list.includes(up);

    if (n > 2) {
      cats.push('multi');
      return cats;
    }
    cats.push('all');
    if (soft && !isPair && total >= 13 && total <= 18 && has([2, 3, 4, 5, 6])) cats.push('softDoubles');
    if (soft && !isPair && total === 18 && has([2, 9, 10, 11])) cats.push('soft18');
    if (soft && !isPair && total === 19 && up === 6) cats.push('a8v6');
    if (!soft && (!isPair || pairV === 5)) {
      if ((total === 12 && has([2, 3, 4])) || (total === 13 && up === 2) || (total === 15 && up === 10) || (total === 16 && has([7, 8, 9, 10, 11]))) {
        if (!isPair) cats.push('stiffs');
      }
      if ((total === 9 && has([2, 7])) || (total === 10 && has([9, 10])) || (total === 11 && has([10, 11]))) cats.push('hardDoubles');
    }
    if (isPair) {
      if ((pairV === 9 && has([7, 8, 9, 11])) || (pairV === 4 && has([5, 6])) ||
          ([2, 3, 6, 7].includes(pairV) && up === 7) || (pairV === 8 && has([10, 11]))) cats.push('trickyPairs');
      if (pairV === 11 || up === 11) cats.push('rare');
    }
    if (S.surrenderCode(cards, up)) cats.push('surrender');
    return cats;
  }

  // ---------- labels / ids ----------
  const sortCards = (cards) => cards.slice().sort((a, b) => b - a);
  function situationId(cards, up) {
    return sortCards(cards).map(S.cardName).join('-') + '|' + S.upName(up);
  }
  function situationLabel(cards, up) {
    const sc = sortCards(cards);
    // Show aces first: A,7 rather than 7,A
    const shown = sc.map(S.cardName).join(',');
    const { total, soft } = S.handValue(cards);
    const u = S.upName(up);
    if (cards.length === 2 && cards[0] === cards[1]) return `Pair ${shown} vs ${u}`;
    return `${soft ? 'Soft' : 'Hard'} ${total} (${shown}) vs ${u}`;
  }

  // ---------- RNG ----------
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function defaultRng() {
    if (root.crypto && root.crypto.getRandomValues) {
      const buf = new Uint32Array(1);
      return () => {
        root.crypto.getRandomValues(buf);
        return buf[0] / 4294967296;
      };
    }
    return Math.random;
  }

  // ---------- shoe ----------
  class Shoe {
    constructor(decks = DECKS, rng = defaultRng()) {
      this.rng = rng;
      this.decks = decks;
      this.cards = [];
      for (let d = 0; d < decks; d++)
        for (const suit of SUITS)
          for (let v = 2; v <= 11; v++)
            for (const face of FACES[v]) this.cards.push({ v, face, suit });
      this.size = this.cards.length;
      this.shuffle();
    }
    shuffle() {
      const c = this.cards;
      for (let i = c.length - 1; i > 0; i--) {
        const j = Math.floor(this.rng() * (i + 1));
        [c[i], c[j]] = [c[j], c[i]];
      }
    }
    get remaining() { return this.cards.length; }
    draw() { return this.cards.pop(); }
    // Remove and return a random card of value v (random suit/face)
    take(v) {
      const idx = [];
      for (let i = 0; i < this.cards.length; i++) if (this.cards[i].v === v) idx.push(i);
      if (!idx.length) return null;
      const i = idx[Math.floor(this.rng() * idx.length)];
      return this.cards.splice(i, 1)[0];
    }
  }

  // ---------- odds matrix ----------
  // JSON rows: { id, c: [cards], u, p, a, as, cat: [...] }
  function prepareMatrix(json) {
    return json.rows.map((r) => ({
      id: r.id, cards: r.c, up: r.u, prob: r.p, action: r.a, actionSurr: r.as, cats: r.cat,
      label: situationLabel(r.c, r.u), multi: r.c.length > 2,
    }));
  }

  // ---------- Probability Thresholding ----------
  /**
   * opts: { categories: string[], surrender: bool, mode: 'prob'|'pct', threshold: number (probability), percentile: 1..100 }
   * Returns { eligible, pool } — pool = rows in the selected categories, eligible = pool after the threshold cut.
   */
  function filterSituations(rows, opts) {
    const cats = new Set(opts.categories || []);
    if (!opts.surrender) cats.delete('surrender');
    const pool = rows.filter((r) => r.cats.some((c) => cats.has(c)));
    let eligible;
    if (opts.mode === 'pct') {
      const sorted = pool.slice().sort((a, b) => a.prob - b.prob);
      const n = Math.max(0, Math.ceil(sorted.length * (opts.percentile / 100)));
      eligible = sorted.slice(0, n);
    } else {
      // Discard anything more common than the threshold (tiny epsilon for float equality)
      eligible = pool.filter((r) => r.prob <= opts.threshold * (1 + 1e-9));
    }
    return { eligible, pool };
  }

  function sliderRange(pool) {
    if (!pool.length) return { min: 1e-6, max: 1 };
    let min = Infinity, max = 0;
    for (const r of pool) {
      if (r.prob < min) min = r.prob;
      if (r.prob > max) max = r.prob;
    }
    return { min, max };
  }
  // Logarithmic slider: position 0..1000 <-> probability
  const SLIDER_STEPS = 1000;
  function sliderToProb(pos, range) {
    if (range.max <= range.min) return range.max;
    const lmin = Math.log(range.min), lmax = Math.log(range.max);
    return Math.exp(lmin + (pos / SLIDER_STEPS) * (lmax - lmin));
  }
  function probToSlider(p, range) {
    if (range.max <= range.min) return SLIDER_STEPS;
    const lmin = Math.log(range.min), lmax = Math.log(range.max);
    const pos = ((Math.log(p) - lmin) / (lmax - lmin)) * SLIDER_STEPS;
    return Math.min(SLIDER_STEPS, Math.max(0, Math.round(pos)));
  }

  // ---------- Weighted RNG pick ----------
  /**
   * weighting: 'uniform' | 'natural'; missRate: optional (id) => 0..1 for "Weakest spots".
   * lastId: avoid an immediate repeat unless only one situation is eligible.
   */
  function pickSituation(eligible, { weighting = 'uniform', missRate = null, lastId = null, rng = defaultRng() } = {}) {
    if (!eligible.length) return null;
    let cands = eligible;
    if (lastId && eligible.length > 1) cands = eligible.filter((r) => r.id !== lastId);
    const weights = cands.map((r) => {
      let w = weighting === 'natural' ? r.prob : 1;
      if (missRate) w *= 0.05 + missRate(r.id);
      return w;
    });
    const sum = weights.reduce((a, b) => a + b, 0);
    let x = rng() * sum;
    for (let i = 0; i < cands.length; i++) {
      x -= weights[i];
      if (x < 0) return cands[i];
    }
    return cands[cands.length - 1];
  }

  // ---------- Conditional Dealing Loop ----------
  /**
   * Turn a situation into real cards from a fresh shoe. Verifies the deal reproduces the situation;
   * redeals (max 100 tries). Dealer hole card never gives the dealer a peeked blackjack.
   * Returns { player: [card], up: card, hole: card, shoe } or null.
   */
  function dealSituation(row, rng = defaultRng(), maxTries = 100) {
    for (let t = 0; t < maxTries; t++) {
      const shoe = new Shoe(DECKS, rng);
      const player = row.cards.map((v) => shoe.take(v));
      const up = shoe.take(row.up);
      if (player.some((c) => !c) || !up) continue;
      let hole = shoe.draw();
      // Dealer peek: re-deal the hole card while it would give the dealer blackjack
      let guard = 0;
      while ((up.v === 11 && hole.v === 10) || (up.v === 10 && hole.v === 11)) {
        shoe.cards.unshift(hole);
        hole = shoe.draw();
        if (++guard > 50) break;
      }
      if (S.isBlackjack([up.v, hole.v])) continue;
      const ok = situationId(player.map((c) => c.v), up.v) === row.id;
      if (ok) return { player, up, hole, shoe, tries: t + 1 };
    }
    if (typeof console !== 'undefined') console.warn('dealSituation: could not reproduce', row.id);
    return null;
  }

  // ---------- formatting ----------
  function oneIn(p) {
    if (!p) return '—';
    const n = Math.round(1 / p);
    return '1 in ' + n.toLocaleString('en-AU');
  }
  function pct(p) {
    if (p >= 0.01) return (p * 100).toFixed(2) + '%';
    if (p >= 0.0001) return (p * 100).toFixed(3) + '%';
    return (p * 100).toPrecision(2) + '%';
  }

  const api = {
    DECKS, SUITS, FACES, CATEGORIES, SLIDER_STEPS,
    categorize, situationId, situationLabel, mulberry32, defaultRng, Shoe,
    prepareMatrix, filterSituations, sliderRange, sliderToProb, probToSlider,
    pickSituation, dealSituation, oneIn, pct,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BJGenerator = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
