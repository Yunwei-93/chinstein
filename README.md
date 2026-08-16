# Chinstein

Learn one Chinese character a day — a small, gamified learning app with streaks, badges, and a short daily quiz.

**Live demo:** [chinstein.vercel.app](https://chinstein.vercel.app)


![Chinstein home page](docs/screenshot.png)

## Why I built this

I kept watching people around me download a language app, use it enthusiastically for two weeks, and then quit. The apps weren't bad — but a session felt like homework. Long word lists, big daily goals, and a streak you feel guilty about breaking.

I wanted to see what happens if a session is deliberately tiny: one character a day, a short story about where it comes from, and a single quiz question. Two or three minutes, not twenty.

This started as a Figma prototype for a human-computer interaction course. I'm now rebuilding it properly — React and TypeScript on the front end, with a real backend and character dataset in progress.

## Features

- Daily character card with a short story and quiz
- Points, streaks, and unlockable badges
- Leaderboard that re-sorts as your score changes
- Responsive layout (two columns on desktop, single column on mobile)

## Tech Stack

| Layer | Technology |
| ---   | ---        |
| Frontend | React 19, TypeScript |
| Build tool | Vite |
| Styling | CSS (custom properties, flexbox, grid) |
| Deployment | Vercel — automatic deploys on push to `main` |

## Running locally

```bash
git clone https://github.com/Yunwei-93/chinstein.git
cd chinstein
npm install
npm run dev
```

The app runs at `http://localhost:5173`.

## Project structure

```
src/
├── components/
│   ├── ProfileRow.tsx     # A single label/value row in the profile card
│   ├── BadgeList.tsx      # Renders earned badges, with an empty state
│   ├── TodayCard.tsx      # Today's character and the entry point to a session
│   └── Leaderboard.tsx    # Sorted ranking with the current user highlighted
├── types.ts               # Shared types (User, Session, LeaderboardEntry)
├── App.tsx                # Composes the home page and owns user state
└── main.tsx               # Entry point
```

## Roadmap

- [ ] Character dataset with daily rotation (30–50 characters)
- [ ] Stroke-order animations via Hanzi Writer
- [ ] Study and result pages with client-side routing
- [ ] Express + TypeScript API with PostgreSQL for persistent progress
- [ ] AI-generated character etymology using the Claude API
- [ ] Spaced repetition for review scheduling

## Notes

This is an active work in progress. The current version renders the home page with local state; user progress does not persist between refreshes yet — that lands with the backend.