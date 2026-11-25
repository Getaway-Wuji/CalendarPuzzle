import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DndContext } from '@dnd-kit/core';
import { ArrowLeft, CalendarDays, CircleHelp, Clock3, FlipHorizontal2, Moon, Pause, Play, RotateCcw,
  RotateCw, Settings2, Sun, Trophy, Volume2, VolumeX, X } from 'lucide-react';
import type { FormEvent, ReactNode } from 'react';
import init, { Puzzle } from '../generated/calendar-puzzle/calendar_puzzle.js';
import FadeContent from '../react-bits/FadeContent';
import SquishSwitch from '../react-bits/SquishSwitch';
import { Board, LiftedPiece, Tray } from './Board';
import { usePuzzleInput } from './input';
import { WoodSound } from './sound';
import { config, versions } from './wood';
import type { Snapshot } from './wood';
import { completeSession, createSession, elapsedTime, formatDate, formatTime, getAchievements, getBestRecord,
  loadRecords, loadSession, loadSettings, localDate, parseDate, pauseSession, recordCompletion,
  saveSession, saveSettings, startSession } from './session';
import type { CalendarDate, SessionMode, Settings, WoodSkin } from './session';
import solvability from './solvability.json';
import './styles.css';

type Panel = 'date' | 'settings' | 'rules' | 'records' | 'result';
const skins: Record<WoodSkin, { name: string; days: number }> = {
  natural: { name: '浅原木', days: 0 }, honey: { name: '蜜色橡木', days: 30 },
  cherry: { name: '樱桃木', days: 100 }, walnut: { name: '深胡桃木', days: 365 },
};

function availability(date: CalendarDate) {
  if (solvability.boardVersion !== versions.boardVersion || solvability.pieceSetVersion !== versions.pieceSetVersion) return '?';
  const days: Record<string, string> = solvability.days;
  return days[date.iso.slice(5)]?.[date.weekday - 1] ?? '?';
}

function readSnapshot(engine: Puzzle): Snapshot {
  return JSON.parse(engine.snapshot()) as Snapshot;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return <dialog ref={ref} className="modal cal-modal" aria-labelledby="cal-modal-title" onCancel={event => {
    event.preventDefault();
    onClose();
  }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="modal-box cal-modal-box">
      <div className="cal-modal-heading"><h2 id="cal-modal-title">{title}</h2>
        <button className="cal-icon-btn" aria-label="关闭" onClick={onClose}><X size={20} /></button></div>
      {children}
    </div>
  </dialog>;
}

function Timer({ session }: { session: { mode: SessionMode; elapsed: number; runningSince: number | null } }) {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (session.runningSince === null) return;
    const tick = () => setNow(performance.now());
    const id = window.setInterval(tick, 200);
    return () => window.clearInterval(id);
  }, [session.runningSince]);
  const elapsed = session.elapsed + (session.runningSince === null ? 0 : Math.max(0, now - session.runningSince));
  return <span className="cal-clock"><Clock3 size={17} aria-hidden="true" />
    <span>{session.mode === 'timed' ? formatTime(elapsed) : '轻松'}</span></span>;
}

