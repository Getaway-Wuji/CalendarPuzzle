const STORAGE_NAMESPACE = 'calendar-puzzle:v1'
export const TIMING_VERSION = 'active-time-1'

export interface CalendarDate {
  iso: string
  year: number
  month: number
  day: number
  weekday: number
}

export type SessionMode = 'timed' | 'relaxed'
export type SessionPhase = 'ready' | 'running' | 'paused' | 'complete'
export type WoodSkin = 'natural' | 'honey' | 'cherry' | 'walnut'

export interface Versions {
  boardVersion: string
  pieceSetVersion: string
}

export interface Session<Puzzle> {
  id: string
  date: CalendarDate
  mode: SessionMode
  phase: SessionPhase
  puzzle: Puzzle
  elapsedMs: number
  runningSince: number | null
  completedAt: number | null
  completedOn: CalendarDate | null
}

export interface Settings {
  mode: SessionMode
  theme: 'light' | 'dark'
  muted: boolean
  volume: number
  skin: WoodSkin
}

export interface CompletionRecord extends Versions {
  id: string
  date: CalendarDate
  mode: SessionMode
  steps: number
  elapsedMs: number | null
  completedAt: number
  completedOn: CalendarDate
  timingVersion: typeof TIMING_VERSION
}

type StorageAccess = Pick<Storage, 'getItem' | 'setItem' | 'key' | 'length'>

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  mode: 'timed',
  theme: 'light',
  muted: false,
  volume: 0.35,
  skin: 'natural',
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']
const DAY_MS = 86_400_000
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/

function twoDigits(value: number): string {
  return String(value).padStart(2, '0')
}

function utcDate(year: number, month: number, day: number): Date {
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  return date
}

