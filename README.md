# TRMNL Creator Stats

A TRMNL recipe that lets any recipe creator follow their own numbers on their TRMNL, powered by the [TRMNL Creator Leaderboard](https://nbbou81000.github.io/trmnl-leaderboard/).

What it shows:

- total connections (installs + forks), with the change over 24 hours and 7 days
- your rank among every recipe creator, how it moved in 7 days, and the gap to the creator just above you
- a 30-day curve of your connections and a bar chart of new connections per day
- each recipe with its connections, weekly gain, catalogue rank and progress toward its next milestone (10, 25, 50, 100, 250…), with an estimated date
- Creator Fund progress (recipes at 50 connections or more) and a QR code to your full profile on the leaderboard (TRMNL X)

Four languages (English, French, German, Spanish), four layouts (full, half horizontal, half vertical, quadrant), tuned for TRMNL OG and TRMNL X in landscape and portrait.

## Setup

1. Install the recipe.
2. Enter **one of your recipe IDs**: the number at the end of any of your recipe links (`trmnl.com/recipes/375844` → `375844`).
3. Pick your language.

## How it works

`scripts/build.mjs` runs every hour on GitHub Actions. It reads the public data of the leaderboard (never writes to it), then publishes one small JSON per recipe and language on this repository's GitHub Pages:

```
https://nbbou81000.github.io/trmnl-creator-stats/<language>/<recipe id>.json
```

Every label is translated and every number formatted before it reaches TRMNL, and the charts arrive as ready-made SVG paths, so the templates stay simple and nothing is computed on the device.

- `src/` — Liquid templates (`full`, `half_horizontal`, `half_vertical`, `quadrant`, `shared`) and `settings.yml`
- `scripts/i18n.mjs` — all texts in the four languages
- `.github/workflows/build.yml` — hourly build and Pages deployment

---

# Stats créateur TRMNL

Recette TRMNL qui permet à n'importe quel créateur de recettes de suivre ses propres chiffres sur son TRMNL, à partir des données du [Palmarès des créateurs TRMNL](https://nbbou81000.github.io/trmnl-leaderboard/).

Le site du palmarès n'est jamais modifié : ce dépôt lit ses données publiques chaque heure et publie un petit fichier JSON par recette et par langue sur sa propre page GitHub Pages.

Mise en route : installer la recette, indiquer le numéro d'une de ses recettes (la fin du lien `trmnl.com/recipes/…`), choisir la langue.
