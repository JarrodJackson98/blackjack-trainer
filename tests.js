/*
 * Test suite — runs in tests.html (browser) and via `node scripts/run-tests.js`.
 * The expected chart below is typed out independently of strategy.js so a typo in one is caught by the other.
 */
(function (root) {
  'use strict';

  // Columns: dealer 2 3 4 5 6 7 8 9 10 A
  const EXPECTED = {
    hard: {
      5: 'H H H H H H H H H H', 6: 'H H H H H H H H H H', 7: 'H H H H H H H H H H', 8: 'H H H H H H H H H H',
      9: 'H D D D D H H H H H', 10: 'D D D D D D D D H H', 11: 'D D D D D D D D D D',
      12: 'H H S S S H H H H H', 13: 'S S S S S H H H H H', 14: 'S S S S S H H H H H',
      15: 'S S S S S H H H H H', 16: 'S S S S S H H H H H', 17: 'S S S S S S S S S S',
      18: 'S S S S S S S S S S', 19: 'S S S S S S S S S S', 20: 'S S S S S S S S S S', 21: 'S S S S S S S S S S',
    },
    soft: { // second card with an ace
      2: 'H H H D D H H H H H', 3: 'H H H D D H H H H H', 4: 'H H D D D H H H H H', 5: 'H H D D D H H H H H',
      6: 'H D D D D H H H H H', 7: 'Ds Ds Ds Ds Ds S S H H H', 8: 'S S S S Ds S S S S S', 9: 'S S S S S S S S S S',
    },
    pair: {
      2: 'P P P P P P H H H H', 3: 'P P P P P P H H H H', 4: 'H H H P P H H H H H', 5: 'D D D D D D D D H H',
      6: 'P P P P P H H H H H', 7: 'P P P P P P H H H H', 8: 'P P P P P P P P P P', 9: 'P P P P P S P P S S',
      10: 'S S S S S S S S S S', 11: 'P P P P P P P P P P',
    },
    surrender: ['15|10', '15|11', '16|9', '16|10', '16|11', '17|11', '8,8|11'],
  };
  const UPS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const exp = (s) => s.split(' ');

  // Two non-ace, non-pair cards making hard t (falls back to 3 cards for 20/21)
  function hardCards(t) {
    for (let a = 10; a >= 2; a--) {
      const b = t - a;
      if (b >= 2 && b <= 10 && b !== a) return [a, b];
    }
    if (t === 20) return [10, 6, 4];
    if (t === 21) return [10, 9, 2];
    if (t === 4) return [2, 2];
    return null;
  }

  function chiSquareCritical(df, z = 3.09) { // Wilson–Hilferty, z=3.09 ≈ α 0.001
    const a = 2 / (9 * df);
    return df * Math.pow(1 - a + z * Math.sqrt(a), 3);
  }

  function run(S, G, oddsJson) {
    const results = [];
    const test = (name, fn) => {
      try {
        const msg = fn();
        results.push({ name, ok: true, msg: msg || '' });
      } catch (e) {
        results.push({ name, ok: false, msg: e.message });
      }
    };
    const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

    // ---- every chart cell ----
    test('Hard totals 5–21: every cell', () => {
      let n = 0;
      for (const t of Object.keys(EXPECTED.hard).map(Number)) {
        const cards = hardCards(t);
        exp(EXPECTED.hard[t]).forEach((code, i) => {
          const up = UPS[i];
          const want = code === 'D' ? 'D' : code;
          const got = S.getAction(cards, up, { canDouble: true, canSplit: false }).action;
          assert(got === want, `hard ${t} vs ${up}: expected ${want}, got ${got}`);
          n++;
        });
      }
      return `${n} cells`;
    });
    test('Soft totals A,2–A,9: every cell', () => {
      let n = 0;
      for (const k of Object.keys(EXPECTED.soft).map(Number)) {
        exp(EXPECTED.soft[k]).forEach((code, i) => {
          const up = UPS[i];
          const want = code === 'Ds' ? 'D' : code;
          const got = S.getAction([11, k], up, { canDouble: true, canSplit: false }).action;
          assert(got === want, `A,${k} vs ${up}: expected ${want}, got ${got}`);
          n++;
        });
      }
      return `${n} cells`;
    });
    test('Pairs 2,2–A,A with DAS: every cell', () => {
      let n = 0;
      for (const v of Object.keys(EXPECTED.pair).map(Number)) {
        exp(EXPECTED.pair[v]).forEach((code, i) => {
          const up = UPS[i];
          const got = S.getAction([v, v], up, { canDouble: true, canSplit: true }).action;
          assert(got === code, `${v},${v} vs ${up}: expected ${code}, got ${got}`);
          n++;
        });
      }
      return `${n} cells`;
    });
    test('No-double fallbacks: D→Hit and Ds→Stand on 3+ cards', () => {
      assert(S.getAction([11, 3, 4], 4, { canDouble: false }).action === 'S', 'multi-card soft 18 vs 4 should STAND');
      assert(S.getAction([11, 3, 4], 9, { canDouble: false }).action === 'H', 'multi-card soft 18 vs 9 should HIT');
      assert(S.getAction([11, 2, 6], 6, { canDouble: false }).action === 'S', 'multi-card soft 19 vs 6 should STAND');
      assert(S.getAction([11, 2, 4], 6, { canDouble: false }).action === 'H', 'multi-card soft 17 vs 6 should HIT');
      assert(S.getAction([4, 3, 4], 6, { canDouble: false }).action === 'H', 'multi-card 11 vs 6 should HIT');
      assert(S.getAction([2, 4, 4], 10, { canDouble: false }).action === 'H', 'multi-card 10 vs 10 should HIT');
    });
    test('16 vs 10: hit without surrender, surrender with it', () => {
      assert(S.getAction([10, 6], 10, { canSurrender: false }).action === 'H', 'expected H without surrender');
      assert(S.getAction([10, 6], 10, { canSurrender: true }).action === 'R', 'expected R with surrender');
      assert(S.getAction([10, 4, 2], 10, { canSurrender: false, canDouble: false }).action === 'H', '3-card 16 vs 10 hits');
    });
    test('Late surrender overrides (H17): every cell', () => {
      let n = 0;
      for (const t of [15, 16, 17]) {
        for (const up of UPS) {
          const want = EXPECTED.surrender.includes(`${t}|${up}`);
          const got = S.getAction(hardCards(t), up, { canSurrender: true }).action === 'R';
          assert(got === want, `hard ${t} vs ${up}: surrender ${want ? 'expected' : 'not expected'}`);
          n++;
        }
      }
      for (const up of UPS) {
        const got = S.getAction([8, 8], up, { canSplit: true, canSurrender: true }).action;
        const want = up === 11 ? 'R' : 'P';
        assert(got === want, `8,8 vs ${up}: expected ${want}, got ${got}`);
        n++;
      }
      assert(S.getAction([9, 7], 10, { canSurrender: false }).action === 'H', 'surrender off: no R');
      return `${n} cells`;
    });
    test('Split legality: unsplittable pairs fall back to totals', () => {
      assert(S.getAction([8, 8], 10, { canSplit: false }).action === 'H', '8,8 unsplittable vs 10 → hit 16');
      assert(S.getAction([11, 11], 6, { canSplit: false }).action === 'H', 'A,A unsplittable → hit soft 12');
      assert(S.getAction([9, 9], 6, { canSplit: false }).action === 'S', '9,9 unsplittable → stand 18');
    });
    test('Every situation has a reason', () => {
      for (const up of UPS)
        for (let a = 2; a <= 11; a++)
          for (let b = a; b <= 11; b++) {
            const r = S.reason([a, b], up, { canSplit: true, canDouble: true, canSurrender: true });
            assert(typeof r === 'string' && r.length > 5, `no reason for ${a},${b} vs ${up}`);
          }
    });

    // ---- odds matrix ----
    const rows = G.prepareMatrix(oddsJson);
    test('Odds matrix: 540 two-card situations summing to 1 − P(blackjack)', () => {
      const two = rows.filter((r) => !r.multi);
      const sum = two.reduce((a, r) => a + r.prob, 0);
      const pBJ = (2 * 24 * 96) / (312 * 311);
      assert(two.length === 540, `expected 540, got ${two.length}`);
      assert(Math.abs(sum - (1 - pBJ)) < 1e-4, `sum ${sum} vs ${1 - pBJ}`);
      return `${two.length} two-card + ${rows.length - two.length} multi-card rows`;
    });
    test('Odds matrix: spot values (exact combinatorics)', () => {
      const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
      const aa = (24 / 312) * (23 / 311) * (22 / 310);
      assert(Math.abs(byId['A-A|A'].prob / aa - 1) < 1e-4, `A,A vs A: ${byId['A-A|A'].prob} vs ${aa}`);
      const t6 = 2 * (96 / 312) * (24 / 311) * (95 / 310);
      assert(Math.abs(byId['10-6|10'].prob / t6 - 1) < 1e-4, `10,6 vs 10: ${byId['10-6|10'].prob} vs ${t6}`);
      return `A,A vs A = ${G.oneIn(aa)}, 10,6 vs 10 = ${G.oneIn(t6)}`;
    });
    test('Odds matrix: stored actions match the strategy engine', () => {
      for (const r of rows) {
        const two = r.cards.length === 2;
        const a = S.getAction(r.cards, r.up, { canDouble: two, canSplit: two, canSurrender: false }).action;
        assert(a === r.action, `${r.id}: matrix ${r.action}, engine ${a}`);
      }
    });

    // ---- threshold filter + generator ----
    const ALL_CATS = G.CATEGORIES.map((c) => c.id);
    const rng = G.mulberry32(42);
    test('Threshold filter: 10,000 deals never exceed the threshold (5 settings)', () => {
      const range = G.sliderRange(rows);
      let deals = 0;
      for (const pos of [50, 250, 500, 750, 1000]) {
        const threshold = G.sliderToProb(pos, range);
        const { eligible } = G.filterSituations(rows, { categories: ALL_CATS, surrender: true, mode: 'prob', threshold });
        assert(eligible.length > 0, `no eligible rows at pos ${pos}`);
        let last = null;
        for (let i = 0; i < 2000; i++) {
          const r = G.pickSituation(eligible, { weighting: i % 2 ? 'natural' : 'uniform', lastId: last, rng });
          last = r.id;
          assert(r.prob <= threshold * (1 + 1e-9), `dealt ${r.id} (${r.prob}) above threshold ${threshold}`);
          deals++;
        }
      }
      return `${deals} deals checked`;
    });
    test('Category AND threshold: only selected categories are dealt', () => {
      const { eligible } = G.filterSituations(rows, { categories: ['trickyPairs'], mode: 'prob', threshold: 1 });
      assert(eligible.length > 0 && eligible.every((r) => r.cats.includes('trickyPairs')), 'leak from other categories');
      const none = G.filterSituations(rows, { categories: ['trickyPairs'], mode: 'prob', threshold: 1e-9 });
      assert(none.eligible.length === 0, 'expected empty set');
      const surr = G.filterSituations(rows, { categories: ['surrender'], surrender: false, mode: 'prob', threshold: 1 });
      assert(surr.eligible.length === 0, 'surrender spots must be hidden when surrender is off');
    });
    test('Percentile mode keeps only the rarest N%', () => {
      const { eligible, pool } = G.filterSituations(rows, { categories: ['all'], mode: 'pct', percentile: 10 });
      assert(eligible.length === Math.ceil(pool.length * 0.1), 'wrong count');
      const maxE = Math.max(...eligible.map((r) => r.prob));
      const rest = pool.filter((r) => !eligible.includes(r));
      assert(rest.every((r) => r.prob >= maxE), 'a commoner situation was kept over a rarer one');
      return `${eligible.length} of ${pool.length}`;
    });
    test('Uniform weighting: equal frequencies (chi-square, α=0.001)', () => {
      const { eligible } = G.filterSituations(rows, { categories: ['trickyPairs', 'softDoubles'], mode: 'prob', threshold: 1 });
      const N = 10000;
      const hits = new Map(eligible.map((r) => [r.id, 0]));
      let last = null;
      for (let i = 0; i < N; i++) {
        const r = G.pickSituation(eligible, { weighting: 'uniform', lastId: last, rng });
        last = r.id;
        hits.set(r.id, hits.get(r.id) + 1);
      }
      const e = N / eligible.length;
      let chi = 0;
      for (const h of hits.values()) chi += ((h - e) ** 2) / e;
      const crit = chiSquareCritical(eligible.length - 1);
      assert(chi < crit, `chi² ${chi.toFixed(1)} ≥ ${crit.toFixed(1)}`);
      return `${eligible.length} situations, χ²=${chi.toFixed(1)} < ${crit.toFixed(1)}`;
    });
    test('Natural weighting: matches matrix proportions (chi-square, α=0.001)', () => {
      const { eligible } = G.filterSituations(rows, { categories: ['stiffs', 'hardDoubles'], mode: 'prob', threshold: 1 });
      const N = 10000;
      const hits = new Map(eligible.map((r) => [r.id, 0]));
      for (let i = 0; i < N; i++) {
        const r = G.pickSituation(eligible, { weighting: 'natural', rng });
        hits.set(r.id, hits.get(r.id) + 1);
      }
      const sum = eligible.reduce((a, r) => a + r.prob, 0);
      let chi = 0;
      for (const r of eligible) {
        const e = (N * r.prob) / sum;
        chi += ((hits.get(r.id) - e) ** 2) / e;
      }
      const crit = chiSquareCritical(eligible.length - 1);
      assert(chi < crit, `chi² ${chi.toFixed(1)} ≥ ${crit.toFixed(1)}`);
      return `${eligible.length} situations, χ²=${chi.toFixed(1)} < ${crit.toFixed(1)}`;
    });
    test('No immediate repeats', () => {
      const { eligible } = G.filterSituations(rows, { categories: ['a8v6', 'soft18'], mode: 'prob', threshold: 1 });
      let last = null;
      for (let i = 0; i < 1000; i++) {
        const r = G.pickSituation(eligible, { lastId: last, rng });
        assert(r.id !== last, 'repeat');
        last = r.id;
      }
    });
    test('Conditional Dealing Loop: deals reproduce the situation, no dealer blackjack (every row)', () => {
      let n = 0, retries = 0;
      for (const r of rows) {
        const d = G.dealSituation(r, rng);
        assert(d, `could not deal ${r.id}`);
        assert(G.situationId(d.player.map((c) => c.v), d.up.v) === r.id, `${r.id} not reproduced`);
        assert(!S.isBlackjack([d.up.v, d.hole.v]), `${r.id}: dealer blackjack`);
        assert(d.shoe.remaining === 312 - r.cards.length - 2, `${r.id}: shoe count wrong`);
        retries += d.tries - 1;
        n++;
      }
      return `${n} situations dealt, ${retries} retries`;
    });

    return results;
  }

  const api = { run, EXPECTED };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BJTests = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
