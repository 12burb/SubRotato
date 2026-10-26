# SubRotato

Pay for one streaming service at a time.

Tell SubRotato what you pay for and what you want to watch or play. It plans which subscription to pay for each month, keeps a service until a show's last episode or a game is done, and shows your year month by month. Free, no account, in English and Spanish, with prices for the US, Canada, the UK, Australia and Mexico.

## Privacy

There is no server-side data. Your plan lives in your own browser (localStorage) and can be saved as a file you keep. A bank file you scan is read on your device and never sent. The only outside requests are the release list (`upcoming.json`, from this site) and TVMaze, which gets only what you type in the search box, or a show's TVMaze number to look up its air dates. Fonts are served from this site, so opening a page sends nothing to Google. A Content-Security-Policy lets the page talk only to itself and api.tvmaze.com.

## What is here

- `public/index.html`: the landing page (`public/es.html` in Spanish)
- `public/app.html`: the whole app, in one file (HTML, CSS and JavaScript, no build step)
- `public/upcoming.json`: new shows, movies, games and sports seasons, checked weekly by `scripts/refresh-upcoming.mjs` (`.github/workflows/refresh-upcoming.yml`)
- `tests/`: `npm test` runs every test (Node 20+)
- `tools/`: link preview and icon images, `set-domain.mjs` for the site address, and `csp-hash.mjs` for the Content-Security-Policy
- `public/fonts/`: the two fonts, served from this site (SIL OFL 1.1)

## Run it locally

```bash
npm install
npm start      # http://localhost:5173, with the production headers (CSP included)
npm test
```

After editing the script in `public/app.html`, run `node tools/csp-hash.mjs` so the CSP in `vercel.json` allows it.

TV data from [TVMaze](https://www.tvmaze.com) ([CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)). Game hours are estimates from [HowLongToBeat](https://howlongtobeat.com), game makers and reviews. Not tied to any streaming service.
