/*
 * Basic strategy engine — 6 decks, dealer hits soft 17, DAS, optional late surrender.
 * Card values: 2–10, and 11 for an ace. Works in the browser (window.BJStrategy) and Node.
 */
(function (root) {
  'use strict';

  const UPCARDS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const col = (up) => up - 2;
  const row = (s) => s.split(' ');

  // Codes: H hit, S stand, D double (else hit), Ds double (else stand), P split
  const HARD = {};
  for (let t = 4; t <= 8; t++) HARD[t] = row('H H H H H H H H H H');
  HARD[9] = row('H D D D D H H H H H');
  HARD[10] = row('D D D D D D D D H H');
  HARD[11] = row('D D D D D D D D D D');
  HARD[12] = row('H H S S S H H H H H');
  for (let t = 13; t <= 16; t++) HARD[t] = row('S S S S S H H H H H');
  for (let t = 17; t <= 21; t++) HARD[t] = row('S S S S S S S S S S');

  const SOFT = {
    12: row('H H H H H H H H H H'), // A,A when it can't be split
    13: row('H H H D D H H H H H'),
    14: row('H H H D D H H H H H'),
    15: row('H H D D D H H H H H'),
    16: row('H H D D D H H H H H'),
    17: row('H D D D D H H H H H'),
    18: row('Ds Ds Ds Ds Ds S S H H H'),
    19: row('S S S S Ds S S S S S'),
    20: row('S S S S S S S S S S'),
    21: row('S S S S S S S S S S'),
  };

  const PAIRS = {
    2: row('P P P P P P H H H H'),
    3: row('P P P P P P H H H H'),
    4: row('H H H P P H H H H H'),
    5: null, // play as hard 10
    6: row('P P P P P H H H H H'),
    7: row('P P P P P P H H H H'),
    8: row('P P P P P P P P P P'),
    9: row('P P P P P S P P S S'),
    10: row('S S S S S S S S S S'),
    11: row('P P P P P P P P P P'),
  };

  // Late surrender (H17): hard 15 vs 10,A; hard 16 vs 9,10,A; hard 17 vs A; 8,8 vs A
  function surrenderCode(cards, up) {
    if (cards.length !== 2) return null;
    const isPair = cards[0] === cards[1];
    if (isPair) return cards[0] === 8 && up === 11 ? 'R' : null;
    const { total, soft } = handValue(cards);
    if (soft) return null;
    if (total === 15 && (up === 10 || up === 11)) return 'R';
    if (total === 16 && (up === 9 || up === 10 || up === 11)) return 'R';
    if (total === 17 && up === 11) return 'R';
    return null;
  }

  function handValue(cards) {
    let total = 0;
    let aces = 0;
    for (const c of cards) {
      total += c;
      if (c === 11) aces++;
    }
    while (total > 21 && aces > 0) {
      total -= 10;
      aces--;
    }
    return { total, soft: aces > 0 };
  }

  function isBlackjack(cards) {
    return cards.length === 2 && handValue(cards).total === 21;
  }

  // Raw table code before legality is applied: 'H' 'S' 'D' 'Ds' 'P' 'R'
  function rawCode(cards, up, opts) {
    if (opts.canSurrender) {
      const r = surrenderCode(cards, up);
      if (r) return r;
    }
    if (opts.canSplit && cards.length === 2 && cards[0] === cards[1] && PAIRS[cards[0]]) {
      const p = PAIRS[cards[0]][col(up)];
      if (p === 'P') return 'P';
    }
    const { total, soft } = handValue(cards);
    if (total > 21) return 'S';
    if (soft) return SOFT[total][col(up)];
    return HARD[Math.max(4, total)][col(up)];
  }

  function resolve(code, canDouble) {
    if (code === 'D') return canDouble ? 'D' : 'H';
    if (code === 'Ds') return canDouble ? 'D' : 'S';
    return code;
  }

  /**
   * The correct action for a hand.
   * opts: { canDouble, canSplit, canSurrender } — what is legal right now.
   * Returns { action: 'H'|'S'|'D'|'P'|'R', code, type, total }
   */
  function getAction(cards, up, opts) {
    const o = Object.assign({ canDouble: cards.length === 2, canSplit: false, canSurrender: false }, opts);
    const code = rawCode(cards, up, o);
    const action = resolve(code, o.canDouble);
    return { action, code, ...describe(cards, o) };
  }

  function describe(cards, o) {
    const { total, soft } = handValue(cards);
    let type = soft ? 'soft' : 'hard';
    if (o && o.canSplit && cards.length === 2 && cards[0] === cards[1] && cards[0] !== 5) type = 'pair';
    return { type, total, soft };
  }

  const ACTION_NAMES = { H: 'Hit', S: 'Stand', D: 'Double', P: 'Split', R: 'Surrender' };
  const upName = (u) => (u === 11 ? 'A' : String(u));
  const cardName = (c) => (c === 11 ? 'A' : String(c));

  // One-line explanation of the correct play.
  function reason(cards, up, opts) {
    const o = Object.assign({ canDouble: cards.length === 2, canSplit: false, canSurrender: false }, opts);
    const { action, code } = getAction(cards, up, o);
    const { total, soft } = handValue(cards);
    const u = upName(up);
    const weak = up >= 2 && up <= 6;
    const noDbl = (code === 'D' || code === 'Ds') && !o.canDouble;
    const tag = noDbl ? ` (you'd double, but can't with ${cards.length} cards)` : '';

    if (action === 'R') {
      if (cards[0] === cards[1]) return `8,8 vs A: surrender. With H17, splitting into two hands against an ace loses more than half a bet.`;
      return `Hard ${total} vs ${u}: surrender. Playing it out loses more than half your bet on average.`;
    }

    if (action === 'P' || (o.canSplit && cards.length === 2 && cards[0] === cards[1] && cards[0] !== 5)) {
      const v = cards[0];
      const pr = `${cardName(v)},${cardName(v)} vs ${u}`;
      if (v === 11) return `${pr}: always split aces. Two hands starting at 11 beat one soft 12.`;
      if (v === 8) return `${pr}: always split 8s. 16 is the worst total, and two hands starting at 8 lose less${up >= 9 ? ', even against a strong upcard' : ''}.`;
      if (v === 10) return `${pr}: never split tens. 20 already wins most hands.`;
      if (v === 9) {
        if (action === 'P' && weak) return `${pr}: split. The dealer is weak, so two hands starting at 9 earn more than one 18.`;
        if (action === 'P') return `${pr}: split. 18 is an underdog against a ${u}, but two hands starting at 9 do better.`;
        if (up === 7) return `${pr}: stand. 18 beats the dealer's most likely 17.`;
        return `${pr}: stand. Two 9s against a ${u} are worse than standing on 18.`;
      }
      if (v === 4) return action === 'P'
        ? `${pr}: split. 5 and 6 are the dealer's weakest cards, and you can double after splitting.`
        : `${pr}: hit your 8. Splitting 4s only pays against 5 or 6.`;
      if (v === 6) return action === 'P'
        ? `${pr}: split. The dealer busts often, so turn a bad 12 into two hands.`
        : `${pr}: hit. Against a ${u}, splitting 6s just creates two bad hands.`;
      if (v === 2 || v === 3 || v === 7) return action === 'P'
        ? `${pr}: split. With double after split, two small starts beat ${total} against 2–7.`
        : `${pr}: hit. Against 8 or higher, splitting creates two weak hands.`;
    }

    if (soft) {
      if (total === 12) return `Soft 12: hit. You can't bust.`;
      if (total <= 17) {
        if (action === 'D') return `Soft ${total} vs ${u}: double. The dealer is likely to bust and one card can't bust you.`;
        return `Soft ${total} vs ${u}: hit${tag}. Too weak to stand, and you can't bust with one card.`;
      }
      if (total === 18) {
        if (action === 'D') return `Soft 18 vs ${u}: double. The dealer busts often and you can't bust.`;
        if (code === 'Ds') return `Soft 18 vs ${u}: stand${tag}. 18 is fine against a weak upcard.`;
        if (action === 'S') return `Soft 18 vs ${u}: stand. 18 beats a 17 and pushes an 18.`;
        return `Soft 18 vs ${u}: hit. 18 loses to the dealer's likely 19 or 20, and one card can't bust you.`;
      }
      if (total === 19) {
        if (action === 'D') return `Soft 19 vs 6: double. With H17 the 6 busts often enough to press.`;
        if (code === 'Ds') return `Soft 19 vs 6: stand${tag}.`;
        return `Soft 19 vs ${u}: stand. 19 is a strong hand.`;
      }
      return `Soft ${total}: stand.`;
    }

    if (total <= 8) return `Hard ${total}: hit. You can't bust.`;
    if (total === 9) {
      if (action === 'D') return `9 vs ${u}: double. The dealer is weak.`;
      if (noDbl) return `9 vs ${u}: hit${tag}.`;
      if (up === 2) return `9 vs 2: hit. A 2 busts too rarely to double a 9.`;
      return `9 vs ${u}: hit. Not strong enough to double against a ${u}.`;
    }
    if (total === 10) {
      if (action === 'D') return `10 vs ${u}: double. You're ahead of the dealer's card.`;
      if (noDbl) return `10 vs ${u}: hit${tag}.`;
      return `10 vs ${u}: hit. The dealer's card is as strong as yours, so don't double.`;
    }
    if (total === 11) {
      if (action === 'D') return up === 11
        ? `11 vs A: double. With H17, double 11 even against an ace.`
        : `11 vs ${u}: double. 11 is the best doubling hand.`;
      return `11 vs ${u}: hit${tag}.`;
    }
    if (total === 12) {
      if (action === 'S') return `12 vs ${u}: stand. The dealer busts about 40% of the time.`;
      if (up === 2 || up === 3) return `12 vs ${u}: hit. A ${u} busts too rarely, and only a 10 busts you.`;
      return `12 vs ${u}: hit. The dealer probably makes 17 or better.`;
    }
    if (total <= 16) {
      if (action === 'S') return up === 2 && total === 13
        ? `13 vs 2: stand. Hitting busts you too often to beat the 2's ~35% bust rate.`
        : `${total} vs ${u}: stand. Let the dealer bust.`;
      return `${total} vs ${u}: hit. The dealer probably has 17 or better, so take the bust risk.`;
    }
    return `Hard ${total}: stand.`;
  }

  const api = {
    UPCARDS, HARD, SOFT, PAIRS, ACTION_NAMES,
    handValue, isBlackjack, getAction, reason, surrenderCode, describe, upName, cardName,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BJStrategy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
