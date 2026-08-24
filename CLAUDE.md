```markdown
# Chinstein

A Chinese character learning app. One character a day, with an etymology story and a short quiz.

## Stack
React 19 + TypeScript + Vite, React Router v7, deployed on Vercel.
Backend (planned): Express + TypeScript + PostgreSQL.

## Structure
- `src/components/` — presentational components (ProfileRow, BadgeList, TodayCard, Leaderboard)
- `src/pages/` — HomePage, StudyPage
- `src/data/characters.ts` — 50 characters with pinyin, meaning, etymology story
- `src/utils/characters.ts` — daily character selection, quiz option generation
- `src/types.ts` — shared types
- `src/App.tsx` — routing and user state

## Conventions
- User state lives in App.tsx and is passed down via props
- Today's character is computed from the date, never stored in state
- File names: lowercase for data/utils, PascalCase for components
- All types shared across files go in types.ts

## Working with me
I'm learning React and TypeScript. Write the code directly instead of making me write it
first — I learn faster reading finished code and asking questions than writing from
scaffolds. Still explain key logic inline (bilingual comments, Chinese + English) and
flag anything that's a likely interview follow-up, since I need to be able to defend
every line I put on my resume.

When a change touches an existing file, give a diff (file + exact location + what's
added/changed/removed as a `diff` code block), not the whole file — I don't want to
hunt line by line through a full dump. Full file contents are fine only for brand-new
files. Always say why each change is made, not just what.
```