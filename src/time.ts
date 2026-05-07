export function nowIso(): string {
  return new Date().toISOString()
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export function localDateParts(date = new Date()): { date: string; time: string; display: string } {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  const hour = String(date.getHours()).padStart(2, "0")
  const minute = String(date.getMinutes()).padStart(2, "0")
  return {
    date: `${year}-${month}-${day}`,
    time: `${hour}:${minute}`,
    display: date.toLocaleDateString(undefined, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
  }
}
