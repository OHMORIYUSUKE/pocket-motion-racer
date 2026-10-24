import { Monitor, Smartphone } from 'lucide-react';

type DeviceGateProps = {
  target: 'pc' | 'phone';
};

/** URLに適した端末で開き直すよう案内する。 */
export function DeviceGate({ target }: DeviceGateProps) {
  const pc = target === 'pc';
  return (
    <main className="device-gate">
      <div className="device-gate-card">
        <span className="eyebrow">DEVICE CHECK</span>
        <div className="device-gate-icon">
          {pc ? <Monitor /> : <Smartphone />}
        </div>
        <h1>{pc ? 'PCで開いてください' : 'スマホで開いてください'}</h1>
        <p>
          {pc
            ? 'この画面はPC用のゲーム画面です。PCのブラウザでURLを開いてください。'
            : 'この画面はスマホ用のコントローラーです。スマホでQRコードを読み取って開いてください。'}
        </p>
      </div>
    </main>
  );
}
