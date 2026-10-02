class SampleProcessor extends AudioWorkletProcessor {
  process(inputs, outputs) {
    for (const channel of outputs[0]) channel.fill(0);
    return true;
  }
}
registerProcessor("megaapp-silence", SampleProcessor);
