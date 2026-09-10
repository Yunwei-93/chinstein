import type { LeaderboardEntry } from '../types'
interface LeaderboardProps {
  entries: LeaderboardEntry[]
  currentUserId: number
}


export function Leaderboard({ entries, currentUserId }: LeaderboardProps) {
  if (entries.length === 0) {
    return <p>No scores yet. Complete a study session to join the leaderboard.</p>
  }
  return (
    <ol className="leaderboard-list">
      {entries.map(entry => (
        <li key={entry.userId}>
          <span className="lb-rank">{entry.rank}.</span>
          <span className="lb-name">
            {entry.userId === currentUserId
              ? `${entry.name} (you)`
              : entry.name}
          </span>
          <span className="lb-points">{entry.points} points</span>
        </li>
      ))}
    </ol>
  )
}