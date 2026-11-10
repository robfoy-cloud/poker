# Hold'em Coach

A practice table for learning No-Limit Texas Hold'em, with the emphasis on the **jargon**. You sit with 1–8 computer opponents; a coach narrates the game, explains the rules as they happen and checks your play.

## What it does

- **Real rules**: dealer button that moves clockwise, small and big blinds, heads-up blind rule, burn cards before the flop, turn and river, minimum-raise rules, all-ins and side pots, split pots, showdown order.
- **Chips edge-on**: stacks are drawn as you'd see them across a real table, with no numbers. You count the pot and your stake yourself, and you bet by pushing chips: the exact amount you face is a call, more is a raise, nothing is a check. Tap the pot or anyone's stack to test your count. There's a setting to show totals.
- **You deal when you hold the button**: pick who gets the first card, remember to burn, deal the right number of cards.
- **Three coaching levels** (you can switch mid-game from the top bar):
  - **Learn**: every step is explained (who deals, who posts the blinds, who acts first and why, burn cards, names of the flop/turn/river, board texture) and on your turn I say what I'd do and why: hand strength, draws and outs, pot odds, position and how the others are playing.
  - **Advise**: the game flow and the end of each betting round are explained; tap **Advice** when you want my view.
  - **Test**: silent unless you make a mistake (wrong blind, being short, an illegal raise, checking when facing a bet, dealing errors, or a clear blunder).
- **Tappable jargon**: underlined words open a definition. The menu has a searchable glossary, hand rankings, chip values and a "how a hand works" guide.
- **Ask a question**: free-form questions go to Claude through the Worker (once an API key is set). Without one, the built-in glossary answers.

Opponents have personalities (tight-passive, tight-aggressive, loose-aggressive, loose-passive, balanced). Neither the bots nor the coach look at anyone else's hidden cards.

## Deploying on Cloudflare (Workers)

The repo is set up as a Cloudflare Worker with static assets: `wrangler.toml` serves `public/` and `src/worker.js` handles `/api/*`.

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Import a repository** → choose `robfoy-cloud/poker`.
2. Leave the build command empty; deploy command `npx wrangler deploy`. Save and deploy.
3. The app will be at `https://poker.<your-subdomain>.workers.dev`. It works fully at this point; "Ask a question" uses the glossary.
4. To switch on Claude: Worker → **Settings → Variables and secrets** → add a **Secret** `ANTHROPIC_API_KEY`. Optional: add a secret `COACH_PASSCODE` so only people with the passcode can spend your API credit. The model is set by `CLAUDE_MODEL` in `wrangler.toml`.

Every push to `main` redeploys automatically.

## Running locally

```
npm install
npx wrangler dev          # app + API at http://localhost:8787
npm test                  # rules/evaluator check: simulates thousands of hands
```

For just the game, any static server works (e.g. `cd public && python3 -m http.server`).

## Files

- `public/js/engine.js`: rules, betting rounds, side pots, showdown
- `public/js/cards.js`: deck and hand evaluator
- `public/js/ai.js`: equity estimates, hand reading, bots and advice
- `public/js/coach.js`: narration, explanations and mistake checks for the three levels
- `public/js/glossary.js`: the jargon
- `public/js/ui.js`, `app.js`: the table, chips and controls
- `src/worker.js`: Cloudflare Worker (static files + `/api/coach`)
