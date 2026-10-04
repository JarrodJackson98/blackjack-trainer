# Blackjack Basic Strategy Trainer

An offline-capable iPhone PWA for drilling perfect basic strategy, built around the rare and tricky spots.

Rules: 6 decks, dealer hits soft 17, dealer peeks, blackjack pays 3:2, double on any two cards,
double after split, re-split to 4 hands (aces once, one card each), optional late surrender.

## Modes
- **Full game**: a shuffled 6-deck shoe with real frequencies. Every decision is scored.
- **Edge drill**: only the situations you select, filtered by rarity, played out from the deal.
- **Quick quiz**: a situation and an upcard. Tap an action and get instant feedback. No play-out.

## Stack & betting
On by default in Full game and Edge drill (Quick quiz has no play-out, so no bets). Between hands the
action buttons become chips: tap $5 / $25 / $100 / $500 to build your bet, and it carries over to
the next hand. Bets come off your stack when the hand is dealt. Doubling and splitting need enough
left to match the bet; if you can't cover it, the button disappears and the strategy hint falls back
to the next-best legal play. Blackjack pays 3:2, surrender returns half. Pick a starting stack and
Rebuy in Setup (or tap Rebuy when you're out of chips).

## Rare Hand Generation Filter
A Weighted RNG Card Generator controlled by a Dynamic Probability Threshold Slider.
- `strategy-odds.json` is the **Pre-calculated Hand Odds Matrix**. It has 540 two-card situations
  (exact combinatorics) and 1,808 three- and four-card situations (exact enumeration of the paths
  you reach by playing correctly).
- The **threshold slider** is logarithmic, running between the rarest and commonest situations in
  your selected categories, and drops anything more common than the cutoff. *Percentile* mode keeps
  the rarest N%.
- The **conditional dealing loop** picks a situation from the eligible set (Uniform, Natural, or
  weighted toward your Weakest spots), deals matching cards from a fresh shoe, and checks they
  reproduce the situation. The dealer never has a peeked blackjack in drills.

## Files
| File | What |
|---|---|
| `strategy.js` | Strategy tables, the action lookup, and the one-line reasons |
| `generator.js` | Categories, the threshold filter, weighted picking, the shoe and the dealing loop |
| `app.js` / `index.html` / `styles.css` | The UI |
| `sw.js` | Service worker: precaches everything, serves cache-first |
| `scripts/build-odds.js` | Rebuilds `strategy-odds.json` and Monte Carlo checks it |
| `tests.js` / `tests.html` / `scripts/run-tests.js` | Test suite (runs in the browser or in Node) |

## Commands
```bash
node scripts/build-odds.js            # rebuild odds + 20M-hand Monte Carlo check (~10s)
node scripts/build-odds.js --mc=200000000   # deeper check, covers more multi-card rows
node scripts/run-tests.js             # strategy, odds and generator tests
python3 -m http.server 8000           # serve locally at http://localhost:8000
```

## Put it on your iPhone
A service worker needs HTTPS, so host the folder on any static host:
1. **GitHub Pages**: push this folder to a repo, then go to Settings → Pages → Deploy from branch (root).
   Netlify Drop (drag the folder onto app.netlify.com/drop) also works.
2. Open the URL in **Safari** on the iPhone and wait a few seconds for it to cache.
3. Tap Share → **Add to Home Screen**.
4. From then on it runs from the home screen with no connection.

**Updating:** after changing any file, bump `CACHE` in `sw.js` (e.g. `bjt-v3` → `bjt-v4`) so phones
pick up the new version. It applies on the next launch after the app has been online.
