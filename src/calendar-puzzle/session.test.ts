import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  completeSession,
  createSession,
  DEFAULT_SETTINGS,
  elapsedTime,
  formatDate,
  formatTime,
  getAchievements,
  getBestRecord,
  loadRecords,
  loadSession,
  loadSettings,
  localDate,
  parseDate,
  pauseSession,
  recordCompletion,
  saveSession,
  saveSettings,
  startSession,
  TIMING_VERSION,
  type CalendarDate,
  type CompletionRecord,
  type SessionMode,
} from './session'

class MemoryStorage {
  values = new Map<string, string>()

  get length() { return this.values.size }
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  key(index: number) { return Array.from(this.values.keys())[index] ?? null }
}

const versions = { boardVersion: 'board', pieceSetVersion: 'pieces' }
const parse = (iso: string) => parseDate(iso) as CalendarDate
const validate = (snapshot: unknown) => snapshot === 'valid' ? snapshot : null

function finish(
  id: string,
  time: number,
  mode: SessionMode = 'timed',
  completion = new Date(2024, 1, 29, 12),
) {
  const session = startSession(createSession(parse('2024-02-29'), mode, 'valid', id), 0)
  return completeSession(session, time, completion)
}

describe('civil dates', () => {
  test('validate leap years and exact dates, and calculate ISO weekdays', () => {
    assert.equal(parse('2024-02-28').weekday, 3)
    assert.equal(parse('2024-02-29').weekday, 4)
    assert.equal(parse('2024-03-01').weekday, 5)
    assert.equal(parse('2000-02-29').weekday, 2)
    assert.equal(parse('2023-12-31').weekday, 7)
    assert.equal(parse('2024-01-01').weekday, 1)
    assert.equal(parse('0001-01-01').weekday, 1)
    assert.equal(parse('0099-01-01').year, 99)
    assert.equal(formatDate(parse('2024-02-29')), '2024年2月29日 星期四')
    for (const invalid of ['1900-02-29', '2100-02-29', '2025-02-29', '2024-04-31', '2024-12-00',
      '2024-13-01', '2024-00-02', '0000-01-01', '10000-01-01', '2024-2-29', '2024-02-29\n', '']) {
      assert.equal(parseDate(invalid), null)
    }
  })

  test('today uses the browser local calendar across UTC midnight', () => {
    const previousTz = process.env.TZ
    try {
      process.env.TZ = 'Asia/Shanghai'
      const nearMidnight = new Date('2023-12-31T16:15:00.000Z')
      assert.equal(nearMidnight.getUTCDate(), 31)
      assert.deepEqual(localDate(nearMidnight), parse('2024-01-01'))
    } finally {
      if (previousTz) process.env.TZ = previousTz
      else delete process.env.TZ
    }
  })
})

describe('session clocks', () => {
  test('start, pause, resume and finish use actual elapsed time', () => {
    const ready = createSession(parse('2024-02-29'), 'timed', 'valid', 'session')
    const running = startSession(ready, 10)
    assert.equal(startSession(running, 200), running)
    assert.equal(elapsedTime(running, 1140), 1130)
    const paused = pauseSession(running, 2010)
    assert.equal(paused.phase, 'paused')
    assert.equal(elapsedTime(paused, 20_010), 2000)
    const resumed = startSession(paused, 20_010)
    const completed = completeSession(resumed, 23_255, new Date(2024, 1, 29))
    assert.equal(completed.phase, 'complete')
    assert.equal(elapsedTime(completed, 60_000), 5245)
    assert.equal(formatTime(elapsedTime(completed, 60_000)), '00:05')
    assert.equal(formatTime(3_659_999), '60:59')
    assert.equal(completeSession(completed, 60_010), completed)
    assert.equal(startSession(completed, 60_010), completed)
  })

  test('relaxed sessions have no elapsed value and midnight leaves the target frozen', () => {
    const completed = finish('overnight', 9_000_000, 'relaxed', new Date(2024, 2, 1, 0, 10))
    assert.equal(elapsedTime(completed), 0)
    assert.equal(completed.date.iso, '2024-02-29')
    assert.equal(completed.completedOn?.iso, '2024-03-01')
  })
})

