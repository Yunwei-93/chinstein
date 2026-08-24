# Chinstein

Learn one Chinese character a day — a small, gamified learning app with streaks, badges, and a short daily quiz.

**Live demo:** [chinstein.vercel.app](https://chinstein.vercel.app)


![Chinstein home page](docs/screenshot.png)

## Why I built this

I kept watching people around me download a language app, use it enthusiastically for two weeks, and then quit. The apps weren't bad — but a session felt like homework. Long word lists, big daily goals, and a streak you feel guilty about breaking.

I wanted to see what happens if a session is deliberately tiny: one character a day, a short story about where it comes from, and a single quiz question. Two or three minutes, not twenty.

This started as a Figma prototype for a human-computer interaction course. I'm now rebuilding it properly — React and TypeScript on the front end, with a real backend and character dataset in progress.

## Features

- One character a day, selected by date — the same character for everyone, every day
- Etymology story plus a stroke-order animation (Hanzi Writer)
- Multiple-choice quiz with distractors drawn from characters you've already learned
- Points, streaks, and badges unlocked from your stats
- Progress persists across refreshes via localStorage
- Leaderboard that re-sorts as your score changes
- Responsive layout (two columns on desktop, single column on mobile)

## Tech Stack

| Layer | Technology |
| ---   | ---        |
| Frontend | React 19, TypeScript |
| Routing | React Router v7 |
| Testing | Vitest (unit tests for badge and streak logic) |
| Stroke animation | Hanzi Writer |
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

Run the unit tests:

```bash
npm test
```

## Project structure

```
src/
├── components/
│   ├── ProfileRow.tsx       # A single label/value row in the profile card
│   ├── BadgeList.tsx        # Renders earned badges, with an empty state
│   ├── TodayCard.tsx        # Today's character; switches state once completed
│   ├── Leaderboard.tsx      # Sorted ranking with the current user highlighted
│   └── StrokeAnimation.tsx  # Wraps Hanzi Writer (useRef + effect cleanup)
├── pages/
│   ├── HomePage.tsx         # Profile, leaderboard, today's character
│   ├── StudyPage.tsx        # Story, stroke animation, quiz, scoring
│   └── ResultPage.tsx       # Session summary and newly unlocked badges
├── data/
│   └── characters.ts        # 50 characters with pinyin, meaning, etymology
├── utils/
│   ├── characters.ts        # Daily selection, quiz option generation
│   ├── date.ts              # Local-date keys and streak calculation
│   ├── badges.ts            # Rule-driven badge derivation
│   └── badges.test.ts       # Unit tests for the badge rules
├── types.ts                 # Shared types (User, Session, Character)
├── App.tsx                  # Routing, user state, localStorage persistence
└── main.tsx                 # Entry point
```

## Roadmap

- [x] Character dataset with daily rotation (50 characters)
- [x] Study and result pages with client-side routing
- [x] Quiz with scoring, streaks, and badge unlocks
- [x] Progress persistence via localStorage
- [x] Stroke-order animations via Hanzi Writer
- [ ] Express + TypeScript API with PostgreSQL for persistent progress
- [ ] AI-generated character etymology using the Claude API
- [ ] Docker and GitHub Actions
- [ ] Spaced repetition for review scheduling

## Known limitations

Being upfront about what's not done yet:

- **Progress is per-browser.** localStorage is scoped to one origin, so data doesn't
  follow you across devices and is lost if you clear browsing data. The backend fixes this.
- **The leaderboard is mock data.** Other users are hard-coded until there's a real API.
- **Timezone inconsistency.** Daily character selection uses UTC days while streak
  calculation uses the local date, so they can disagree at certain times in certain
  timezones. To be unified server-side.
- **Character data loads from a CDN.** Hanzi Writer fetches stroke data from jsDelivr at
  runtime; bundling the 50 characters locally would remove that external dependency.
