import { Component } from 'react'
import { api } from '../services/api'
import OpenerMode from '../components/OpenerMode'

// [word, syllables, rhymeKey, inCorpus]
type WordTuple = [string, number, string, number]
type Bar = { word: string; color: string; opener: string | null }
type Screen = 'setup' | 'play' | 'done' | 'dict' | 'opener'

interface State {
  screen: Screen
  diff: number
  bars: number
  beatIdx: number
  scaffold: Bar[]
  activeBeat: number
  running: boolean
  dictQuery: string
  prefersRM: boolean
  wl: { words: WordTuple[]; openers: string[] } | null
}

const ORANGE = '#F08A2E'
const BLUE = '#5B9DF5'

// Built-in fixture — used only if the backend corpus is empty/offline.
const FIXTURE_WORDS: WordTuple[] = [
  ['improvisation', 5, 'AYSHUN', 1], ['conversation', 4, 'AYSHUN', 1], ['dedication', 4, 'AYSHUN', 1], ['elevation', 4, 'AYSHUN', 1], ['inspiration', 4, 'AYSHUN', 1], ['imagination', 5, 'AYSHUN', 1], ['celebration', 4, 'AYSHUN', 1], ['meditation', 4, 'AYSHUN', 1],
  ['fire', 1, 'IRE', 1], ['higher', 2, 'IRE', 1], ['inspire', 2, 'IRE', 1], ['entire', 2, 'IRE', 1], ['desire', 2, 'IRE', 1], ['wildfire', 2, 'IRE', 1], ['supplier', 3, 'IRE', 0],
  ['mind', 1, 'IND', 1], ['designed', 2, 'IND', 1], ['aligned', 2, 'IND', 1], ['intertwined', 3, 'IND', 1], ['mankind', 2, 'IND', 1], ['behind', 2, 'IND', 1], ['redefined', 3, 'IND', 1],
  ['flow', 1, 'OH', 1], ['tempo', 2, 'OH', 1], ['bestow', 2, 'OH', 1], ['crescendo', 3, 'OH', 1], ['afterglow', 3, 'OH', 1], ['domino', 3, 'OH', 1], ['studio', 3, 'OH', 1],
  ['create', 2, 'AYT', 1], ['elevate', 3, 'AYT', 1], ['resonate', 3, 'AYT', 1], ['gravitate', 3, 'AYT', 1], ['demonstrate', 3, 'AYT', 1], ['celebrate', 3, 'AYT', 1], ['great', 1, 'AYT', 1], ['state', 1, 'AYT', 1],
  ['kinetic', 3, 'ETIK', 1], ['poetic', 3, 'ETIK', 1], ['energetic', 4, 'ETIK', 1], ['magnetic', 3, 'ETIK', 1], ['eclectic', 3, 'ETIK', 1], ['copacetic', 4, 'ETIK', 1],
  ['energy', 3, 'EE', 1], ['synergy', 3, 'EE', 1], ['chemistry', 3, 'EE', 1], ['legacy', 3, 'EE', 1], ['memory', 3, 'EE', 1], ['effortlessly', 4, 'EE', 1], ['infinitely', 4, 'EE', 1],
  ['real', 1, 'EEL', 1], ['feel', 1, 'EEL', 1], ['reveal', 2, 'EEL', 1], ['surreal', 2, 'EEL', 1], ['ideal', 2, 'EEL', 1], ['appeal', 2, 'EEL', 1],
  ['moment', 2, 'OMENT', 1], ['component', 3, 'OMENT', 1], ['opponent', 3, 'OMENT', 1], ['atonement', 3, 'OMENT', 1],
  ['shine', 1, 'INE', 0], ['line', 1, 'INE', 0], ['divine', 2, 'INE', 0], ['design', 2, 'INE', 0],
  ['made', 1, 'AYD', 0], ['parade', 2, 'AYD', 0], ['cascade', 2, 'AYD', 0], ['persuade', 2, 'AYD', 0],
  ['dream', 1, 'EEM', 0], ['team', 1, 'EEM', 0], ['supreme', 2, 'EEM', 0], ['regime', 2, 'EEM', 0],
  ['zone', 1, 'OHN', 0], ['alone', 2, 'OHN', 0], ['microphone', 3, 'OHN', 0],
]
const FIXTURE_OPENERS: string[] = [
  'Yo, check it out —', 'Off the top, no pause,', 'You already know,', "I'm locked in right now,",
  'Let me paint the picture,', 'Real talk, no script,', 'Straight from the dome,', 'Watch me take it there,',
]
const NEAR: Record<string, string[]> = { IND: ['INE'], INE: ['IND'], AYT: ['AYD'], AYD: ['AYT'], EEL: ['EEM'], EEM: ['EEL'], OH: ['OHN'], OHN: ['OH'] }
const BEATS = [
  { name: 'Dusty Crates', bpm: 85, genre: 'Boom Bap', pat: { kick: [0, 7, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14] } },
  { name: 'Night Drive', bpm: 92, genre: 'West Coast', pat: { kick: [0, 6, 10, 14], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14] } },
  { name: 'Slow Burn', bpm: 72, genre: 'Lo-fi', pat: { kick: [0, 10], snare: [4, 12], hat: [0, 4, 6, 8, 12, 14] } },
]
const DIFFS = [
  { name: 'Beginner', min: 1, max: 2, openers: 2, desc: 'Common words · 1–2 syllables · opener on every bar' },
  { name: 'Intermediate', min: 1, max: 3, openers: 1, desc: 'Up to 3 syllables · opener on the first bar of each couplet' },
  { name: 'Advanced', min: 2, max: 9, openers: 0, desc: 'Multi-syllable targets · no openers' },
  { name: 'Expert', min: 3, max: 9, openers: 0, desc: 'Rare multis only · you are on your own' },
]