describe('local storage', () => {
  test('stores settings and uses defaults for invalid fields', () => {
    const storage = new MemoryStorage()
    assert.deepEqual(loadSettings(storage), DEFAULT_SETTINGS)
    const settings = { ...DEFAULT_SETTINGS, theme: 'dark', muted: true, volume: 0.8 } as const
    assert.equal(saveSettings(settings, storage), true)
    assert.deepEqual(loadSettings(storage), settings)
    storage.setItem(storage.key(0)!, JSON.stringify({ theme: 'dark', volume: 2, skin: 'invalid' }))
    assert.deepEqual(loadSettings(storage), { ...DEFAULT_SETTINGS, theme: 'dark' })
  })

  test('restores an in-progress save in paused state and validates both date and puzzle', () => {
    const storage = new MemoryStorage()
    const session = startSession(createSession(parse('2024-02-29'), 'timed', 'valid'), 100)
    assert.equal(saveSession(versions, session, storage, 1245), true)
    assert.deepEqual(loadSession(versions, validate, storage), pauseSession(session, 1245))
    assert.equal(loadSession({ ...versions, pieceSetVersion: 'other' }, validate, storage), null)
    assert.equal(loadSession(versions, () => null, storage), null)
    assert.equal(loadSession(versions, () => { throw new Error('invalid puzzle') }, storage), null)

    const key = storage.key(0)!
    const saved = JSON.parse(storage.getItem(key)!)
    storage.setItem(key, JSON.stringify({ ...saved, date: { ...saved.date, weekday: 5 } }))
    assert.equal(loadSession(versions, validate, storage), null)
    storage.setItem(key, JSON.stringify({ ...saved, elapsedMs: -1 }))
    assert.equal(loadSession(versions, validate, storage), null)
    storage.setItem(key, JSON.stringify({ ...saved, boardVersion: 'other' }))
    assert.equal(loadSession(versions, validate, storage), null)
  })

  test('preserves the completed result and skips invalid completed-at fields', () => {
    const storage = new MemoryStorage()
    const session = finish('done', 90)
    saveSession(versions, session, storage)
    assert.deepEqual(loadSession(versions, (puzzle, date, phase) => {
      assert.equal(date.iso, '2024-02-29')
      assert.equal(phase, 'complete')
      return validate(puzzle)
    }, storage), session)
    const key = storage.key(0)!
    storage.setItem(key, JSON.stringify({ ...JSON.parse(storage.getItem(key)!), completedOn: null }))
    assert.equal(loadSession(versions, validate, storage), null)
  })

  test('uses a single completion per session and sorts timed results by time, steps and completion', () => {
    const storage = new MemoryStorage()
    const record = (id: string, elapsedMs: number, steps: number, seconds: number, mode?: SessionMode) =>
      recordCompletion(versions, finish(id, elapsedMs, mode, new Date(2024, 1, 29, 12, 30, seconds)), steps, storage)

    assert.equal(record('faster-steps-more', 300, 12, 30)?.isPersonalBest, true)
    assert.equal(record('slower', 600, 8, 29)?.isPersonalBest, false)
    assert.equal(record('faster-steps-fewer', 300, 9, 31)?.isPersonalBest, true)
    assert.equal(record('same-steps-earlier', 300, 9, 20)?.isPersonalBest, true)
    assert.equal(record('relaxed', 10, 8, 11, 'relaxed')?.isPersonalBest, false)
    assert.equal(record('same-steps-earlier', 1, 1, 40)?.record.steps, 9)
    assert.equal(record('invalid-steps', 30, -1, 18), null)

    const records = loadRecords(versions, storage)
    assert.equal(records.length, 5)
    assert.equal(getBestRecord(records, '2024-02-29')?.id, 'same-steps-earlier')
    assert.equal(getBestRecord(records, '2024-03-01'), null)
    assert.deepEqual(loadRecords({ ...versions, boardVersion: 'other' }, storage), [])
    assert.equal(records.find(row => row.id === 'relaxed')?.elapsedMs, null)
  })
})

describe('achievements', () => {
  function completion(date: CalendarDate, completedOn = date, id = date.iso): CompletionRecord {
    return { ...versions, date, completedOn, id, completedAt: 0, steps: 9,
      elapsedMs: null, mode: 'relaxed', timingVersion: TIMING_VERSION }
  }

  test('streak tracks only local-date matches, including leap and year boundaries', () => {
    const records = ['2023-12-29', '2023-12-30', '2023-12-31', '2024-01-01', '2024-01-02',
      '2024-01-03', '2024-01-04', '2024-02-28', '2024-02-29', '2024-03-01'].map(iso => completion(parse(iso)))
    records.push(completion(parse('2024-01-04'), parse('2024-01-04'), 'duplicate'))
    records.push(completion(parse('2024-03-02'), parse('2024-03-03'), 'past-day'))
    records.push(completion(parse('2024-03-04'), parse('2024-03-03'), 'future-day'))
    assert.deepEqual(getAchievements(records, parse('2024-03-02')), {
      distinctDates: 12, longestStreak: 7, currentStreak: 3, unlockedSkins: ['natural'],
    })
    assert.equal(getAchievements(records, parse('2024-03-04')).currentStreak, 0)
  })

  test('unlocks alternative woods for 30, 100 and 365 distinct dates', () => {
    const dates = Array.from({ length: 365 }, (_, index) =>
      parse(new Date(Date.UTC(2024, 0, index + 1)).toISOString().slice(0, 10)))
    const records = dates.map(date => completion(date))
    assert.deepEqual(getAchievements(records.slice(0, 29)).unlockedSkins, ['natural'])
    assert.deepEqual(getAchievements(records.slice(0, 30)).unlockedSkins, ['natural', 'honey'])
    assert.deepEqual(getAchievements(records.slice(0, 100)).unlockedSkins, ['natural', 'honey', 'cherry'])
    assert.deepEqual(getAchievements(records).unlockedSkins, ['natural', 'honey', 'cherry', 'walnut'])
  })
})
