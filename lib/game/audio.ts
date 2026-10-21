export type DriveAudio = {
  engine: OscillatorNode;
  engineGain: GainNode;
  brake: OscillatorNode;
  brakeGain: GainNode;
};

/** 対応ブラウザでWeb Audioのコンテキストを生成する。 */
export function createAudioContext() {
  const AudioContextClass =
    window.AudioContext ||
    (
      window as typeof window & {
        webkitAudioContext?: typeof AudioContext;
      }
    ).webkitAudioContext;
  return AudioContextClass ? new AudioContextClass() : null;
}
