# Agent Instructions

## Web app (`app/`)

- **Build before push.** `app/web/dist/` is checked into git (the Raspberry
  Pi Zero deployment pulls pre-built assets instead of building — see commit
  `0286d51`). Any change that affects the frontend bundle (`app/web/**`,
  `app/vite.config.js`, frontend dependencies) MUST be rebuilt and the new
  `dist/` committed before pushing:

  ```bash
  cd app && npm run build
  git add app/web/dist
  ```

  Pushing frontend changes without the rebuilt `dist/` leaves the deployed
  app serving a stale UI.
