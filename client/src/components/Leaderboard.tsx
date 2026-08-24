import type { LeaderboardEntry } from '../types'
interface LeaderboardProps {
  entries: LeaderboardEntry[]
  currentUserName: string
}


export function Leaderboard({ entries, currentUserName }: LeaderboardProps) {
  const sorted = [...entries].sort((a, b) => b.points - a.points)
  return (
    <ol className="leaderboard-list">
      {sorted.map((entry, index) => (
        <li key={entry.name}>
          <span className="lb-rank">{ index + 1 }.</span>
          <span className="lb-name">{ entry.name === currentUserName ? `${entry.name} (you)`: entry.name }</span>
          <span className="lb-points">{ entry.points } points</span>
        </li>
      ))}
    </ol>
  )
}