export function isValidBirthDayMonth(birthDayMonth: string): boolean {
  const match = birthDayMonth.replace(/\s/g, '').match(/^(\d{2})\/(\d{2})$/)
  if (!match) return false
  const day = Number(match[1])
  const month = Number(match[2])
  return day >= 1 && day <= 31 && month >= 1 && month <= 12
}

export function buildUsername(fullName: string, birthDayMonth: string) {
  const nameWithoutParentheses = fullName.replace(/\s*\([^)]*\)/g, ' ')
  const base = nameWithoutParentheses
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase()
  const cleaned = birthDayMonth.replace(/\s/g, '')
  const suffix = isValidBirthDayMonth(birthDayMonth) ? cleaned.replace('/', '') : '0000'
  return `${base}${suffix}`
}
