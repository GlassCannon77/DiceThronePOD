// Records whatever audio is plugged into it and builds an MP3 file.
// Podcast apps (Spotify included) want MP3, so we encode while recording.

const loadedContexts = new WeakSet();

export class Mp3Recorder {
  constructor(ctx, { kbps = 64, onChunk } = {}) {
    this.ctx = ctx;
    this.kbps = kbps;
    this.onChunk = onChunk;
    this.chunks = [];
    this.samples = 0;
    this.bytes = 0;
  }

  get durationSeconds() {
    return this.samples / this.ctx.sampleRate;
  }

  async start(input) {
    const { ctx } = this;
    if (!loadedContexts.has(ctx)) {
      await ctx.audioWorklet.addModule('/js/recorder-worklet.js');
      loadedContexts.add(ctx);
    }
    this.worker = new Worker('/js/mp3-worker.js');
    this.node = new AudioWorkletNode(ctx, 'pcm-tap', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    });
    // The worklet only runs when connected to the speakers, so connect it through
    // a volume of zero. You won't hear yourself.
    this.mute = ctx.createGain();
    this.mute.gain.value = 0;
    this.node.connect(this.mute).connect(ctx.destination);
    this.input = input;
    input.connect(this.node);

    this.done = new Promise((resolve, reject) => {
      this.resolveDone = resolve;
      this.rejectDone = reject;
    });

    this.worker.onmessage = (event) => {
      const msg = event.data;
      if (msg.type === 'chunk') {
        const bytes = new Uint8Array(msg.data);
        this.chunks.push(bytes);
        this.bytes += bytes.length;
        this.samples = msg.samples;
        this.onChunk?.(bytes, msg.samples);
      } else if (msg.type === 'done') {
        this.samples = msg.samples;
        this.resolveDone();
      } else if (msg.type === 'error') {
        this.rejectDone(new Error(`MP3 encoder error: ${msg.message}`));
      }
    };
    this.worker.onerror = (event) => {
      this.rejectDone(new Error(`The MP3 encoder failed to load (${event.message || 'unknown error'}).`));
    };

    this.node.port.onmessage = (event) => {
      const msg = event.data;
      if (msg.type === 'pcm') {
        this.worker.postMessage({ type: 'pcm', samples: msg.samples }, [msg.samples.buffer]);
      } else if (msg.type === 'flushed') {
        this.worker.postMessage({ type: 'flush' });
      }
    };

    this.worker.postMessage({ type: 'init', sampleRate: ctx.sampleRate, kbps: this.kbps });
  }

  // Finishes the MP3 and hands back the file.
  async stop() {
    this.input.disconnect(this.node);
    this.node.port.postMessage('flush');
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('The MP3 encoder took too long to finish.')), 30000),
    );
    try {
      await Promise.race([this.done, timeout]);
    } finally {
      this.node.disconnect();
      this.mute.disconnect();
      this.worker.terminate();
    }
    return {
      blob: new Blob(this.chunks, { type: 'audio/mpeg' }),
      durationSeconds: this.durationSeconds,
    };
  }
}
