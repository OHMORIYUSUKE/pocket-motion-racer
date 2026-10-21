'use client';

import { useCallback, useEffect, useRef } from 'react';

import { type DriveAudio, createAudioContext } from '@/lib/game/audio';

/** クラクションと速度連動のエンジン・ブレーキ音を管理する。 */
export function useDriveAudio(enabled: boolean, controller: boolean) {
  const audioContextRef = useRef<AudioContext | null>(null),
    driveAudioRef = useRef<DriveAudio | null>(null),
    enabledRef = useRef(enabled);

  // 描画ループから最新のサウンド設定を参照できるようにする。
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  /** 2つの周波数を重ねた短いクラクション音を再生する。 */
  const playHorn = useCallback(() => {
    if (!enabledRef.current) return;
    const context = audioContextRef.current || createAudioContext();
    if (!context) return;
    audioContextRef.current = context;
    void context.resume();
    const now = context.currentTime,
      gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.018);
    gain.gain.setValueAtTime(0.18, now + 0.22);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
    gain.connect(context.destination);
    [349, 440].forEach((frequency) => {
      const oscillator = context.createOscillator();
      oscillator.type = 'square';
      oscillator.frequency.value = frequency;
      oscillator.connect(gain);
      oscillator.start(now);
      oscillator.stop(now + 0.35);
    });
  }, []);

  /** アクセル、ブレーキ、速度に合わせて走行音を連続更新する。 */
  const updateDriveAudio = useCallback(
    (throttle: number, braking: number, currentSpeed: number) => {
      const existing = driveAudioRef.current;
      if (!enabledRef.current) {
        if (existing) {
          const now = existing.engine.context.currentTime;
          existing.engineGain.gain.setTargetAtTime(0.0001, now, 0.03);
          existing.brakeGain.gain.setTargetAtTime(0.0001, now, 0.02);
        }
        return;
      }
      if (!existing && throttle <= 0 && braking <= 0) return;
      let audio = existing;
      if (!audio) {
        const context = audioContextRef.current || createAudioContext();
        if (!context) return;
        audioContextRef.current = context;
        const engine = context.createOscillator(),
          engineGain = context.createGain(),
          engineFilter = context.createBiquadFilter(),
          brake = context.createOscillator(),
          brakeGain = context.createGain(),
          brakeFilter = context.createBiquadFilter();
        engine.type = 'sawtooth';
        engineFilter.type = 'lowpass';
        engineFilter.frequency.value = 520;
        engineGain.gain.value = 0.0001;
        engine
          .connect(engineFilter)
          .connect(engineGain)
          .connect(context.destination);
        brake.type = 'sawtooth';
        brake.frequency.value = 1250;
        brakeFilter.type = 'bandpass';
        brakeFilter.frequency.value = 1450;
        brakeFilter.Q.value = 7;
        brakeGain.gain.value = 0.0001;
        brake
          .connect(brakeFilter)
          .connect(brakeGain)
          .connect(context.destination);
        engine.start();
        brake.start();
        audio = { engine, engineGain, brake, brakeGain };
        driveAudioRef.current = audio;
        void context.resume();
      }
      const now = audio.engine.context.currentTime,
        engineLevel = throttle > 0 ? 0.055 + throttle * 0.045 : 0.0001,
        brakeLevel = braking > 0 && currentSpeed > 1 ? braking * 0.085 : 0.0001;
      audio.engine.frequency.setTargetAtTime(
        70 + throttle * 42 + currentSpeed * 4.2,
        now,
        0.06,
      );
      audio.engineGain.gain.setTargetAtTime(engineLevel, now, 0.045);
      audio.brake.frequency.setTargetAtTime(
        1180 + Math.min(currentSpeed, 26) * 15,
        now,
        0.025,
      );
      audio.brakeGain.gain.setTargetAtTime(brakeLevel, now, 0.018);
    },
    [],
  );

  // PC上の最初の操作でAudioContextを有効化する。
  useEffect(() => {
    if (controller) return;
    const unlockAudio = () => {
      const context = audioContextRef.current || createAudioContext();
      if (!context) return;
      audioContextRef.current = context;
      void context.resume();
    };
    addEventListener('pointerdown', unlockAudio);
    return () => removeEventListener('pointerdown', unlockAudio);
  }, [controller]);

  // 画面破棄時にWeb Audioのリソースを解放する。
  useEffect(
    () => () => {
      driveAudioRef.current = null;
      const context = audioContextRef.current;
      audioContextRef.current = null;
      if (context && context.state !== 'closed') void context.close();
    },
    [],
  );

  return { playHorn, updateDriveAudio };
}
