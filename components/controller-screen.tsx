import type { ReactNode } from 'react';
import { Camera, Gauge, Gamepad2, Maximize2, Smartphone } from 'lucide-react';

import { Button } from '@/components/ui/button';

type ControllerScreenProps = {
  connected: boolean;
  tilt: number;
  motionReady: boolean;
  calibrated: boolean;
  guideOpen: boolean;
  pairing: ReactNode;
  onFullscreen: () => void;
  onPedal: (pedal: 'throttle' | 'brake', value: number) => void;
  onHonk: () => void;
  onStart: () => void;
  onPair: () => void;
  onGuideComplete: () => void;
};

/** スマホ用のハンドル、ペダル、接続案内を表示する。 */
export function ControllerScreen({
  connected,
  tilt,
  motionReady,
  calibrated,
  guideOpen,
  pairing,
  onFullscreen,
  onPedal,
  onHonk,
  onStart,
  onPair,
  onGuideComplete,
}: ControllerScreenProps) {
  return (
    <main className="controller-screen">
      <div className="controller-top">
        <div>
          <span className="eyebrow">POCKET DRIVER</span>
          <h1>MOTION DRIVE</h1>
        </div>
        <div className="controller-actions">
          <span className={`status-pill ${connected ? 'online' : ''}`}>
            <i />
            {connected ? '接続中' : '未接続'}
          </span>
          <button
            className="controller-fullscreen"
            type="button"
            onClick={onFullscreen}
            aria-label="全画面表示"
          >
            <Maximize2 />
          </button>
        </div>
      </div>
      <div className="controller-body">
        <Pedal className="brake" onChange={(value) => onPedal('brake', value)}>
          <span>BRAKE</span>
          <small>ブレーキ</small>
        </Pedal>
        <div className="tilt-zone">
          <div
            className="wheel"
            style={{ transform: `rotate(${-tilt * 80}deg)` }}
          >
            <span className="wheel-spoke spoke-left" />
            <span className="wheel-spoke spoke-right" />
            <span className="wheel-spoke spoke-bottom" />
            <button
              className="horn-button"
              type="button"
              onPointerDown={onHonk}
              aria-label="クラクション"
            >
              HORN
            </button>
          </div>
          <p>
            {!motionReady
              ? 'まっすぐ構えてSTARTを押す'
              : calibrated
                ? 'スマホごとハンドルのように回す'
                : '中央位置を検出しています…'}
          </p>
        </div>
        <Pedal className="gas" onChange={(value) => onPedal('throttle', value)}>
          <span>GO!</span>
          <small>アクセル</small>
        </Pedal>
      </div>
      {connected && !guideOpen ? (
        <Button className="start-controller" onClick={onStart}>
          START
        </Button>
      ) : !connected ? (
        <Button className="pair-controller" variant="outline" onClick={onPair}>
          <Camera /> カメラを開く
        </Button>
      ) : null}
      {connected && guideOpen && (
        <section className="prestart-guide" aria-label="スマホの構え方">
          <span className="eyebrow">HOW TO HOLD</span>
          <h2>スマホの構え方</h2>
          <div className="hold-steps">
            <GuideStep icon={<Smartphone />} title="横向きにする">
              画面を自分へ向けます
            </GuideStep>
            <GuideStep icon={<Gamepad2 />} title="胸の前で持つ">
              両手で水平に構えます
            </GuideStep>
            <GuideStep icon={<Gauge />} title="まっすぐ構える">
              STARTで中央が決まります
            </GuideStep>
          </div>
          <Button className="guide-ready" onClick={onGuideComplete}>
            準備できた
          </Button>
        </section>
      )}
      <div className="portrait-notice">
        <div className={`portrait-icon ${connected ? 'connected' : ''}`}>
          {connected ? <Smartphone /> : <Camera />}
        </div>
        <b>{connected ? '接続完了' : 'QRコードでPCと接続'}</b>
        <span>
          {connected
            ? 'スマホを横向きにして運転を始めてください'
            : '縦向きのまま、PC画面のQRコードを読み取ってください'}
        </span>
        {!connected && (
          <Button className="portrait-pair-button" onClick={onPair}>
            <Camera /> カメラを開く
          </Button>
        )}
      </div>
      {pairing}
    </main>
  );
}

/** 押している間だけ有効になるアクセルまたはブレーキを表示する。 */
function Pedal({
  className,
  onChange,
  children,
}: {
  className: string;
  onChange: (value: number) => void;
  children: ReactNode;
}) {
  return (
    <button
      className={`pedal ${className}`}
      onPointerDown={() => onChange(1)}
      onPointerUp={() => onChange(0)}
      onPointerCancel={() => onChange(0)}
      onPointerLeave={() => onChange(0)}
    >
      {children}
    </button>
  );
}

/** スマホの構え方を1項目表示する。 */
function GuideStep({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div>
      <i
        className={`hold-pictogram ${title === '横向きにする' ? 'landscape-phone' : ''}`}
      >
        {icon}
      </i>
      <b>{title}</b>
      <small>{children}</small>
    </div>
  );
}
