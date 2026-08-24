
interface TodayCardProps {
  character: string
  completed: boolean
  onStart: () => void
}

export function TodayCard({ character, completed, onStart }: TodayCardProps) {
  return (
    <div className="card card-today">
      <h2>Today's Character: {character}</h2>

      {completed ? (
        <>
          <p className="subtitle">You've finished today's character.</p>
          <p className="session-length">Come back tomorrow for a new one.</p>
          <button className="secondary-btn" onClick={onStart}>
            Review again
          </button>
        </>
      ) : (
        <>
          <p className="subtitle">Short story + quiz · about 2-3 minutes</p>
          <button className="primary-btn" onClick={onStart}>
            Start your study today
          </button>
        </>
      )}
    </div>
  )
}