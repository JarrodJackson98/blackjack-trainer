/* Blackjack Basic Strategy Trainer — UI and game engine */
(function () {
  'use strict';
  const S = window.BJStrategy;
  const G = window.BJGenerator;
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- storage ----------
  const store = {
    get(k, d) {
      try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; }
    },
    set(k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode etc. */ }
    },
  };

  const DEFAULT_CATS = ['softDoubles', 'soft18', 'a8v6', 'stiffs', 'hardDoubles', 'trickyPairs', 'rare'];
  const settings = Object.assign({
    mode: 'drill',
    surrender: false,
    totals: true,
    betting: true,
    playSplitAces: false, // house rule: hit/double/re-split after splitting aces
    startStack: 1000,
    categories: DEFAULT_CATS,
    threshMode: 'prob',
    threshold: 1, // probability; clamped to the slider range
    percentile: 100,
    weighting: 'uniform',
    weakest: false,
  }, store.get('bjt.settings', {}));
  const saveSettings = () => store.set('bjt.settings', settings);

  const stats = Object.assign({ byKey: {}, streak: 0, best: 0 }, store.get('bjt.stats', {}));
  const saveStats = () => store.set('bjt.stats', stats);
  delete settings.bankroll; // replaced by `betting`
  const MIN_BET = 5;
  let stack = store.get('bjt.stack', settings.startStack);
  let betSize = store.get('bjt.bet', 25);
  const saveMoney = () => { store.set('bjt.stack', stack); store.set('bjt.bet', betSize); };
  const bettingOn = () => settings.betting && settings.mode !== 'quiz';
  const money = (n) => '$' + n.toLocaleString('en-AU', Number.isInteger(n) ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // ---------- odds matrix ----------
  let rows = [];
  let rowById = new Map();
  let filterResult = { eligible: [], pool: [] };
  let range = { min: 1e-6, max: 1 };

  function refilter() {
    const base = { categories: settings.categories, surrender: settings.surrender };
    const poolOnly = G.filterSituations(rows, { ...base, mode: 'prob', threshold: Infinity });
    range = G.sliderRange(poolOnly.pool);
    if (settings.threshold > range.max) settings.threshold = range.max;
    if (settings.threshold < range.min) settings.threshold = range.min;
    filterResult = G.filterSituations(rows, {
      ...base, mode: settings.threshMode, threshold: settings.threshold, percentile: settings.percentile,
    });
  }

  // ---------- game state ----------
  const game = {
    shoe: null,
    dealer: [],
    hands: [],
    active: 0,
    phase: 'idle', // idle | player | dealer | done
    row: null, // situation from the matrix (drill/quiz)
    lastId: null,
    scored: false, // current decision already scored
    hintUsed: false,
    busy: false,
  };

  const val = (cards) => cards.map((c) => c.v);
  const hv = (cards) => S.handValue(val(cards));

  function legal(hand) {
    if (!hand) return {};
    const two = hand.cards.length === 2;
    const pair = two && hand.cards[0].v === hand.cards[1].v;
    const afford = !bettingOn() || stack >= hand.bet; // doubling/splitting puts up another bet
    return {
      canHit: !hand.splitAces,
      canDouble: two && !hand.splitAces && afford,
      canSplit: pair && afford && game.hands.length < 4 && !(hand.cards[0].v === 11 && hand.fromSplit && !settings.playSplitAces),
      canSurrender: settings.surrender && two && game.hands.length === 1 && !hand.fromSplit,
    };
  }

  function decisionKey(hand) {
    const id = G.situationId(val(hand.cards), game.dealer[0].v);
    return hand.fromSplit ? 'split:' + id : id;
  }

  function correctFor(hand) {
    const l = legal(hand);
    const cards = val(hand.cards);
    const up = game.dealer[0].v;
    const r = S.getAction(cards, up, l);
    return { action: r.action, reason: S.reason(cards, up, l), legal: l };
  }

  // ---------- dealing ----------
  function freshShoeIfNeeded() {
    if (!game.shoe || game.shoe.remaining < 312 * 0.25) {
      game.shoe = new G.Shoe();
      return true;
    }
    return false;
  }

  function newHand(cards, extra) {
    return Object.assign({ cards, bet: game.stake, done: false, doubled: false, fromSplit: false, splitAces: false, surrendered: false, result: null }, extra);
  }

  async function deal() {
    if (game.busy) return;
    hideSheet();
    if (settings.mode !== 'full' && !filterResult.eligible.length) {
      setMessage('No hands match. Raise the threshold or select more categories.', 'bad');
      return;
    }
    game.stake = 0;
    if (bettingOn()) {
      if (stack < MIN_BET) {
        setMessage('Out of chips. Tap Rebuy to reload your stack.', 'bad');
        render();
        return;
      }
      if (betSize < MIN_BET) {
        setMessage(`Place a bet first (min ${money(MIN_BET)})`, 'bad');
        return;
      }
      // If the stack can't cover your bet, this hand goes all-in; your chosen bet is kept for later
      game.stake = Math.min(betSize, Math.floor(stack / MIN_BET) * MIN_BET);
      stack -= game.stake;
      saveMoney();
    }
    game.scored = false;
    game.hintUsed = false;
    setMessage('');

    if (settings.mode === 'full') {
      const shuffled = freshShoeIfNeeded();
      const sh = game.shoe;
      const p1 = sh.draw(), up = sh.draw(), p2 = sh.draw(), hole = sh.draw();
      game.dealer = [up, hole];
      game.hands = [newHand([p1, p2])];
      game.row = rowById.get(G.situationId([p1.v, p2.v], up.v)) || null;
      game.active = 0;
      game.holeHidden = true;
      if (shuffled) setMessage('New shoe shuffled');

      const dealerBJ = S.isBlackjack([up.v, hole.v]);
      const playerBJ = S.isBlackjack([p1.v, p2.v]);
      if (dealerBJ || playerBJ) {
        game.holeHidden = !dealerBJ;
        const h = game.hands[0];
        h.done = true;
        if (dealerBJ && playerBJ) h.result = 'push';
        else if (dealerBJ) h.result = 'lose';
        else h.result = 'blackjack';
        game.phase = 'done';
        game.holeHidden = false;
        settleBankroll();
        render();
        setMessage((dealerBJ ? (playerBJ ? 'Both blackjack: push' : 'Dealer blackjack') : 'Blackjack! Pays 3:2') + netText(), dealerBJ && !playerBJ ? 'bad' : 'good');
        return;
      }
    } else {
      const missRate = settings.weakest ? missRateFn() : null;
      const row = G.pickSituation(filterResult.eligible, { weighting: settings.weighting, missRate, lastId: game.lastId });
      const d = G.dealSituation(row);
      if (!d) {
        stack += game.stake;
        saveMoney();
        setMessage('Could not deal that situation — try again', 'bad');
        return;
      }
      game.row = row;
      game.lastId = row.id;
      game.shoe = d.shoe;
      game.dealer = [d.up, d.hole];
      game.hands = [newHand(d.player)];
      game.active = 0;
      game.holeHidden = true;
    }
    game.phase = 'player';
    render();
  }

  // ---------- scoring ----------
  function record(key, outcome) {
    const s = stats.byKey[key] || (stats.byKey[key] = { c: 0, w: 0, a: 0 });
    s[outcome]++;
    if (outcome === 'c') {
      stats.streak++;
      stats.best = Math.max(stats.best, stats.streak);
    } else if (outcome === 'w') stats.streak = 0;
    saveStats();
  }

  function missRateFn() {
    return (id) => {
      const s = stats.byKey[id];
      if (!s) return 0.5;
      return (s.w + 1) / (s.c + s.w + 2);
    };
  }

  // ---------- actions ----------
  async function onAction(a) {
    if (game.phase !== 'player' || game.busy) return;
    const hand = game.hands[game.active];
    const corr = correctFor(hand);
    const key = decisionKey(hand);
    const right = a === corr.action;
    const btn = document.querySelector(`.act[data-a="${a}"]`);

    if (!game.scored) {
      record(key, game.hintUsed ? 'a' : right ? 'c' : 'w');
      game.scored = true;
    }

    if (settings.mode === 'quiz') {
      flash(btn, right);
      if (right) {
        setMessage(`✓ ${S.ACTION_NAMES[a]}`, 'good');
        game.phase = 'done';
        game.holeHidden = false;
        render();
        game.busy = true;
        await sleep(650);
        game.busy = false;
        if (settings.mode === 'quiz' && game.phase === 'done') deal();
      } else {
        showSheet({
          kind: 'bad',
          title: `✗ ${S.ACTION_NAMES[a]} is wrong. Correct: ${S.ACTION_NAMES[corr.action]}`,
          body: corr.reason,
          buttons: [
            { label: 'Retry', fn: () => hideSheet() },
            { label: 'Next hand', primary: true, fn: () => { hideSheet(); deal(); } },
          ],
        });
      }
      return;
    }

    if (right) {
      flash(btn, true);
      hideSheet();
      await apply(a);
    } else {
      flash(btn, false);
      showSheet({
        kind: 'bad',
        title: `✗ ${S.ACTION_NAMES[a]} is wrong. Correct: ${S.ACTION_NAMES[corr.action]}`,
        body: corr.reason,
        buttons: [
          { label: 'Retry', primary: true, fn: () => hideSheet() },
          { label: `Continue with ${S.ACTION_NAMES[a]}`, fn: () => { hideSheet(); apply(a); } },
        ],
      });
    }
  }

  async function apply(a) {
    const hand = game.hands[game.active];
    const sh = game.shoe;
    game.busy = true;
    if (a === 'H') {
      hand.cards.push(sh.draw());
      const { total } = hv(hand.cards);
      if (total >= 21) hand.done = true;
    } else if (a === 'S') {
      hand.done = true;
    } else if (a === 'D') {
      if (bettingOn()) stack -= hand.bet;
      hand.bet *= 2;
      hand.doubled = true;
      hand.cards.push(sh.draw());
      hand.done = true;
    } else if (a === 'R') {
      hand.surrendered = true;
      hand.done = true;
    } else if (a === 'P') {
      // Standard rule: split aces get one card each. The house-rule setting lets you play them on.
      const aces = hand.cards[0].v === 11 && !settings.playSplitAces;
      const second = hand.cards.pop();
      const h2 = newHand([second], { fromSplit: true, splitAces: aces, bet: hand.bet });
      if (bettingOn()) stack -= hand.bet;
      hand.fromSplit = true;
      hand.splitAces = aces;
      game.hands.splice(game.active + 1, 0, h2);
      render();
      await sleep(180);
      hand.cards.push(sh.draw());
      render();
      await sleep(180);
      h2.cards.push(sh.draw());
      if (aces) { hand.done = true; h2.done = true; }
      if (hv(hand.cards).total === 21) hand.done = true;
      if (hv(h2.cards).total === 21) h2.done = true;
    }
    game.busy = false;
    nextDecision();
  }

  function nextDecision() {
    game.scored = false;
    game.hintUsed = false;
    while (game.active < game.hands.length && game.hands[game.active].done) game.active++;
    if (game.active < game.hands.length) {
      const h = game.hands[game.active];
      // A split hand that's 21 or split aces needs no decision
      if (hv(h.cards).total >= 21 || h.splitAces) {
        h.done = true;
        return nextDecision();
      }
      render();
      return;
    }
    dealerPlay();
  }

  async function dealerPlay() {
    game.phase = 'dealer';
    game.holeHidden = false;
    game.active = -1;
    render();
    const live = game.hands.some((h) => !h.surrendered && hv(h.cards).total <= 21);
    game.busy = true;
    if (live) {
      // H17: hit below 17 and on soft 17
      for (;;) {
        const { total, soft } = hv(game.dealer);
        if (total < 17 || (total === 17 && soft)) {
          await sleep(420);
          game.dealer.push(game.shoe.draw());
          render();
        } else break;
      }
    }
    game.busy = false;
    settle();
  }

  function settle() {
    const d = hv(game.dealer).total;
    for (const h of game.hands) {
      const p = hv(h.cards).total;
      if (h.surrendered) h.result = 'surrender';
      else if (p > 21) h.result = 'bust';
      else if (d > 21 || p > d) h.result = 'win';
      else if (p < d) h.result = 'lose';
      else h.result = 'push';
    }
    game.phase = 'done';
    settleBankroll();
    render();
    const wins = game.hands.filter((h) => h.result === 'win').length;
    const losses = game.hands.filter((h) => ['lose', 'bust', 'surrender'].includes(h.result)).length;
    const dTxt = d > 21 ? 'Dealer busts' : `Dealer ${d}`;
    setMessage(`${dTxt} · ${wins} won, ${losses} lost${netText()}`, wins > losses ? 'good' : wins < losses ? 'bad' : '');
  }

  // Bets were taken off the stack when placed; pay back stake + winnings
  const PAYOUT = { win: 2, blackjack: 2.5, push: 1, surrender: 0.5, lose: 0, bust: 0 };
  function settleBankroll() {
    game.net = null;
    if (!bettingOn()) return;
    let back = 0, staked = 0;
    for (const h of game.hands) {
      back += h.bet * PAYOUT[h.result];
      staked += h.bet;
    }
    stack += back;
    game.net = back - staked;
    saveMoney();
  }
  const netText = () => (game.net === null || game.net === undefined ? ''
    : game.net > 0 ? ` · +${money(game.net)}` : game.net < 0 ? ` · −${money(-game.net)}` : ' · even');

  function onHint() {
    if (game.phase !== 'player') {
      showSheet({ kind: 'hint', title: 'Hint', body: 'Deal a hand first.', buttons: [{ label: 'OK', fn: hideSheet }] });
      return;
    }
    const hand = game.hands[game.active];
    const corr = correctFor(hand);
    if (!game.scored) game.hintUsed = true;
    showSheet({
      kind: 'hint',
      title: `💡 ${S.ACTION_NAMES[corr.action]}`,
      body: corr.reason + '<div class="sub">Hinted decisions count as "assisted", not correct.</div>',
      buttons: [
        { label: 'Chart', fn: () => { hideSheet(); openChart(); } },
        { label: 'Got it', primary: true, fn: hideSheet },
      ],
    });
  }

  // ---------- rendering ----------
  const animated = new WeakSet(); // only animate a card the first time it's drawn
  function cardEl(c, hidden) {
    const el = document.createElement('div');
    const anim = !animated.has(c);
    animated.add(c);
    if (hidden) {
      el.className = 'card back' + (anim ? ' anim' : '');
      return el;
    }
    const red = c.suit === '♥' || c.suit === '♦';
    el.className = 'card' + (red ? ' red' : '') + (anim ? ' anim' : '');
    el.innerHTML = `<span class="r">${c.face}</span><span class="s1">${c.suit}</span><span class="s2">${c.suit}</span>`;
    return el;
  }

  function totalText(cards, fromSplit) {
    const { total, soft } = hv(cards);
    if (total > 21) return `Bust ${total}`;
    if (S.isBlackjack(val(cards)) && !fromSplit) return 'Blackjack'; // A+10 after a split is just 21
    return (soft && total < 21 ? 'Soft ' : '') + total;
  }

  const RESULT_LABEL = { win: ['Win', 'win'], blackjack: ['Blackjack', 'win'], lose: ['Lose', 'lose'], bust: ['Bust', 'lose'], push: ['Push', 'push'], surrender: ['Surrendered', 'lose'] };

  function render() {
    // dealer
    const dc = $('dealerCards');
    dc.innerHTML = '';
    game.dealer.forEach((c, i) => dc.appendChild(cardEl(c, i === 1 && game.holeHidden)));
    $('dealerTotal').textContent = !settings.totals || !game.dealer.length ? ''
      : game.holeHidden ? S.upName(game.dealer[0].v) === 'A' ? 'A' : String(game.dealer[0].v) : totalText(game.dealer);

    // situation line
    const sit = $('situation');
    if (game.row && game.phase !== 'idle') {
      sit.innerHTML = `<div><b>${game.row.label}</b></div><div class="odds">${G.oneIn(game.row.prob)} hands · ${G.pct(game.row.prob)}</div>`;
    } else if (game.phase !== 'idle' && settings.mode === 'full') {
      sit.innerHTML = '<div>&nbsp;</div>';
    } else sit.innerHTML = '';

    // hands
    const hc = $('hands');
    hc.innerHTML = '';
    hc.classList.toggle('multi', game.hands.length > 1);
    game.hands.forEach((h, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'hand' + (i === game.active && game.phase === 'player' ? ' active' : '') + (h.done && game.phase === 'player' ? ' done' : '');
      const head = document.createElement('div');
      head.className = 'zone-head';
      const name = game.hands.length > 1 ? `Hand ${i + 1}` : 'You';
      let extra = '';
      if (settings.totals) extra += `<span class="total">${totalText(h.cards, h.fromSplit)}</span>`;
      if (bettingOn()) extra += `<span class="total bet">${money(h.bet)}</span>`;
      else if (h.doubled) extra += '<span class="total">×2</span>';
      if (h.result) {
        const [lab, cls] = RESULT_LABEL[h.result];
        extra += `<span class="result ${cls}">${lab}</span>`;
      }
      head.innerHTML = `<span>${name}</span>${extra}`;
      const cards = document.createElement('div');
      cards.className = 'cards';
      h.cards.forEach((c) => cards.appendChild(cardEl(c)));
      wrap.append(head, cards);
      hc.appendChild(wrap);
    });

    // buttons
    const hand = game.phase === 'player' ? game.hands[game.active] : null;
    const l = legal(hand);
    // Only legal actions are shown; between hands Hit/Stand stay visible (disabled) so the layout doesn't jump
    const show = hand
      ? { H: l.canHit, S: true, D: l.canDouble, P: l.canSplit, R: l.canSurrender }
      : { H: true, S: true, D: false, P: false, R: false };
    const betting = bettingOn() && (game.phase === 'idle' || game.phase === 'done');
    $('actions').hidden = betting;
    $('chips').hidden = !betting;
    document.querySelectorAll('.act').forEach((b) => {
      b.hidden = !show[b.dataset.a];
      b.disabled = !hand || game.busy;
    });
    if (betting) {
      const broke = stack < MIN_BET;
      document.querySelectorAll('.chip').forEach((c) => (c.disabled = broke || betSize + Number(c.dataset.chip) > stack));
      $('chipClear').hidden = broke;
      $('rebuy').hidden = !broke;
      const capped = Math.min(betSize, Math.floor(stack / MIN_BET) * MIN_BET);
      $('betLine').innerHTML = broke ? 'Out of chips'
        : capped < betSize ? `Bet <b>${money(capped)}</b> (all-in, your bet is ${money(betSize)})` : `Bet <b>${money(betSize)}</b>`;
    }
    $('dealBtn').disabled = game.phase === 'player' || game.phase === 'dealer';
    $('dealBtn').textContent = game.phase === 'idle' ? 'Deal' : 'Next hand';
    $('hintBtn').disabled = game.phase !== 'player';

    // header
    $('modePill').textContent = { full: 'Full game', drill: 'Edge drill', quiz: 'Quick quiz' }[settings.mode];
    const bk = $('bankroll');
    bk.hidden = !bettingOn();
    bk.textContent = 'Stack ' + money(stack);
  }

  function setMessage(t, cls) {
    const m = $('message');
    m.textContent = t;
    m.className = 'message' + (cls ? ' ' + cls : '');
  }

  function flash(btn, good) {
    if (!btn) return;
    btn.classList.remove('flash-good', 'flash-bad');
    void btn.offsetWidth;
    btn.classList.add(good ? 'flash-good' : 'flash-bad');
    setTimeout(() => btn.classList.remove('flash-good', 'flash-bad'), 500);
  }

  function showSheet({ kind, title, body, buttons }) {
    $('sheetTitle').textContent = title;
    $('sheetTitle').className = 'sheet-title ' + (kind || '');
    $('sheetBody').innerHTML = body;
    const bc = $('sheetButtons');
    bc.innerHTML = '';
    for (const b of buttons) {
      const el = document.createElement('button');
      el.textContent = b.label;
      if (b.primary) el.className = 'primary';
      el.onclick = b.fn;
      bc.appendChild(el);
    }
    $('sheet').hidden = false;
  }
  function hideSheet() { $('sheet').hidden = true; }

  // ---------- chart ----------
  function openChart() {
    const hand = game.phase === 'player' ? game.hands[game.active] : null;
    let cur = null;
    if (hand) {
      const l = legal(hand);
      const cards = val(hand.cards);
      const { total, soft } = S.handValue(cards);
      const up = game.dealer[0].v;
      if (l.canSplit) cur = { t: 'pair', r: cards[0], up };
      else if (soft && total >= 13 && total <= 20) cur = { t: 'soft', r: total - 11, up };
      else if (soft) cur = { t: 'hard', r: total, up };
      else cur = { t: 'hard', r: Math.min(17, Math.max(8, total)), up };
    }
    const ups = S.UPCARDS;
    const head = `<tr><th></th>${ups.map((u) => `<th class="${cur && cur.up === u ? 'cur-col' : ''}">${S.upName(u)}</th>`).join('')}</tr>`;
    const surr = settings.surrender;
    const cell = (code, isCur) => `<td class="${code}${isCur ? ' cur' : ''}">${code}</td>`;
    const table = (title, rowsSpec) => `<div class="chart-title">${title}</div><table class="chart">${head}${rowsSpec.map((r) =>
      `<tr class="${r.cur ? 'cur-row' : ''}"><th>${r.label}</th>${r.codes.map((c, i) => cell(c, r.cur && cur.up === ups[i])).join('')}</tr>`).join('')}</table>`;

    const surrHard = (t, i) => (surr && t >= 15 && t <= 17 && S.surrenderCode([10, t - 10], ups[i]) ? 'R' : null);
    const hardRows = [];
    hardRows.push({ label: '5–8', codes: S.HARD[8], cur: cur && cur.t === 'hard' && cur.r === 8 });
    for (let t = 9; t <= 16; t++) hardRows.push({ label: String(t), codes: S.HARD[t].map((c, i) => surrHard(t, i) || c), cur: cur && cur.t === 'hard' && cur.r === t });
    hardRows.push({ label: '17+', codes: S.HARD[17].map((c, i) => surrHard(17, i) || c), cur: cur && cur.t === 'hard' && cur.r === 17 });
    const softRows = [];
    for (let k = 2; k <= 9; k++) softRows.push({ label: `A,${k}`, codes: S.SOFT[11 + k], cur: cur && cur.t === 'soft' && cur.r === k });
    const pairRows = [];
    for (const v of [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]) {
      const codes = (S.PAIRS[v] || S.HARD[10]).map((c, i) => (surr && v === 8 && ups[i] === 11 ? 'R' : c));
      pairRows.push({ label: `${S.cardName(v)},${S.cardName(v)}`, codes, cur: cur && cur.t === 'pair' && cur.r === v });
    }
    $('chartBody').innerHTML =
      `<div class="hint-text">6 decks · H17 · DAS${surr ? ' · late surrender' : ''}. With 3+ cards: D → hit, Ds → stand.</div>` +
      table('Hard totals', hardRows) + table('Soft totals', softRows) + table('Pairs', pairRows);
    $('chartModal').hidden = false;
    const c = $('chartBody').querySelector('td.cur');
    if (c) setTimeout(() => c.scrollIntoView({ block: 'center' }), 50);
  }

  // ---------- setup screen ----------
  const MODE_DESC = {
    full: 'A normal shuffled 6-deck shoe with real hand frequencies. The dealer plays out every hand.',
    drill: 'Only the situations you select, filtered by rarity. Hands play out from the dealt situation.',
    quiz: 'Fast reps: see a situation, tap an action, get instant feedback. Uses the same filter as the drill.',
  };

  function renderSetup() {
    document.querySelectorAll('#modeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === settings.mode));
    $('modeDesc').textContent = MODE_DESC[settings.mode];
    $('optSurrender').checked = settings.surrender;
    $('optTotals').checked = settings.totals;
    $('optBankroll').checked = settings.betting;
    $('optSplitAces').checked = settings.playSplitAces;
    $('startStack').value = String(settings.startStack);
    $('optWeak').checked = settings.weakest;
    $('drillSettings').style.display = settings.mode === 'full' ? 'none' : '';

    // categories
    const cl = $('catList');
    cl.innerHTML = '';
    for (const c of G.CATEGORIES) {
      const disabled = c.needsSurrender && !settings.surrender;
      const n = rows.filter((r) => r.cats.includes(c.id)).length;
      const lab = document.createElement('label');
      lab.className = 'cat' + (disabled ? ' disabled' : '');
      lab.innerHTML = `<input type="checkbox" ${settings.categories.includes(c.id) ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span>${c.label}${disabled ? ' (turn on surrender)' : ''}</span><span class="n">${n}</span>`;
      lab.querySelector('input').onchange = (e) => {
        const set = new Set(settings.categories);
        if (e.target.checked) set.add(c.id); else set.delete(c.id);
        settings.categories = [...set];
        saveSettings();
        refilter();
        renderFilter();
      };
      cl.appendChild(lab);
    }
    document.querySelectorAll('#weightSeg button').forEach((b) => b.classList.toggle('on', b.dataset.w === settings.weighting));
    $('weightDesc').textContent = settings.weighting === 'uniform'
      ? 'Every eligible situation is equally likely. Best for drilling.'
      : 'Situations appear in proportion to how often they are really dealt.';
    renderFilter();
  }

  function renderFilter() {
    document.querySelectorAll('#threshSeg button').forEach((b) => b.classList.toggle('on', b.dataset.tm === settings.threshMode));
    const sl = $('threshSlider');
    const { eligible, pool } = filterResult;
    if (settings.threshMode === 'prob') {
      sl.min = 0; sl.max = G.SLIDER_STEPS;
      sl.value = G.probToSlider(settings.threshold, range);
      $('sliderMin').textContent = 'Rarest ' + G.pct(range.min);
      $('sliderMax').textContent = 'Commonest ' + G.pct(range.max);
      $('threshValue').textContent = '≤ ' + G.pct(settings.threshold);
      $('threshSub').textContent = G.oneIn(settings.threshold) + ' or rarer';
    } else {
      sl.min = 1; sl.max = 100;
      sl.value = settings.percentile;
      $('sliderMin').textContent = 'Rarest 1%';
      $('sliderMax').textContent = 'All 100%';
      $('threshValue').textContent = `Rarest ${settings.percentile}%`;
      $('threshSub').textContent = eligible.length ? `≤ ${G.pct(Math.max(...eligible.map((r) => r.prob)))}` : '';
    }
    $('eligibleCount').textContent = `${eligible.length} of ${pool.length} situations eligible`;
    const top = eligible.slice().sort((a, b) => b.prob - a.prob).slice(0, 5);
    $('preview').innerHTML = top.map((r) => `<li>${r.label}<span>${G.oneIn(r.prob)}</span></li>`).join('');
    $('noMatch').hidden = eligible.length > 0;
    $('dealBtn').disabled = settings.mode !== 'full' && !eligible.length;
  }

  // ---------- odds screen ----------
  let oddsLimit = 150;
  let oddsAsc = true;
  function renderOdds() {
    const sel = $('oddsCat');
    if (!sel.options.length) {
      sel.innerHTML = `<option value="">All situations (${rows.length})</option>` +
        G.CATEGORIES.map((c) => `<option value="${c.id}">${c.label}</option>`).join('');
      sel.onchange = () => { oddsLimit = 150; renderOdds(); };
    }
    $('oddsSort').textContent = oddsAsc ? 'Rarest first' : 'Commonest first';
    const cat = sel.value;
    const elig = new Set(filterResult.eligible.map((r) => r.id));
    let list = cat ? rows.filter((r) => r.cats.includes(cat)) : rows.slice();
    list.sort((a, b) => (oddsAsc ? a.prob - b.prob : b.prob - a.prob));
    const total = list.length;
    list = list.slice(0, oddsLimit);
    $('oddsList').innerHTML = list.map((r) => {
      const a = settings.surrender ? r.actionSurr : r.action;
      return `<div class="orow"><span class="dot ${elig.has(r.id) ? 'on' : ''}"></span><span>${r.label}</span>` +
        `<span class="p"><b>${G.oneIn(r.prob)}</b><br>${G.pct(r.prob)}</span><span class="badge ${a}">${S.ACTION_NAMES[a]}</span></div>`;
    }).join('');
    $('oddsMore').hidden = total <= oddsLimit;
    $('oddsMore').textContent = `Show more (${total - oddsLimit} left)`;
  }

  // ---------- stats screen ----------
  function renderStats() {
    let c = 0, w = 0, a = 0;
    const byCat = {};
    for (const [key, s] of Object.entries(stats.byKey)) {
      c += s.c; w += s.w; a += s.a;
      const row = rowById.get(key.replace(/^split:/, ''));
      const cats = key.startsWith('split:') ? ['split'] : row ? row.cats.filter((x) => x !== 'all') : [];
      for (const cat of cats.length ? cats : ['other']) {
        const b = byCat[cat] || (byCat[cat] = { c: 0, w: 0 });
        b.c += s.c; b.w += s.w;
      }
    }
    const acc = c + w ? Math.round((100 * c) / (c + w)) + '%' : '—';
    $('tiles').innerHTML = [
      [acc, 'Accuracy'], [(c + w + a).toLocaleString(), 'Decisions'], [stats.streak, 'Streak'], [stats.best, 'Best streak'],
    ].map(([v, l]) => `<div class="tile"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('') +
      (a ? `<div class="tile" style="grid-column: span 2"><div class="l">${a} assisted by hints (not counted in accuracy)</div></div>` : '');

    const catName = Object.fromEntries(G.CATEGORIES.map((x) => [x.id, x.label]));
    catName.split = 'After splitting';
    catName.other = 'Other (full game / mid-hand)';
    const catRows = Object.entries(byCat).filter(([, b]) => b.c + b.w).sort((x, y) => (y[1].c + y[1].w) - (x[1].c + x[1].w));
    $('catStats').innerHTML = catRows.length ? catRows.map(([k, b]) => {
      const p = Math.round((100 * b.c) / (b.c + b.w));
      return `<div class="bar-row"><div class="top"><span>${catName[k] || k}</span><span>${p}% · ${b.c}/${b.c + b.w}</span></div><div class="bar"><i style="width:${p}%"></i></div></div>`;
    }).join('') : '<div class="empty">No decisions yet.</div>';

    const missed = Object.entries(stats.byKey).filter(([, s]) => s.w > 0)
      .sort((x, y) => y[1].w - x[1].w || x[1].c - y[1].c).slice(0, 15);
    $('missed').innerHTML = missed.length ? missed.map(([key, s]) => {
      const split = key.startsWith('split:');
      const row = rowById.get(key.replace(/^split:/, ''));
      const label = row ? row.label : labelFromKey(key.replace(/^split:/, ''));
      const odds = row && !split ? ` · ${G.oneIn(row.prob)}` : '';
      return `<div class="bar-row"><div class="top"><span>${split ? 'After split: ' : ''}${label}</span><span>✗${s.w} ✓${s.c}${odds}</span></div></div>`;
    }).join('') : '<div class="empty">Nothing missed yet. 🎯</div>';
  }

  function labelFromKey(id) {
    const [p, u] = id.split('|');
    const conv = (x) => (x === 'A' ? 11 : Number(x));
    return G.situationLabel(p.split('-').map(conv), conv(u));
  }

  // ---------- navigation ----------
  function showScreen(name) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + name));
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.screen === name));
    if (name === 'setup') renderSetup();
    if (name === 'odds') renderOdds();
    if (name === 'stats') renderStats();
    if (name === 'play') render();
  }

  function resetGameForSettings() {
    game.phase = 'idle';
    game.dealer = [];
    game.hands = [];
    game.row = null;
    hideSheet();
    setMessage('Tap Deal to start');
  }

  // ---------- wiring ----------
  function wire() {
    document.querySelectorAll('.act').forEach((b) => (b.onclick = () => onAction(b.dataset.a)));
    $('dealBtn').onclick = deal;
    $('hintBtn').onclick = onHint;
    $('chartBtn').onclick = openChart;
    $('chartClose').onclick = () => ($('chartModal').hidden = true);
    $('chartModal').onclick = (e) => { if (e.target.id === 'chartModal') $('chartModal').hidden = true; };
    document.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => showScreen(b.dataset.screen)));

    document.querySelectorAll('#modeSeg button').forEach((b) => (b.onclick = () => {
      if (settings.mode !== b.dataset.mode) {
        settings.mode = b.dataset.mode;
        saveSettings();
        resetGameForSettings();
      }
      renderSetup();
    }));
    $('optSurrender').onchange = (e) => {
      settings.surrender = e.target.checked;
      saveSettings(); refilter(); resetGameForSettings(); renderSetup();
    };
    $('optSplitAces').onchange = (e) => { settings.playSplitAces = e.target.checked; saveSettings(); resetGameForSettings(); };
    $('optTotals').onchange = (e) => { settings.totals = e.target.checked; saveSettings(); };
    $('optBankroll').onchange = (e) => { settings.betting = e.target.checked; saveSettings(); render(); };
    $('startStack').onchange = (e) => { settings.startStack = Number(e.target.value); saveSettings(); };
    const rebuy = () => {
      if (game.phase === 'player' || game.phase === 'dealer') return;
      stack = settings.startStack;
      if (!betSize) betSize = 25;
      saveMoney();
      setMessage(`Stack reloaded to ${money(stack)}`, 'good');
      render();
    };
    $('rebuyBtn').onclick = rebuy;
    $('rebuy').onclick = rebuy;
    document.querySelectorAll('.chip').forEach((c) => (c.onclick = () => {
      const v = Number(c.dataset.chip);
      if (betSize + v <= stack) betSize += v;
      saveMoney();
      render();
    }));
    $('chipClear').onclick = () => { betSize = 0; saveMoney(); render(); };
    $('optWeak').onchange = (e) => { settings.weakest = e.target.checked; saveSettings(); };
    document.querySelectorAll('#threshSeg button').forEach((b) => (b.onclick = () => {
      settings.threshMode = b.dataset.tm; saveSettings(); refilter(); renderFilter();
    }));
    document.querySelectorAll('#weightSeg button').forEach((b) => (b.onclick = () => {
      settings.weighting = b.dataset.w; saveSettings(); renderSetup();
    }));
    $('threshSlider').oninput = (e) => {
      const v = Number(e.target.value);
      if (settings.threshMode === 'prob') settings.threshold = G.sliderToProb(v, range);
      else settings.percentile = v;
      refilter();
      renderFilter();
    };
    $('threshSlider').onchange = saveSettings;
    $('oddsSort').onclick = () => { oddsAsc = !oddsAsc; renderOdds(); };
    $('oddsMore').onclick = () => { oddsLimit += 200; renderOdds(); };
    $('resetStats').onclick = () => {
      if (!confirm('Reset all stats?')) return;
      stats.byKey = {}; stats.streak = 0; stats.best = 0;
      saveStats();
      renderStats();
    };
  }

  async function init() {
    wire();
    try {
      const res = await fetch('strategy-odds.json');
      rows = G.prepareMatrix(await res.json());
    } catch (e) {
      setMessage('Could not load the odds data', 'bad');
      rows = [];
    }
    rowById = new Map(rows.map((r) => [r.id, r]));
    refilter();
    render();
    renderFilter();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  init();
})();
