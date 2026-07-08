let audioCtx: AudioContext | null = null

function getAudioCtx(): AudioContext {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
  }
  return audioCtx
}

let soundEnabled = true

export function isSoundEnabled(): boolean {
  return soundEnabled
}

export function setSoundEnabled(enabled: boolean): void {
  soundEnabled = enabled
}

export function loadSoundPreference(): boolean {
  try {
    const stored = localStorage.getItem('punti-sound-enabled')
    if (stored !== null) {
      soundEnabled = stored === 'true'
    }
  } catch { /* localStorage non disponibile */ }
  return soundEnabled
}

export function saveSoundPreference(enabled: boolean): void {
  try {
    localStorage.setItem('punti-sound-enabled', String(enabled))
  } catch { /* localStorage non disponibile */ }
}

export function playEarnSound(): void {
  if (!soundEnabled) return
  try {
    const ctx = getAudioCtx()
    const now = ctx.currentTime
    ;[523.25, 659.25].forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.15, now + i * 0.1)
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.25)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now + i * 0.1)
      osc.stop(now + i * 0.1 + 0.25)
    })
  } catch { /* AudioContext non disponibile */ }
}

export function playRedeemSound(): void {
  if (!soundEnabled) return
  try {
    const ctx = getAudioCtx()
    const now = ctx.currentTime
    ;[880, 660].forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      const t = now + i * 0.11
      gain.gain.setValueAtTime(0.16, t)
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(t)
      osc.stop(t + 0.18)
    })
  } catch { /* AudioContext non disponibile */ }
}
