// 16-bit PCM WAV encode, plus small buffer helpers used by save and export.

export function encodeWav(audioBuffer) {
  const channels = audioBuffer.numberOfChannels;
  const rate = audioBuffer.sampleRate;
  const length = audioBuffer.length;
  const blockAlign = channels * 2;
  const buffer = new ArrayBuffer(44 + length * blockAlign);
  const view = new DataView(buffer);
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + length * blockAlign, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, length * blockAlign, true);

  const data = [];
  for (let channel = 0; channel < channels; channel += 1) {
    data.push(audioBuffer.getChannelData(channel));
  }
  let offset = 44;
  for (let i = 0; i < length; i += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = Math.max(-1, Math.min(1, data[channel][i] || 0));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Uint8Array(buffer);
}

export function peakOf(audioBuffer) {
  let peak = 0;
  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
    const data = audioBuffer.getChannelData(channel);
    for (let i = 0; i < data.length; i += 4) {
      const value = Math.abs(data[i]);
      if (value > peak) peak = value;
    }
  }
  return peak;
}

export function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function matchRate(buffer, rate) {
  if (!buffer || buffer.sampleRate === rate) return buffer;
  const ratio = rate / buffer.sampleRate;
  const length = Math.max(1, Math.floor(buffer.length * ratio));
  const out = new AudioBuffer({
    length,
    numberOfChannels: buffer.numberOfChannels,
    sampleRate: rate
  });
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const source = buffer.getChannelData(channel);
    const dest = out.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      const position = i / ratio;
      const index = Math.floor(position);
      const next = Math.min(source.length - 1, index + 1);
      const frac = position - index;
      const a = source[index] || 0;
      const b = source[next] || 0;
      dest[i] = a * (1 - frac) + b * frac;
    }
  }
  return out;
}

function writeString(view, offset, text) {
  for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
}
