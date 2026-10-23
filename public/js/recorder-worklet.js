// Runs on the browser's audio thread. It collects raw sound samples and
// hands them to the main page in batches, which passes them to the MP3 encoder.
class PcmTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 4096;
    this.buf = new Float32Array(this.size);
    this.count = 0;
    this.port.onmessage = (event) => {
      if (event.data === 'flush') {
        this.emit();
        this.port.postMessage({ type: 'flushed' });
      }
    };
  }

  emit() {
    if (!this.count) return;
    const samples = this.buf.slice(0, this.count);
    this.port.postMessage({ type: 'pcm', samples }, [samples.buffer]);
    this.count = 0;
  }

  push(block) {
    let offset = 0;
    while (offset < block.length) {
      const n = Math.min(block.length - offset, this.size - this.count);
      this.buf.set(block.subarray(offset, offset + n), this.count);
      this.count += n;
      offset += n;
      if (this.count === this.size) this.emit();
    }
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    // If nothing is plugged in for a moment, record silence so timing stays right.
    this.push(channel || new Float32Array(128));
    return true;
  }
}

registerProcessor('pcm-tap', PcmTap);