function App() {
  const [initial] = useState(() => {
    const settings = loadSettings();
    const current = loadSession(versions, (save, date, phase) => {
      if (typeof save !== 'string') return null;
      const engine = new Puzzle(config, date.iso, save);
      try {
        const snapshot = readSnapshot(engine);
        return snapshot.complete === (phase === 'complete')
          && (phase !== 'ready' || (snapshot.steps === 0 && snapshot.used === 0)) ? save : null;
      } finally { engine.free(); }
    });
    const today = localDate();
    const restored = current ?? createSession(today, settings.mode, '');
    const engine = new Puzzle(config, restored.date.iso, restored.puzzle || undefined);
    const snapshot = readSnapshot(engine);
    const result = restored.phase === 'complete' ? recordCompletion(versions, restored, snapshot.steps) : null;
    return { restored, engine, snapshot, settings, records: result?.records ?? loadRecords(versions) };
  });
  const engine = useRef(initial.engine);
  const [snapshot, setSnapshot] = useState(initial.snapshot);
  const [session, renderSession] = useState(initial.restored);
  const sessionRef = useRef(initial.restored);
  const [settings, setSettings] = useState(initial.settings);
  const [records, setRecords] = useState(initial.records);
  const [today, setToday] = useState(localDate);
  const [panel, setPanel] = useState<Panel | null>(initial.restored.phase === 'complete' ? 'result' : null);
  const [draft, setDraft] = useState(session.date.iso);
  const [draftMode, setDraftMode] = useState(session.mode);
  const [message, notify] = useState('');
  const [sound] = useState(() => new WoodSound());
  const board = useRef<HTMLDivElement>(null);
  const achievements = getAchievements(records, today);
  const skin = achievements.unlockedSkins.includes(settings.skin) ? settings.skin : 'natural';
  const available = availability(session.date);
  const enabled = session.phase === 'running' && panel === null;
  const volume = settings.muted ? 0 : settings.volume;
  const draftDate = parseDate(draft);
  const latest = records.find(record => record.id === session.id);
  const best = getBestRecord(records, session.date.iso);

  function updateSettings(next: Partial<Settings>) {
    const value = { ...settings, ...next };
    saveSettings(value);
    setSettings(value);
    sound.volume(value.muted ? 0 : value.volume);
  }

  function keep(value: typeof session) {
    sessionRef.current = value;
    saveSession(versions, value);
    renderSession(value);
  }

  function commit(feedback = '') {
    const next = readSnapshot(engine.current);
    setSnapshot(next);
    let progressed = { ...sessionRef.current, puzzle: engine.current.serialize() };
    if (next.complete && progressed.phase === 'running') {
      progressed = completeSession(progressed);
      const result = recordCompletion(versions, progressed, next.steps);
      if (result) setRecords(result.records);
      setPanel('result');
      sound.stop();
    }
    keep(progressed);
    notify(next.used > 0 && !next.remaining && !next.complete
      ? '拼图已放齐。请调整摆法，让三个目标格露出来。' : feedback);
  }

  const input = usePuzzleInput({ engine: engine.current, board, snapshot, enabled, sound,
    enableSound: () => sound.enable(volume), commit, notify });
  const cancelInput = input.cancel;

  useEffect(() => {
    const onBackground = (event: Event) => {
      if (event.type === 'pagehide' || document.visibilityState === 'hidden') {
        cancelInput();
        const value = pauseSession(sessionRef.current);
        sessionRef.current = value;
        saveSession(versions, value);
        renderSession(value);
      } else setToday(localDate());
    };
    const saveProgress = () => saveSession(versions, sessionRef.current);
    document.addEventListener('visibilitychange', onBackground);
    window.addEventListener('pagehide', onBackground);
    const interval = window.setInterval(saveProgress, 5000);
    return () => {
      document.removeEventListener('visibilitychange', onBackground);
      window.removeEventListener('pagehide', onBackground);
      window.clearInterval(interval);
    };
  }, [cancelInput]);

  const events = { focus: input.select, press: input.handlePress };

  function open(next: Panel) {
    input.cancel();
    keep(pauseSession(sessionRef.current));
    setToday(localDate());
    if (next === 'date') {
      setDraft(session.date.iso);
      setDraftMode(settings.mode);
    }
    setPanel(next);
  }

  function start() {
    sound.enable(volume);
    keep(startSession({ ...sessionRef.current, puzzle: engine.current.serialize() }));
    notify('');
  }

  function newGame(date: CalendarDate, mode: SessionMode) {
    input.clear();
    const previous = engine.current;
    engine.current = new Puzzle(config, date.iso);
    previous.free();
    setSnapshot(readSnapshot(engine.current));
    keep(createSession(date, mode, engine.current.serialize()));
    setPanel(null);
    notify('');
  }

  function applyDate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draftDate) return;
    updateSettings({ mode: draftMode });
    newGame(draftDate, draftMode);
  }

  const runningSince = session.phase === 'running' ? session.runningSince : null;
  return <div className="cal-page" data-theme={settings.theme}>
    <a href="#calendar-main" className="cal-skip">跳到拼图</a>
    <header className="cal-header">
      <div className="cal-header-inner">
        <a className="cal-back" href="https://game.grace-spring.top/"><ArrowLeft size={18} />返回游戏大厅</a>
        <nav aria-label="游戏工具">
          <button className="cal-nav-btn" onClick={() => open('rules')}><CircleHelp size={18} /><span>规则</span></button>
          <button className="cal-nav-btn" onClick={() => open('records')}><Trophy size={18} /><span>成绩</span></button>
          <button className="cal-nav-btn" onClick={() => open('settings')}><Settings2 size={18} /><span>设置</span></button>
        </nav>
      </div>
    </header>

    <main id="calendar-main" className="cal-main" data-phase={session.phase}>
      <div className="cal-intro">
        <div><h1>日历拼图</h1><p>摆放木块，只露出目标的月份、日期和星期。</p></div>
        <button className="cal-button cal-date-button" onClick={() => open('date')}><CalendarDays size={18} />选择日期</button>
      </div>
      <section className="cal-target-bar" aria-label="拼图目标">
        <div className="cal-target">
          <span className="cal-target-label">{session.date.iso === today.iso ? '今日目标' : '目标日期'}</span>
          <strong data-target-date={session.date.iso}>{formatDate(session.date)}</strong>
        </div>
        <div className="cal-round-stats">
          <div className="cal-moves"><strong className="cal-steps">{snapshot.steps}</strong><span>步</span></div>
          <Timer session={{ mode: session.mode, elapsed: elapsedTime(session, runningSince ?? performance.now()),
            runningSince: session.mode === 'timed' ? runningSince : null }} />
          {session.phase === 'running' && <button className="cal-icon-btn" aria-label="暂停" onClick={() => {
            input.cancel();
            keep(pauseSession(sessionRef.current));
          }}><Pause size={19} /></button>}
        </div>
      </section>
      {available !== 'S' && <p className="cal-availability" role="note">
        {available === 'U' ? '当前拼图配置下，这一天无解。可继续试摆，或选择其他日期。' : '这个日期的可解性待验证。'}
      </p>}

      <DndContext {...input.dnd} autoScroll={false}>
        <div className="cal-workbench">
          <div className="cal-table">
            <Board board={board} snapshot={snapshot} skin={skin} enabled={enabled}
              selection={input.selection} preview={input.preview} events={events} aimAt={input.aimAt} />
            {(session.phase === 'ready' || session.phase === 'paused') && <div className={`cal-start cal-start-${session.phase}`}>
              {session.phase === 'ready' ? <div className="cal-start-options">
                <label><input type="radio" name="mode" checked={session.mode === 'timed'} onChange={() => {
                  updateSettings({ mode: 'timed' }); keep({ ...sessionRef.current, mode: 'timed' });
                }} />计时挑战</label>
                <label><input type="radio" name="mode" checked={session.mode === 'relaxed'} onChange={() => {
                  updateSettings({ mode: 'relaxed' }); keep({ ...sessionRef.current, mode: 'relaxed' });
                }} />轻松拼图</label>
              </div> : <p className="cal-paused-label">已暂停</p>}
              <button className="cal-button cal-primary" onClick={start}><Play size={16} fill="currentColor" />
                {session.phase === 'ready' ? '开始挑战' : '继续挑战'}</button>
            </div>}
          </div>

          {panel === 'result' ? <section className="cal-palette cal-result" role="dialog" aria-labelledby="cal-result-title">
            <div className="cal-modal-heading"><h2 id="cal-result-title">成功通关</h2>
              <button className="cal-icon-btn" aria-label="关闭" onClick={() => setPanel(null)}><X size={20} /></button></div>
            <FadeContent trigger="mount" duration={320} className="cal-result-stats">
              <p className="cal-result-kicker"><Trophy size={18} /> 大脑升级</p>
              <p>{formatDate(session.date)}</p>
              <p><strong>{snapshot.steps} 步</strong> · {session.mode === 'timed' ? formatTime(session.elapsedMs) : '本局未开启计时'}</p>
              {latest && best?.id === latest.id && <p>本机该日期最快记录</p>}
            </FadeContent>
            <div className="cal-modal-actions cal-result-actions">
              <button className="cal-button cal-primary" onClick={() => newGame(session.date, session.mode)}>再拼一次</button>
              <button className="cal-button" onClick={() => open('date')}>选择其他日期</button>
              <button className="cal-button" onClick={() => newGame(localDate(), settings.mode)}><Sun size={15} />返回今天</button>
              <a className="cal-button" href="https://game.grace-spring.top/">返回游戏大厅</a>
            </div>
          </section> : <section className="cal-palette" aria-label="拼图库">
            <div className="cal-palette-head"><h2>拼图库</h2><span>已用 {snapshot.used} · 剩余 {snapshot.remaining}</span></div>
            <Tray snapshot={snapshot} enabled={enabled} selection={input.selection} preview={input.preview}
              skin={skin} events={events} />
            <div className="cal-piece-actions">
              <button className="cal-button" disabled={!enabled || !input.selection} onClick={() => input.orient(input.selection, false)}>
                <RotateCw size={16} />旋转
              </button>
              <button className="cal-button" disabled={!enabled || !input.selection} onClick={() => input.orient(input.selection, true)}>
                <FlipHorizontal2 size={16} />翻转
              </button>
            </div>
            {input.preview && !input.preview.pointer && <button className="cal-button cal-confirm" onClick={input.confirm}>确认放置</button>}
            <p className="cal-live" role="status">{message || (session.phase === 'complete' ? '三个目标格已露出。' : '轻点旋转，长按翻转。')}</p>
            <div className="cal-board-actions">
              <button className="cal-text-button" disabled={!enabled} onClick={() => {
                input.clear();
                engine.current.recycleAll();
                commit('拼图已全部收回。');
              }}>全部收回</button>
              <button className="cal-text-button" onClick={() => newGame(session.date, session.mode)}>
                <RotateCcw size={14} />重置关卡</button>
            </div>
          </section>}
        </div>
        <LiftedPiece preview={input.preview} skin={skin} />
      </DndContext>
      {session.phase === 'complete' && !panel && <footer className="cal-footer">
        <button className="cal-text-button" onClick={() => open('result')}>查看通关结果</button>
      </footer>}
    </main>

    {panel === 'date' && <Modal title="选择日期" onClose={() => setPanel(null)}>
      <form className="cal-form" onSubmit={applyDate}>
        <label className="cal-field">目标日期<input aria-label="目标日期" type="date" min="0001-01-01" max="9999-12-31"
          required value={draft} onChange={event => setDraft(event.target.value)} /></label>
        <p className="cal-date-preview">{draftDate ? formatDate(draftDate) : '请选择有效的公历日期。'}</p>
        {draftDate && availability(draftDate) === 'U' && <p className="cal-availability">当前拼图配置下，这一天无解。可继续试摆，或选择其他日期。</p>}
        <label className="cal-field">挑战模式<select value={draftMode} onChange={event => setDraftMode(event.target.value as SessionMode)}>
          <option value="timed">计时挑战</option><option value="relaxed">轻松拼图</option>
        </select></label>
        <div className="cal-modal-actions"><button className="cal-button" type="button" onClick={() => setDraft(localDate().iso)}>选今天</button>
          <button className="cal-button cal-primary" disabled={!draftDate}>开始该日期</button></div>
      </form>
    </Modal>}

    {panel === 'settings' && <Modal title="设置" onClose={() => setPanel(null)}>
      <div className="cal-settings-list">
        <div className="cal-setting"><span><Moon size={17} />深色模式</span>
          <SquishSwitch checked={settings.theme === 'dark'} ariaLabel="深色模式" width={54} height={30}
            trackColor="#bca58b" trackOnColor="#75573b" thumbColor="#fff4db" thumbOnColor="#f7d79f"
            onChange={value => updateSettings({ theme: value ? 'dark' : 'light' })} /></div>
        <div className="cal-setting"><span><VolumeX size={17} />静音</span>
          <SquishSwitch checked={settings.muted} ariaLabel="静音" width={54} height={30}
            trackColor="#bca58b" trackOnColor="#75573b" thumbColor="#fff4db" thumbOnColor="#f7d79f"
            onChange={muted => updateSettings({ muted })} /></div>
        <label className="cal-field cal-volume"><span><Volume2 size={17} />音量</span>
          <input type="range" min="0" max="1" step="0.05" value={settings.volume} onChange={event =>
            updateSettings({ volume: Number(event.target.value) })} /></label>
        <label className="cal-field">木质外观<select value={skin} onChange={event => updateSettings({ skin: event.target.value as WoodSkin })}>
          {Object.entries(skins).map(([id, item]) => <option key={id} value={id}
            disabled={!achievements.unlockedSkins.includes(id as WoodSkin)}>{item.name}{item.days ? ` · ${item.days} 个日期` : ''}</option>)}
        </select></label>
      </div>
    </Modal>}

    {panel === 'rules' && <Modal title="拼图规则" onClose={() => setPanel(null)}>
      <div className="cal-rules">
        <p>把所有木块放进棋盘，只露出目标的月份、日期和星期。试摆时可以暂时盖住目标格。</p>
        <p>拖动放置木块，轻点顺时针旋转，长按翻转。非法松手时木块回到图库。按 Esc 可取消这次操作。</p>
        <p>键盘可用 Tab 选块，R 旋转，F 翻转，方向键选落点，Enter 放置。</p>
        <p>首次放入、移动到新位置，或调整朝向后改变占格，各计一步。回收、取消和图库中调整朝向均不计步。</p>
      </div>
    </Modal>}

    {panel === 'records' && <Modal title="本机最快记录" onClose={() => setPanel(null)}>
      <p className="cal-record-best">{formatDate(session.date)}<strong>{best
        ? `${formatTime(best.elapsedMs!)} · ${best.steps} 步` : '暂无计时通关记录'}</strong></p>
      <h3>挑战历史</h3>
      {records.length ? <ul className="cal-history">{records.map(record => <li key={record.id}>
        <span>{formatDate(record.date)}</span><strong>{record.elapsedMs === null ? '轻松' : formatTime(record.elapsedMs)} · {record.steps} 步</strong>
      </li>)}</ul> : <p>通关后会在这里留下记录。</p>}
      <h3>累计成就</h3>
      <p>已完成 {achievements.distinctDates} 个不同日期 · 连续挑战 {achievements.currentStreak} 天</p>
      <div className="cal-badges">
        {[7, 30].map(days => <span key={days} data-unlocked={achievements.longestStreak >= days}>
          <Trophy size={15} />连续 {days} 天 · 拼图达人</span>)}
      </div>
    </Modal>}

  </div>;
}

const mount = document.getElementById('calendar-puzzle-root')!;
const root = createRoot(mount);
init().then(() => root.render(<App />)).catch(error => {
  console.error(error);
  root.render(<main className="cal-load-error"><h1>日历拼图</h1><p>棋盘加载失败。请刷新页面后再试。</p>
    <button className="cal-button" onClick={() => window.location.reload()}>刷新页面</button>
    <a className="cal-back" href="https://game.grace-spring.top/">返回游戏大厅</a></main>);
});
