interface ProfileRowProps {
  label: string
  value: string | number
}

export function ProfileRow({ label, value }: ProfileRowProps) {
  return (
    <div className="profile-row">
      <span>{label}:</span>
      <span>{value}</span>
    </div>
  )
}