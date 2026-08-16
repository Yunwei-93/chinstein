interface TodayCardProps {
  character: string
  onStart: () => void      
}

export function TodayCard({ character, onStart }: TodayCardProps) {
  return (
    <div className="card card-today">
      <h2>Today's Character: {character}</h2>
      <p>Short story + quiz · about 2-3 minutes</p>
      <button className="primary-btn" onClick={onStart}>Start your study today</button>
    </div>
  )
}