export function buildUsername(fullName: string, birthDayMonth: string) {
  const nameWithoutParentheses = fullName.replace(/\s*\([^)]*\)/g, ' ')
  const base = nameWithoutParentheses
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase()
  const match = birthDayMonth.replace(/\s/g, '').match(/^(\d{2})\/(\d{2})$/)
  const day = match ? Number(match[1]) : 0
  const month = match ? Number(match[2]) : 0
  const valid = day >= 1 && day <= 31 && month >= 1 && month <= 12
  const suffix = valid && match ? `${match[1]}${match[2]}` : '0000'
  return `${base}${suffix}`
}
