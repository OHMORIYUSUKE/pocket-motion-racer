'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Camera, Check, Copy, X } from 'lucide-react';
import QRCode from 'qrcode';
import jsQR from 'jsqr';

import { Button } from '@/components/ui/button';
import type { PeerRole } from '@/lib/game/webrtc';

/** PCとスマホのQRコード接続手順を表示する。 */
export function Pairing({
  open,
  onClose,
  closable,
  role,
  error,
  code,
  remoteCode,
  setRemoteCode,
  createOffer,
  acceptOffer,
  acceptAnswer,
}: {
  open: boolean;
  onClose: () => void;
  closable: boolean;
  role: PeerRole;
  error: string;
  code: string;
  remoteCode: string;
  setRemoteCode: (s: string) => void;
  createOffer: () => void;
  acceptOffer: (code?: string) => void;
  acceptAnswer: (code?: string) => void;
}) {
  if (!open) return null;
  const host = role === 'host';
  const controllerUrl =
    typeof location !== 'undefined'
      ? `${location.origin}${location.pathname}?controller=1`
      : '';
  return (
    <div className="modal-backdrop">
      <dialog
        className="pair-modal"
        open
        aria-modal="true"
        aria-label="スマホ接続"
      >
        {closable && (
          <button className="modal-close" onClick={onClose} aria-label="閉じる">
            <X />
          </button>
        )}
        <span className="eyebrow">QR PAIRING</span>
        <h2>{host ? 'スマホをつなぐ' : 'PCにつなぐ'}</h2>
        <p className="pair-lead">
          同じWi-Fiにつないで、画面の案内どおりにQRコードを読み取ってください。
        </p>
        {error && (
          <div className="pair-error" role="alert">
            <b>接続できませんでした</b>
            <span>{error}</span>
          </div>
        )}
        {host ? (
          <HostPairingWizard
            controllerUrl={controllerUrl}
            code={code}
            createOffer={createOffer}
            acceptAnswer={acceptAnswer}
          />
        ) : (
          <>
            <ol>
              <li>
                <b>1</b> PC画面で「② 接続QRを表示」を押してください
              </li>
              <li>
                <b>2</b> 下の「② 接続QRを読み取る」を押して、PCのQRを読み取ってください
              </li>
              <li>
                <b>3</b> 表示された「③ 返答QR」をPCのカメラに見せてください
              </li>
            </ol>
            {!code ? (
              <QrScanner label="② 接続QRを読み取る" onScan={acceptOffer} />
            ) : (
              <QrDisplay
                value={code}
                label="③ 返答QRをPCのカメラに見せてください"
              />
            )}
          </>
        )}
        <details className="manual-pair">
          <summary>カメラが使えない場合</summary>
          <textarea
            value={remoteCode}
            onChange={(e) => setRemoteCode(e.target.value)}
            placeholder="接続コードを貼り付け"
          />
          <Button
            className="wide"
            disabled={!remoteCode}
            onClick={() => (host ? acceptAnswer() : acceptOffer())}
          >
            {host ? '接続を完了' : '返答コードを作る'}
          </Button>
          {code && <CodeBox code={code} />}
        </details>
        <p className="pair-note">
          ①はスマホの標準カメラで、②と③は画面内のカメラで読み取ってください。
        </p>
      </dialog>
    </div>
  );
}