function sh<T>(a: T[]): T[] {
  a = a.slice()
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]] }
  return a
}
function rgba(hex: string, al: number): string {
  const n = parseInt(hex.slice(1), 16)
  return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + al + ')'
}

export default class RhymeGamePage extends Component<Record<string, never>, State> {
  state: State = {
    screen: 'setup', diff: 0, bars: 8, beatIdx: 0, scaffold: [], activeBeat: -1,
    running: false, dictQuery: '', prefersRM: false, wl: null,
  }

  // audio + round-clock engine (imperative, ref-held)
  ctx?: AudioContext
  master?: GainNode
  noiseBuf?: AudioBuffer
  spb = 0
  totalBeats = 0
  roundStart = 0
  step = 0
  nextTime = 0
  schedTimer: ReturnType<typeof setInterval> | null = null
  raf = 0
  patIdx = 0
  ballEl: HTMLDivElement | null = null
  gridEl: HTMLDivElement | null = null
  scrollEl: HTMLDivElement | null = null
  mq?: MediaQueryList
  mqHandler = (e: MediaQueryListEvent) => this.setState({ prefersRM: e.matches })

  componentDidMount() {
    try {
      this.mq = window.matchMedia('(prefers-reduced-motion: reduce)')
      this.setState({ prefersRM: this.mq.matches })
      this.mq.addEventListener('change', this.mqHandler)
    } catch { /* ignore */ }
    api.getWordList('harry_mack')
      .then((d) => {
        if (d && Array.isArray(d.words) && d.words.length >= 2) {
          this.setState({ wl: { words: d.words as WordTuple[], openers: d.openers?.length ? d.openers : FIXTURE_OPENERS } })
        }
      })
      .catch(() => { /* keep fixture */ })
  }

  componentWillUnmount() {
    this.stopClock()
    if (this.mq) try { this.mq.removeEventListener('change', this.mqHandler) } catch { /* ignore */ }
    if (this.ctx) try { this.ctx.close() } catch { /* ignore */ }
  }

  getWords(): WordTuple[] { return (this.state.wl && this.state.wl.words) || FIXTURE_WORDS }
  getOpeners(): string[] { return (this.state.wl && this.state.wl.openers) || FIXTURE_OPENERS }

  groupsFor(min: number, max: number) {
    const m: Record<string, { w: string; syl: number }[]> = {}
    this.getWords().forEach(([w, syl, key, hm]) => {
      if (!hm || syl < min || syl > max) return
      ;(m[key] = m[key] || []).push({ w, syl })
    })
    return Object.keys(m).filter((k) => m[k].length >= 2).map((k) => ({ key: k, words: m[k] }))
  }

