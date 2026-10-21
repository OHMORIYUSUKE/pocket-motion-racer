import type { ReactNode, RefObject } from 'react';
import { Gauge, Gamepad2, Maximize2, Volume2, VolumeX } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { TRACK_MAP_PATH, trackPoint } from '@/lib/game/track';

export type RacePhase = 'waiting' | 'countdown' | 'racing' | 'finished';

type RaceScreenProps = {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  connected: boolean;
  sound: boolean;
  speed: number;
  progress: number;
  lap: number;
  racePhase: RacePhase;
  countdown: string;
  elapsed: number;
  lapTimes: number[];
  pairing: ReactNode;
  onSoundChange: (enabled: boolean) => void;
};

/** ミリ秒をレース表示用の「分:秒.百分秒」へ変換する。 */
const formatTime = (milliseconds: number) => {
  const minutes = Math.floor(milliseconds / 60000),
    seconds = Math.floor((milliseconds % 60000) / 1000),
    hundredths = Math.floor((milliseconds % 1000) / 10);
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
};

/** PC用の3Dキャンバス、レース演出、HUDを表示する。 */
export function RaceScreen({
  canvasRef,
  connected,
  sound,
  speed,
  progress,
  lap,
  racePhase,
  countdown,
  elapsed,
  lapTimes,
  pairing,
  onSoundChange,
}: RaceScreenProps) {
  const mapPoint = trackPoint(progress * Math.PI * 2),
    markerX = 60 + mapPoint.x * 0.5,
    markerY = 60 - mapPoint.z * 0.47,
    completedTime = lapTimes.reduce((total, time) => total + time, 0),
    currentLapTime = Math.max(0, elapsed - completedTime);

  return (
    <main className="game-shell">
      <canvas
        ref={canvasRef}
        className="game-canvas"
        aria-label="ドライブゲーム画面"
      />
      {racePhase === 'waiting' && (
        <div className="race-message waiting-message">
          <small>READY?</small>
          <b>スマホのSTARTを押してください</b>
          <span>押した向きがハンドルの中央になります</span>
        </div>
      )}
      {racePhase === 'countdown' && (
        <div
          key={countdown}
          className={`countdown-display ${countdown === 'GO!' ? 'go' : ''}`}
        >
          {countdown}
        </div>
      )}
      {racePhase === 'finished' && (
        <div className="goal-overlay">
          <small>3 LAPS COMPLETE</small>
          <h2>GOAL!</h2>
          <b>{formatTime(elapsed)}</b>
          <div>
            {lapTimes.slice(0, 3).map((time, index) => (
              <span key={index}>
                LAP {index + 1} <strong>{formatTime(time)}</strong>
              </span>
            ))}
          </div>
          <p>スマホのSTARTで再スタート</p>
        </div>
      )}
      <header className="game-header">
        <div className="brand-mark">
          <span>R</span>
          <div>
            <b>ROLY-POLY</b>
            <small>POCKET RACING</small>
          </div>
        </div>
        <div className="header-actions">
          <span className={`status-pill ${connected ? 'online' : ''}`}>
            <i />
            {connected ? 'スマホ接続中' : 'スマホ未接続'}
          </span>
          <Button
            className="icon-btn"
            variant="outline"
            size="icon-lg"
            onClick={() => onSoundChange(!sound)}
            aria-label="サウンド切替"
          >
            {sound ? <Volume2 /> : <VolumeX />}
          </Button>
          <Button
            className="icon-btn"
            variant="outline"
            size="icon-lg"
            onClick={() => document.documentElement.requestFullscreen?.()}
            aria-label="全画面"
          >
            <Maximize2 />
          </Button>
        </div>
      </header>
      <div className="lap-card">
        <span>LAP</span>
        <b>
          {lap} <em>/ 3</em>
        </b>
      </div>
      <div className="time-card">
        <span>
          LAP TIME{' '}
          <b>{formatTime(racePhase === 'finished' ? 0 : currentLapTime)}</b>
        </span>
        <span>
          TOTAL <b>{formatTime(elapsed)}</b>
        </span>
        {lapTimes.length > 0 && (
          <small>LAST {formatTime(lapTimes.at(-1)!)}</small>
        )}
      </div>
      <div className="speedometer">
        <Gauge />
        <div>
          <b>{String(speed).padStart(3, '0')}</b>
          <span>KM/H</span>
        </div>
      </div>
      <div className="minimap">
        <svg viewBox="0 0 120 120" aria-label="コースマップ">
          <path className="map-course" d={TRACK_MAP_PATH} />
          <line className="start-line" x1="53" y1="21" x2="67" y2="21" />
          <circle className="map-marker" cx={markerX} cy={markerY} r="6" />
        </svg>
        <span>YOU</span>
      </div>
      <div className="mobile-hint">
        <Gamepad2 />
        <span>PCの大きな画面で遊んでね</span>
      </div>
      {pairing}
    </main>
  );
}