/** PC側の接続手順を1画面1操作のウィザードとして表示する。 */
function HostPairingWizard({
  controllerUrl,
  code,
  createOffer,
  acceptAnswer,
}: {
  controllerUrl: string;
  code: string;
  createOffer: () => void;
  acceptAnswer: (code?: string) => void;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const steps = [
    {
      title: 'スマホでページを開く',
      text: 'QRコードをスマホの標準カメラで読み取ってください。',
    },
    {
      title: '接続QRを読み取る',
      text: 'スマホ画面の「カメラを開く」を押して、このQRコードを読み取ってください。',
    },
    {
      title: '返答QRを読み取る',
      text: 'PCのカメラで、スマホに表示された返答QRを読み取ってください。',
    },
  ] as const;
  const current = steps[step - 1];

  /** 接続情報を新しく作成し、2番目の手順へ進む。 */
  const prepareOffer = () => {
    setStep(2);
    createOffer();
  };

  return (
    <section className="pair-wizard" aria-label={`接続手順 ${step}/3`}>
      <div className="pair-stepper" aria-hidden="true">
        {steps.map((_, index) => {
          const number = (index + 1) as 1 | 2 | 3,
            complete = number < step,
            active = number === step;
          return (
            <div
              key={number}
              className={`${complete ? 'complete' : ''} ${active ? 'active' : ''}`}
            >
              <i>{complete ? <Check /> : number}</i>
              {index < steps.length - 1 && <span />}
            </div>
          );
        })}
      </div>
      <div className="pair-step-heading">
        <small>STEP {step} / 3</small>
        <h3>{current.title}</h3>
        <p>{current.text}</p>
      </div>

      {step === 1 && (
        <>
          <QrDisplay
            value={controllerUrl}
            label="スマホで読み取ってください"
            url
          />
          <Button className="wide pair-next" onClick={prepareOffer}>
            スマホで開きました <ArrowRight />
          </Button>
        </>
      )}
      {step === 2 && (
        <>
          {code ? (
            <QrDisplay
              value={code}
              label="スマホ画面のカメラで読み取ってください"
            />
          ) : (
            <div className="pair-working">接続QRを準備しています…</div>
          )}
          <div className="pair-wizard-actions">
            <Button variant="outline" onClick={() => setStep(1)}>
              <ArrowLeft /> 戻る
            </Button>
            <Button
              className="pair-next"
              disabled={!code}
              onClick={() => setStep(3)}
            >
              読み取りました <ArrowRight />
            </Button>
          </div>
        </>
      )}
      {step === 3 && (
        <>
          <QrScanner label="スマホの返答QRを読み取る" onScan={acceptAnswer} />
          <Button
            className="pair-back"
            variant="outline"
            onClick={() => setStep(2)}
          >
            <ArrowLeft /> 前の手順に戻る
          </Button>
        </>
      )}
    </section>
  );
}

/** カメラが使えない場合の接続コードとコピーボタンを表示する。 */
function CodeBox({ code }: { code: string }) {
  return (
    <div className="code-box">
      <span>{code}</span>
      <button
        onClick={() => navigator.clipboard.writeText(code)}
        aria-label="コピー"
      >
        <Copy />
      </button>
    </div>
  );
}

/** 文字列をQRコードへ変換してCanvasに描画する。 */
function QrDisplay({
  value,
  label,
  url = false,
}: {
  value: string;
  label: string;
  url?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvas.current)
      void QRCode.toCanvas(canvas.current, value, {
        width: url ? 420 : 480,
        margin: url ? 5 : 3,
        errorCorrectionLevel: url ? 'H' : 'L',
        color: { dark: '#000000', light: '#ffffff' },
      }).catch(() => undefined);
  }, [value, url]);
  return (
    <div className={`qr-display ${url ? 'url-qr' : ''}`}>
      <span>{label}</span>
      <canvas ref={canvas} />
      {url && <small>{value}</small>}
    </div>
  );
}

/** カメラ映像を解析し、最初に検出したQRコードを呼び出し元へ返す。 */
function QrScanner({
  label,
  onScan,
}: {
  label: string;
  onScan: (value: string) => void;
}) {
  const video = useRef<HTMLVideoElement>(null),
    scanCanvas = useRef<HTMLCanvasElement | null>(null),
    frame = useRef(0),
    stream = useRef<MediaStream | null>(null),
    onScanRef = useRef(onScan);
  const [active, setActive] = useState(false),
    [error, setError] = useState('');
  /** カメラとQR解析ループを安全に停止する。 */
  const stop = useCallback(() => {
    cancelAnimationFrame(frame.current);
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    setActive(false);
  }, []);
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);
  useEffect(() => stop, [stop]);
  // カメラ映像をフレームごとにCanvasへ写し、QRコードを探索する。
  useEffect(() => {
    if (!active || !video.current || !stream.current) return;
    let cancelled = false;
    const currentVideo = video.current;
    currentVideo.srcObject = stream.current;
    // 映像フレームを解析し、QRを検出した時点でカメラを終了する。
    const scan = () => {
      if (cancelled) return;
      const v = video.current;
      if (!v || !v.videoWidth) {
        frame.current = requestAnimationFrame(scan);
        return;
      }
      const c =
        scanCanvas.current ||
        (scanCanvas.current = document.createElement('canvas'));
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx?.drawImage(v, 0, 0);
      const image = ctx?.getImageData(0, 0, c.width, c.height);
      const result =
        image &&
        jsQR(image.data, image.width, image.height, {
          inversionAttempts: 'attemptBoth',
        });
      if (result?.data) {
        stop();
        onScanRef.current(result.data);
        return;
      }
      frame.current = requestAnimationFrame(scan);
    };
    void currentVideo
      .play()
      .then(scan)
      .catch(() => {
        setError('カメラ映像を開始できませんでした');
        stop();
      });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame.current);
    };
  }, [active, stop]);
  /** 背面カメラの利用を開始し、QR読み取り状態へ切り替える。 */
  const start = async () => {
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      setError('');
      setActive(true);
    } catch {
      setError('カメラを開けませんでした');
      setActive(false);
    }
  };
  return (
    <div className={`qr-scanner ${active ? 'active' : ''}`}>
      {active ? (
        <>
          <video ref={video} muted playsInline />
          <div className="scan-frame" />
          <button onClick={stop}>
            <X />
            中止
          </button>
        </>
      ) : (
        <Button className="scan-button" onClick={start}>
          <Camera />
          {label}
        </Button>
      )}
      {error && <small>{error}</small>}
    </div>
  );
}
