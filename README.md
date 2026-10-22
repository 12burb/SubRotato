# SubRotato

Pay for one streaming service at a time.

Tell SubRotato what you pay for and what you want to watch or play. It plans which subscription to pay for each month, keeps a service until a show's last episode or a game is done, and shows your year month by month. Free, no account, in English and Spanish, with prices for the US, Canada, the UK, Australia and Mexico.

## Privacy

There is no server-side data. Your plan lives in your own browser (localStorage) and can be saved as a file you keep. A bank file you scan is read on your device and never sent. The only outside requests are the release list (`upcoming.json`, from this site) and TVMaze, which gets only the show title you search for.

## What is here

- `public/index.html`: the landing page (`public/es.html` in Spanish)
- `public/app.html`: the whole app, in one file (HTML, CSS and JavaScript, no build step)
- `public/upcoming.json`: new shows, movies, games and sports seasons, checked weekly by `scripts/refresh-upcoming.mjs` (`.github/workflows/refresh-upcoming.yml`)
- `tests/`: `npm test` runs every test (Node 20+)
- `tools/`: link preview and icon images, and `set-domain.mjs` for the site address

## Run it locally

```bash
npm install
npm start      # http://localhost:5173
npm test
```

TV data from [TVMaze](https://www.tvmaze.com) ([CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)). Game hours are estimates from [HowLongToBeat](https://howlongtobeat.com), game makers and reviews. Not tied to any streaming service.