  genScaffold(): Bar[] {
    const d = DIFFS[this.state.diff]
    const bars = this.state.bars
    const OPN = this.getOpeners()
    let groups = this.groupsFor(d.min, d.max)
    if (groups.length < 2) groups = this.groupsFor(1, 9)
    groups = sh(groups)
    const sc: Bar[] = []
    for (let p = 0; p < bars / 2; p++) {
      const g = groups[p % groups.length]
      const ws = sh(g.words)
      const color = p % 2 === 0 ? ORANGE : BLUE
      for (let k = 0; k < 2; k++) {
        const opener = (d.openers === 2 || (d.openers === 1 && k === 0))
          ? OPN[Math.floor(Math.random() * OPN.length)] : null
        sc.push({ word: ws[k % ws.length].w, color, opener })
      }
    }
    return sc
  }

  ensureAudio() {
    if (this.ctx) return
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    this.ctx = new AC()
    this.master = this.ctx.createGain()
    this.master.gain.value = 0.9
    this.master.connect(this.ctx.destination)
    const len = this.ctx.sampleRate
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
    const data = this.noiseBuf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  }
  kick(t: number) {
    const c = this.ctx!, o = c.createOscillator(), g = c.createGain()
    o.type = 'sine'; o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.11)
    g.gain.setValueAtTime(0.95, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3)
    o.connect(g); g.connect(this.master!); o.start(t); o.stop(t + 0.32)
  }
  snare(t: number) {
    const c = this.ctx!, s = c.createBufferSource(); s.buffer = this.noiseBuf!
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.8
    const g = c.createGain(); g.gain.setValueAtTime(0.6, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18)
    s.connect(bp); bp.connect(g); g.connect(this.master!); s.start(t); s.stop(t + 0.2)
    const o = c.createOscillator(), og = c.createGain(); o.type = 'triangle'; o.frequency.value = 190
    og.gain.setValueAtTime(0.25, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.08)
    o.connect(og); og.connect(this.master!); o.start(t); o.stop(t + 0.1)
  }
  hat(t: number, v: number) {
    const c = this.ctx!, s = c.createBufferSource(); s.buffer = this.noiseBuf!
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7500
    const g = c.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05)
    s.connect(hp); hp.connect(g); g.connect(this.master!); s.start(t); s.stop(t + 0.06)
  }
  click(t: number, v: number) {
    const c = this.ctx!, o = c.createOscillator(), g = c.createGain(); o.type = 'square'; o.frequency.value = 1400
    g.gain.setValueAtTime(v * 0.3, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.06)
    o.connect(g); g.connect(this.master!); o.start(t); o.stop(t + 0.07)
  }

  startRound(scaffold: Bar[]) {
    this.ensureAudio()
    const beat = BEATS[this.state.beatIdx]
    this.patIdx = this.state.beatIdx
    this.spb = 60 / beat.bpm
    this.totalBeats = 4 + scaffold.length * 4
    this.setState({ screen: 'play', scaffold, activeBeat: -1, running: true })
    this.ctx!.resume().then(() => {
      this.roundStart = this.ctx!.currentTime + 0.3
      this.step = 0
      this.nextTime = this.roundStart
      this.schedTimer = setInterval(() => this.scheduler(), 25)
      this.raf = requestAnimationFrame(() => this.tick())
    })
  }
  scheduler() {
    const total16 = this.totalBeats * 4
    const swing = 0.54
    while (this.nextTime < this.ctx!.currentTime + 0.12 && this.step < total16) {
      let t = this.nextTime
      const s = this.step
      if (s % 4 === 2) t += (swing - 0.5) * this.spb
      if (s < 16) {
        if (s % 4 === 0) this.click(t, s === 0 ? 1 : 0.7)
      } else {
        const ps = (s - 16) % 16
        const pat = BEATS[this.patIdx].pat
        if (pat.kick.indexOf(ps) >= 0) this.kick(t)
        if (pat.snare.indexOf(ps) >= 0) this.snare(t)
        if (pat.hat.indexOf(ps) >= 0) this.hat(t, ps % 8 === 0 ? 0.3 : 0.16)
      }
      this.step++
      this.nextTime += this.spb / 4
    }
  }
  slotPos(g: number) {
    const w = this.gridEl ? this.gridEl.clientWidth : 320
    const GAP = 10, cw = (w - 3 * GAP) / 4
    g = Math.max(0, Math.min(g, this.totalBeats - 1))
    const b = g < 4 ? g : (g - 4) % 4
    const y = g < 4 ? -6 : 36 + Math.floor((g - 4) / 4) * 82
    return { x: b * (cw + GAP) + cw / 2, y }
  }
  tick() {
    if (!this.state.running) return
    let gb = (this.ctx!.currentTime - this.roundStart) / this.spb
    if (gb >= this.totalBeats) { this.finishRound(); return }
    if (gb < 0) gb = 0
    const fl = Math.floor(gb), f = gb - fl
    if (this.ballEl) {
      const p1 = this.slotPos(fl), p2 = this.slotPos(fl + 1)
      const x = p1.x + (p2.x - p1.x) * f
      const y = p1.y + (p2.y - p1.y) * f - 30 * 4 * f * (1 - f)
      this.ballEl.style.transform = 'translate(' + (x - 8) + 'px,' + (y - 8) + 'px)'
    }
    if (this.scrollEl && fl >= 4) {
      const rowY = 46 + Math.floor((fl - 4) / 4) * 82
      const target = Math.max(0, Math.min(rowY - this.scrollEl.clientHeight * 0.42, this.scrollEl.scrollHeight - this.scrollEl.clientHeight))
      this.scrollEl.scrollTop += (target - this.scrollEl.scrollTop) * 0.12
    }
    if (fl !== this.state.activeBeat) this.setState({ activeBeat: fl })
    this.raf = requestAnimationFrame(() => this.tick())
  }
  stopClock() {
    if (this.schedTimer) clearInterval(this.schedTimer)
    if (this.raf) cancelAnimationFrame(this.raf)
    this.schedTimer = null
  }
  finishRound() { this.stopClock(); this.setState({ running: false, screen: 'done', activeBeat: -1 }) }

  render() {
    const st = this.state
    const beat = BEATS[st.beatIdx]
    const d = DIFFS[st.diff]
    const reducedMotion = st.prefersRM
    const ab = st.activeBeat
    const activeBar = ab >= 4 ? Math.floor((ab - 4) / 4) : -1
    const beatIn = ab >= 4 ? (ab - 4) % 4 : -1

    const card = { background: '#1E1740', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '16px 18px' } as const
    const label = { fontSize: 11, fontWeight: 700, letterSpacing: 1.4, color: 'rgba(244,238,225,0.5)', marginBottom: 10 } as const
    const stepBtn = { width: 34, height: 34, borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.06)', color: '#F4EEE1', fontSize: 16, cursor: 'pointer' } as const

    const cellBase = { display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 10, border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.04)', overflow: 'hidden', transition: 'background .12s, border-color .12s, opacity .3s' } as const

    const wrap = { minHeight: 'calc(100vh - 45px)', background: '#14102A', color: '#F4EEE1', fontFamily: "'Archivo', system-ui, sans-serif" } as const

    // dictionary compute
    const q = st.dictQuery.trim().toLowerCase()
    const found = q ? this.getWords().find((w) => w[0] === q) : null
    let dictResults: { word: string; hm: boolean; sylLabel: string; qual: string; perfect: boolean }[] = []
    if (found) {
      const key = found[2]
      const nearKeys = NEAR[key] || []
      const mk = (arr: WordTuple[], qual: string) => arr.map(([w, syl, , hm]) => ({ word: w, hm: !!hm, sylLabel: syl + ' syl', qual, perfect: qual === 'Perfect' }))
      const perfect = this.getWords().filter((w) => w[2] === key && w[0] !== q).sort((a, b) => (b[3] - a[3]) || (b[1] - a[1]))
      const near = this.getWords().filter((w) => nearKeys.indexOf(w[2]) >= 0).sort((a, b) => (b[3] - a[3]) || (b[1] - a[1]))
      dictResults = mk(perfect, 'Perfect').concat(mk(near, 'Near Rhyme'))
    }

    return (
      <div style={wrap}>
        {/* header (hidden while playing) */}
        {st.screen !== 'play' && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '18px 20px 10px', maxWidth: 720, margin: '0 auto', width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontWeight: 900, fontSize: 17, letterSpacing: 1.5 }}>THE RHYME GAME</span>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.2, padding: '4px 8px', borderRadius: 999, background: 'rgba(240,138,46,0.18)', color: '#FFC787', border: '1px solid rgba(240,138,46,0.45)' }}>ARTIST EDITION</span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['setup', 'opener', 'dict'] as const).map((s) => {
                const on = st.screen === s
                const tabLabel = s === 'setup' ? 'Setup' : s === 'opener' ? 'Opener Mode' : 'Rhyme Dictionary'
                return (
                  <button key={s} onClick={() => { this.stopClock(); this.setState({ screen: s, running: false }) }}
                    style={{ padding: '8px 14px', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', border: on ? '1px solid #F08A2E' : '1px solid rgba(255,255,255,0.15)', background: on ? 'rgba(240,138,46,0.15)' : 'transparent', color: on ? '#FFC787' : 'rgba(244,238,225,0.6)' }}>
                    {tabLabel}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* SETUP */}
        {st.screen === 'setup' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '8px 20px 32px', maxWidth: 720, margin: '0 auto', width: '100%' }}>
            <div style={card}>
              <div style={label}>WORD LIST</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderRadius: 999, background: 'rgba(240,138,46,0.16)', border: '1.5px solid #F08A2E', fontWeight: 700, fontSize: 14 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#F08A2E' }} /> Harry Mack
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', padding: '9px 14px', borderRadius: 999, border: '1.5px dashed rgba(255,255,255,0.2)', color: 'rgba(244,238,225,0.4)', fontSize: 13 }}>+ More artists soon</span>
              </div>
              <div style={{ fontSize: 12, color: 'rgba(244,238,225,0.45)', marginTop: 10 }}>
                {st.wl ? 'Target words, rhyme pairs & bar openers from his extracted corpus.' : 'Backend corpus offline — playing on the built-in sample words.'}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={card}>
                <div style={label}>DIFFICULTY</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <button onClick={() => this.setState({ diff: Math.max(0, st.diff - 1) })} style={stepBtn}>‹</button>
                  <span style={{ fontWeight: 800, fontSize: 15 }}>{d.name}</span>
                  <button onClick={() => this.setState({ diff: Math.min(DIFFS.length - 1, st.diff + 1) })} style={stepBtn}>›</button>
                </div>
                <div style={{ fontSize: 11, color: 'rgba(244,238,225,0.45)', marginTop: 10, minHeight: 28 }}>{d.desc}</div>
              </div>
              <div style={card}>
                <div style={label}>BARS</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <button onClick={() => this.setState({ bars: Math.max(4, st.bars - 4) })} style={stepBtn}>‹</button>
                  <span style={{ fontWeight: 800, fontSize: 15 }}>{st.bars} bars</span>
                  <button onClick={() => this.setState({ bars: Math.min(16, st.bars + 4) })} style={stepBtn}>›</button>
                </div>
                <div style={{ fontSize: 11, color: 'rgba(244,238,225,0.45)', marginTop: 10, minHeight: 28 }}>Plus a 4-beat count-in before bar 1.</div>
              </div>
            </div>

            <div style={card}>
              <div style={label}>BEAT</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {BEATS.map((b, i) => {
                  const sel = i === st.beatIdx
                  return (
                    <button key={b.name} onClick={() => this.setState({ beatIdx: i })}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '12px 14px', borderRadius: 12, cursor: 'pointer', color: '#F4EEE1', fontFamily: 'inherit', border: sel ? '1.5px solid #F08A2E' : '1px solid rgba(255,255,255,0.12)', background: sel ? 'rgba(240,138,46,0.10)' : 'rgba(255,255,255,0.03)' }}>
                      <span style={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0, background: sel ? '#F08A2E' : 'transparent', border: sel ? 'none' : '1.5px solid rgba(255,255,255,0.3)' }} />
                      <span style={{ fontWeight: 700, fontSize: 14 }}>{b.name}</span>
                      <span style={{ marginLeft: 'auto', fontSize: 12, color: 'rgba(244,238,225,0.5)' }}>{b.bpm + ' BPM · ' + b.genre}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            <button onClick={() => this.startRound(this.genScaffold())} style={{ marginTop: 6, padding: 18, borderRadius: 14, border: 'none', background: '#F08A2E', color: '#1A0F00', fontWeight: 900, fontSize: 20, letterSpacing: 3, cursor: 'pointer' }}>PLAY</button>
            <div style={{ textAlign: 'center', fontSize: 12, color: 'rgba(244,238,225,0.45)' }}>Rap out loud. Land the colored word on beat 4 of each bar.</div>
          </div>
        )}

        {/* OPENER MODE — present an opener, player inputs rhymes, validate + score (spec §7b) */}
        {st.screen === 'opener' && <OpenerMode />}

        {/* PLAY */}
        {st.screen === 'play' && (
          <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 45px)', maxWidth: 640, margin: '0 auto', width: '100%', padding: '14px 16px 10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontWeight: 800, fontSize: 15 }}>{beat.name}</span>
                <span style={{ fontSize: 12, color: 'rgba(244,238,225,0.5)' }}>{beat.bpm + ' BPM · ' + beat.genre}</span>
              </div>
              <button onClick={() => { this.stopClock(); this.setState({ running: false, screen: 'setup', activeBeat: -1 }) }} style={{ padding: '8px 14px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.22)', background: 'rgba(255,255,255,0.06)', color: '#F4EEE1', fontWeight: 700, fontSize: 12, letterSpacing: 1, cursor: 'pointer' }}>END</button>
            </div>

            <div ref={(el) => { this.scrollEl = el }} style={{ flex: 1, overflowY: 'auto', marginTop: 14, borderRadius: 12 }}>
              <div ref={(el) => { this.gridEl = el }} style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 60 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, height: 36 }}>
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, fontSize: 12, fontWeight: 800, letterSpacing: 1, border: '1px dashed rgba(255,255,255,' + (ab === i ? '0.7' : '0.15') + ')', background: ab === i ? 'rgba(255,255,255,0.14)' : 'transparent', color: ab === i ? '#F4EEE1' : 'rgba(244,238,225,0.35)', transition: 'all .1s' }}>{i + 1}</div>
                  ))}
                </div>
                {st.scaffold.map((bar, i) => {
                  const passed = activeBar > i
                  return (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, height: 72 }}>
                      {[0, 1, 2, 3].map((b) => {
                        const isTarget = b === 3
                        const isActive = i === activeBar && b === beatIn
                        const style: React.CSSProperties = { ...cellBase }
                        let text = ''
                        let textStyle: React.CSSProperties = { fontWeight: 800, fontSize: 18, letterSpacing: 0.3, padding: '0 6px', textAlign: 'center' }
                        if (isTarget) {
                          style.background = rgba(bar.color, isActive ? 0.38 : 0.15)
                          style.border = '1px solid ' + rgba(bar.color, isActive ? 1 : 0.5)
                          text = bar.word
                          textStyle.color = bar.color === ORANGE ? '#FFD9AE' : '#D2E4FF'
                          if (i === activeBar && beatIn >= 2 && !isActive) style.animation = 'tpulse 0.6s ease-in-out infinite'
                          if (isActive) style.boxShadow = '0 0 16px ' + rgba(bar.color, 0.55)
                        } else {
                          if (b === 0 && bar.opener) {
                            text = bar.opener
                            textStyle = { fontSize: 11, fontStyle: 'italic', color: 'rgba(244,238,225,0.6)', padding: '0 8px', textAlign: 'center' }
                          }
                          if (isActive) { style.background = 'rgba(255,255,255,0.15)'; style.border = '1px solid rgba(255,255,255,0.5)' }
                        }
                        if (passed) style.opacity = 0.4
                        return <div key={b} style={style}><span style={textStyle}>{text}</span></div>
                      })}
                    </div>
                  )
                })}
                {st.running && !reducedMotion && (
                  <div ref={(el) => { this.ballEl = el }} style={{ position: 'absolute', left: 0, top: 0, width: 16, height: 16, borderRadius: '50%', background: '#F4EEE1', boxShadow: '0 2px 12px rgba(244,238,225,0.6)', pointerEvents: 'none', willChange: 'transform' }} />
                )}
              </div>
            </div>
            <div style={{ textAlign: 'center', fontSize: 12, color: 'rgba(244,238,225,0.45)', padding: '10px 0 4px' }}>
              {reducedMotion ? 'Follow the lit rectangle — one step per beat. Land the colored word on beat 4.' : 'Fill each bar out loud — land the colored word on beat 4.'}
            </div>
          </div>
        )}

        {/* DONE */}
        {st.screen === 'done' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '60px 20px', maxWidth: 480, margin: '0 auto', width: '100%' }}>
            <div style={{ fontSize: 52, fontWeight: 900, letterSpacing: 1, textAlign: 'center' }}>Good job!</div>
            <div style={{ fontSize: 14, color: 'rgba(244,238,225,0.55)', marginBottom: 20 }}>{st.scaffold.length + ' bars · ' + beat.bpm + ' BPM · Harry Mack word list'}</div>
            <button onClick={() => this.startRound(this.genScaffold())} style={{ width: '100%', padding: 16, borderRadius: 14, border: 'none', background: '#F08A2E', color: '#1A0F00', fontWeight: 900, fontSize: 16, letterSpacing: 1, cursor: 'pointer' }}>Replay · new words</button>
            <button onClick={() => this.startRound(st.scaffold)} style={{ width: '100%', padding: 16, borderRadius: 14, border: '1.5px solid rgba(255,255,255,0.25)', background: 'rgba(255,255,255,0.06)', color: '#F4EEE1', fontWeight: 800, fontSize: 16, cursor: 'pointer' }}>Replay · same words</button>
            <button onClick={() => this.setState({ screen: 'setup' })} style={{ width: '100%', padding: 14, borderRadius: 14, border: 'none', background: 'transparent', color: 'rgba(244,238,225,0.55)', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>Back to setup</button>
          </div>
        )}

        {/* DICTIONARY */}
        {st.screen === 'dict' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '8px 20px 32px', maxWidth: 720, margin: '0 auto', width: '100%' }}>
            <input value={st.dictQuery} onChange={(e) => this.setState({ dictQuery: e.target.value })} placeholder="Type a word to rhyme…"
              style={{ padding: '15px 18px', borderRadius: 14, border: '1px solid rgba(255,255,255,0.15)', background: '#1E1740', color: '#F4EEE1', fontSize: 16, fontFamily: "'Archivo', system-ui, sans-serif", outline: 'none' }} />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {['fire', 'mind', 'create', 'flow', 'real', 'love'].map((w) => (
                <button key={w} onClick={() => this.setState({ dictQuery: w })} style={{ padding: '7px 13px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.05)', color: 'rgba(244,238,225,0.75)', fontSize: 13, cursor: 'pointer' }}>{w}</button>
              ))}
            </div>
            {dictResults.length > 0 && (
              <>
                <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1.2, color: 'rgba(244,238,225,0.5)' }}>RHYMES FOR “{q}”</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {dictResults.map((r, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderRadius: 12, background: '#1E1740', border: '1px solid rgba(255,255,255,0.07)' }}>
                      <span style={{ fontWeight: 700, fontSize: 15 }}>{r.word}</span>
                      {r.hm && <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.8, padding: '3px 7px', borderRadius: 6, background: 'rgba(240,138,46,0.18)', color: '#FFC787', border: '1px solid rgba(240,138,46,0.4)' }}>HM</span>}
                      <span style={{ marginLeft: 'auto', fontSize: 11, color: 'rgba(244,238,225,0.45)' }}>{r.sylLabel}</span>
                      <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.6, padding: '3px 8px', borderRadius: 6, background: r.perfect ? 'rgba(90,200,140,0.15)' : 'rgba(255,255,255,0.08)', color: r.perfect ? '#8FE0B4' : 'rgba(244,238,225,0.55)', border: '1px solid ' + (r.perfect ? 'rgba(90,200,140,0.4)' : 'rgba(255,255,255,0.15)') }}>{r.qual}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
            {q.length > 0 && dictResults.length === 0 && (
              <div style={{ padding: 20, borderRadius: 12, background: '#1E1740', border: '1px dashed rgba(255,255,255,0.15)', color: 'rgba(244,238,225,0.5)', fontSize: 14, textAlign: 'center' }}>Not in the corpus yet — try one of the suggestions above.</div>
            )}
          </div>
        )}
      </div>
    )
  }
}