export function parseDate(value: string): CalendarDate | null {
  if (value.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return null

  const date = utcDate(year, month, day)
  if (date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null
  return { iso: value, year, month, day, weekday: date.getUTCDay() || 7 }
}

export function localDate(now = new Date()): CalendarDate {
  const year = String(now.getFullYear()).padStart(4, '0')
  const date = parseDate(`${year}-${twoDigits(now.getMonth() + 1)}-${twoDigits(now.getDate())}`)
  if (!date) throw new RangeError('本地日期需在公历 0001 至 9999 年之间。')
  return date
}

export function formatDate(date: CalendarDate): string {
  return `${date.year}年${date.month}月${date.day}日 星期${WEEKDAYS[date.weekday - 1]}`
}

export function formatTime(ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000)
  return `${twoDigits(Math.floor(seconds / 60))}:${twoDigits(seconds % 60)}`
}

function newSessionId(): string {
  if (globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID()
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')
}

export function createSession<Puzzle>(
  date: CalendarDate,
  mode: SessionMode,
  puzzle: Puzzle,
  id = newSessionId(),
): Session<Puzzle> {
  return {
    id,
    date,
    mode,
    phase: 'ready',
    puzzle,
    elapsedMs: 0,
    runningSince: null,
    completedAt: null,
    completedOn: null,
  }
}

export function startSession<Puzzle>(session: Session<Puzzle>, now = performance.now()): Session<Puzzle> {
  if (session.phase !== 'ready' && session.phase !== 'paused') return session
  return { ...session, phase: 'running', runningSince: now }
}

export function elapsedTime(session: Session<unknown>, now = performance.now()): number {
  if (session.mode === 'relaxed') return 0
  if (session.phase !== 'running' || session.runningSince === null) return session.elapsedMs
  return session.elapsedMs + Math.max(0, now - session.runningSince)
}

export function pauseSession<Puzzle>(session: Session<Puzzle>, now = performance.now()): Session<Puzzle> {
  if (session.phase !== 'running') return session
  return { ...session, phase: 'paused', elapsedMs: elapsedTime(session, now), runningSince: null }
}

export function completeSession<Puzzle>(
  session: Session<Puzzle>,
  now = performance.now(),
  wallClock = new Date(),
): Session<Puzzle> {
  if (session.phase !== 'running') return session
  return {
    ...session,
    phase: 'complete',
    elapsedMs: elapsedTime(session, now),
    runningSince: null,
    completedAt: wallClock.getTime(),
    completedOn: localDate(wallClock),
  }
}

function localStorageAccess(): StorageAccess | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

function readStored(storage: StorageAccess | undefined, key: string): unknown {
  try {
    const value = storage?.getItem(key)
    return value ? JSON.parse(value) : null
  } catch {
    return null
  }
}

function writeStored(storage: StorageAccess | undefined, key: string, value: unknown): boolean {
  if (!storage) return false
  try {
    storage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

function storageScope(versions: Versions): string {
  const board = encodeURIComponent(versions.boardVersion)
  const pieces = encodeURIComponent(versions.pieceSetVersion)
  return `${STORAGE_NAMESPACE}:${board}:${pieces}:${TIMING_VERSION}`
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSessionId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value)
}

function isMode(value: unknown): value is SessionMode {
  return value === 'timed' || value === 'relaxed'
}

function isSavedPhase(value: unknown): value is Exclude<SessionPhase, 'running'> {
  return value === 'ready' || value === 'paused' || value === 'complete'
}

function isDuration(value: unknown): value is number {
  return typeof value === 'number' && value >= 0 && value <= Number.MAX_SAFE_INTEGER
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && Math.abs(value) <= 8.64e15
}

function validateDate(value: unknown): CalendarDate | null {
  if (!isObject(value) || typeof value.iso !== 'string') return null
  const date = parseDate(value.iso)
  if (!date || date.weekday !== value.weekday || date.year !== value.year
    || date.month !== value.month || date.day !== value.day) return null
  return date
}

function isSkin(value: unknown): value is WoodSkin {
  return value === 'natural' || value === 'honey' || value === 'cherry' || value === 'walnut'
}

export function loadSettings(storage = localStorageAccess()): Settings {
  const value = readStored(storage, `${STORAGE_NAMESPACE}:settings`)
  if (!isObject(value)) return { ...DEFAULT_SETTINGS }
  return {
    mode: isMode(value.mode) ? value.mode : DEFAULT_SETTINGS.mode,
    theme: value.theme === 'dark' ? 'dark' : 'light',
    muted: typeof value.muted === 'boolean' ? value.muted : DEFAULT_SETTINGS.muted,
    volume: typeof value.volume === 'number' && value.volume >= 0 && value.volume <= 1
      ? value.volume : DEFAULT_SETTINGS.volume,
    skin: isSkin(value.skin) ? value.skin : DEFAULT_SETTINGS.skin,
  }
}

export function saveSettings(settings: Settings, storage = localStorageAccess()): boolean {
  return writeStored(storage, `${STORAGE_NAMESPACE}:settings`, settings)
}

export function saveSession<Puzzle>(
  versions: Versions,
  session: Session<Puzzle>,
  storage = localStorageAccess(),
  now = performance.now(),
): boolean {
  return writeStored(storage, `${storageScope(versions)}:progress`, {
    ...session,
    ...versions,
    timingVersion: TIMING_VERSION,
    phase: session.phase === 'running' ? 'paused' : session.phase,
    elapsedMs: elapsedTime(session, now),
    runningSince: null,
  })
}

export function loadSession<Puzzle>(
  versions: Versions,
  validatePuzzle: (value: unknown, date: CalendarDate, phase: Exclude<SessionPhase, 'running'>) => Puzzle | null,
  storage = localStorageAccess(),
): Session<Puzzle> | null {
  const value = readStored(storage, `${storageScope(versions)}:progress`)
  if (!isObject(value) || value.boardVersion !== versions.boardVersion
    || value.pieceSetVersion !== versions.pieceSetVersion || value.timingVersion !== TIMING_VERSION
    || !isSessionId(value.id) || !isMode(value.mode) || !isSavedPhase(value.phase)
    || !isDuration(value.elapsedMs) || value.runningSince !== null) return null
  if ((value.phase === 'ready' || value.mode === 'relaxed') && value.elapsedMs !== 0) return null

  const date = validateDate(value.date)
  if (!date) return null
  let completedAt: number | null = null
  let completedOn: CalendarDate | null = null
  if (value.phase === 'complete') {
    completedOn = validateDate(value.completedOn)
    if (!completedOn || !isTimestamp(value.completedAt)) return null
    completedAt = value.completedAt
  } else if (value.completedAt !== null || value.completedOn !== null) {
    return null
  }

  try {
    const puzzle = validatePuzzle(value.puzzle, date, value.phase)
    if (puzzle === null) return null
    return {
      id: value.id,
      date,
      mode: value.mode,
      phase: value.phase,
      puzzle,
      elapsedMs: value.elapsedMs,
      runningSince: null,
      completedAt,
      completedOn,
    }
  } catch {
    return null
  }
}

function validateRecord(value: unknown, id: string, versions: Versions): CompletionRecord | null {
  if (!isObject(value) || !isSessionId(value.id) || value.id !== id
    || !isMode(value.mode) || value.boardVersion !== versions.boardVersion
    || value.pieceSetVersion !== versions.pieceSetVersion || value.timingVersion !== TIMING_VERSION
    || !isTimestamp(value.completedAt) || !isDuration(value.steps) || !Number.isSafeInteger(value.steps)) return null

  const date = validateDate(value.date)
  const completedOn = validateDate(value.completedOn)
  if (!date || !completedOn) return null
  let elapsedMs: number | null = null
  if (value.mode === 'timed') {
    if (!isDuration(value.elapsedMs)) return null
    elapsedMs = value.elapsedMs
  } else if (value.elapsedMs !== null) {
    return null
  }

  return {
    ...versions,
    id,
    date,
    mode: value.mode,
    steps: value.steps,
    elapsedMs,
    completedAt: value.completedAt,
    completedOn,
    timingVersion: TIMING_VERSION,
  }
}

export function loadRecords(versions: Versions, storage = localStorageAccess()): CompletionRecord[] {
  const records: CompletionRecord[] = []
  if (!storage) return records
  const prefix = `${storageScope(versions)}:result:`

  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (!key?.startsWith(prefix)) continue
      const record = validateRecord(readStored(storage, key), key.slice(prefix.length), versions)
      if (record) records.push(record)
    }
  } catch {
    return records
  }
  return records.sort(compareHistory)
}

function compareHistory(a: CompletionRecord, b: CompletionRecord): number {
  return b.completedAt - a.completedAt || a.id.localeCompare(b.id)
}

function compareTimedRecords(a: CompletionRecord, b: CompletionRecord): number {
  return (a.elapsedMs ?? Infinity) - (b.elapsedMs ?? Infinity)
    || a.steps - b.steps || a.completedAt - b.completedAt || a.id.localeCompare(b.id)
}

export function getBestRecord(records: readonly CompletionRecord[], iso: string): CompletionRecord | null {
  let best: CompletionRecord | null = null
  for (const record of records) {
    if (record.date.iso !== iso || record.elapsedMs === null) continue
    if (!best || compareTimedRecords(record, best) < 0) best = record
  }
  return best
}

export function recordCompletion(
  versions: Versions,
  session: Session<unknown>,
  steps: number,
  storage = localStorageAccess(),
) {
  if (session.phase !== 'complete') return null
  const candidate = validateRecord({
    ...versions,
    id: session.id,
    date: session.date,
    mode: session.mode,
    steps,
    elapsedMs: session.mode === 'timed' ? session.elapsedMs : null,
    completedAt: session.completedAt,
    completedOn: session.completedOn,
    timingVersion: TIMING_VERSION,
  }, session.id, versions)
  if (!candidate) return null

  const records = loadRecords(versions, storage)
  const existing = records.find(record => record.id === candidate.id)
  const record = existing ?? candidate
  // Per-session keys make repeat saves idempotent and isolate other tabs' results.
  const saved = Boolean(existing) || writeStored(storage, `${storageScope(versions)}:result:${record.id}`, record)
  if (!existing) {
    records.push(record)
    records.sort(compareHistory)
  }
  const best = getBestRecord(records, record.date.iso)
  return { record, records, best, isPersonalBest: best?.id === record.id, saved }
}

export function getAchievements(records: readonly CompletionRecord[], today = localDate()) {
  const distinctDates = new Set(records.map(record => record.date.iso)).size
  const dailyCompletions = new Set<number>()
  const todayIndex = utcDate(today.year, today.month, today.day).getTime() / DAY_MS

  for (const record of records) {
    const { date, completedOn } = record
    if (date.iso !== completedOn.iso) continue
    dailyCompletions.add(utcDate(date.year, date.month, date.day).getTime() / DAY_MS)
  }

  let run = 0
  let longestStreak = 0
  let currentStreak = 0
  let previousDay: number | null = null
  for (const day of [...dailyCompletions].sort((a, b) => a - b)) {
    run = previousDay !== null && day === previousDay + 1 ? run + 1 : 1
    longestStreak = Math.max(longestStreak, run)
    if (day === todayIndex || day === todayIndex - 1) currentStreak = run
    previousDay = day
  }

  const unlockedSkins: WoodSkin[] = ['natural']
  if (distinctDates >= 30) unlockedSkins.push('honey')
  if (distinctDates >= 100) unlockedSkins.push('cherry')
  if (distinctDates >= 365) unlockedSkins.push('walnut')
  return { distinctDates, currentStreak, longestStreak, unlockedSkins }
}
