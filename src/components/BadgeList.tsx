interface BadgeListProps {
  badges: string[]
}

export function BadgeList({ badges }: BadgeListProps) {
  return (
     <ul>
      {badges.length === 0 ? <li>No badges yet</li> : badges.map(badge => <li key={badge}>{badge}</li>)}
    </ul>
  )
}

