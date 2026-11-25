export class WoodSound {
  private context?: AudioContext;
  private output?: GainNode;
  private friction?: GainNode;
  private buffer?: AudioBuffer;
  private cutoff?: number;
  private source?: AudioBufferSourceNode;

  enable(volume: number) {
    try {
      if (!this.context) {
        const context = new AudioContext();
        this.context = context;
        this.output = context.createGain();
        this.output.connect(context.destination);
        this.buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
        const data = this.buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      }
      this.volume(volume);
      if (this.context.state === 'suspended') void this.context.resume().catch(() => undefined);
    } catch {
      // Audio is optional on browsers without Web Audio.
    }
  }

  volume(volume: number) {
    if (this.output) this.output.gain.value = volume;
    if (!volume) this.stop();
  }

  slide(speed: number) {
    if (!this.context || !this.output || !this.buffer || !this.output.gain.value) return;
    const context = this.context;
    if (!this.source) {
      this.source = context.createBufferSource();
      this.source.buffer = this.buffer;
      this.source.loop = true;
      const filter = context.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 620;
      filter.Q.value = 0.65;
      this.friction = context.createGain();
      this.friction.gain.value = 0;
      this.source.connect(filter).connect(this.friction).connect(this.output);
      this.source.start();
    }
    this.friction?.gain.setTargetAtTime(Math.min(0.13, speed * 0.009), context.currentTime, 0.025);
    window.clearTimeout(this.cutoff);
    this.cutoff = window.setTimeout(() => this.stop(), 115);
  }

  stop() {
    window.clearTimeout(this.cutoff);
    if (this.source && this.context) {
      this.friction?.gain.setTargetAtTime(0, this.context.currentTime, 0.01);
      this.source.stop(this.context.currentTime + 0.045);
      this.source = undefined;
      this.friction = undefined;
    }
  }

  tap() {
    if (!this.context || !this.output || !this.buffer || !this.output.gain.value) return;
    const now = this.context.currentTime;
    const transient = this.context.createBufferSource();
    transient.buffer = this.buffer;
    const filter = this.context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 490;
    filter.Q.value = 1.8;
    const envelope = this.context.createGain();
    envelope.gain.setValueAtTime(0.42, now);
    envelope.gain.exponentialRampToValueAtTime(0.003, now + 0.105);
    transient.connect(filter).connect(envelope).connect(this.output);
    transient.start();
    transient.stop(now + 0.11);
  }
}
