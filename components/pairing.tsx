'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Copy, X } from 'lucide-react';
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
          同じWi-Fiにつないで、画面の案内どおりにQRを読み取ります。
        </p>
        {error && (
          <div className="pair-error" role="alert">
            <b>接続できませんでした</b>
            <span>{error}</span>
          </div>
        )}
        {host ? (
          <>
            <ol>
              <li>
                <b>1</b> URLのQRを標準カメラで読み、ページを開く
              </li>
              <li>
                <b>2</b> スマホ画面の「カメラを開く」を押し、PCの「②
                接続QR」を読む
              </li>
              <li>
                <b>3</b> スマホの返答QRをPCで読む
              </li>
            </ol>
            <QrDisplay
              value={controllerUrl}
              label="① スマホ用ページを開くURL"
              url
            />
            {!code || code.startsWith('コード') ? (
              <Button className="wide" onClick={createOffer}>
                ② 接続QRを表示
              </Button>
            ) : (
              <QrDisplay
                value={code}
                label="② スマホ画面内のカメラで読み取る"
              />
            )}
            <QrScanner
              label="③ スマホの返答QRを読み取る"
              onScan={acceptAnswer}
            />
          </>
        ) : (
          <>
            <ol>
              <li>
                <b>1</b> PC画面で「② 接続QRを表示」を押す
              </li>
              <li>
                <b>2</b> 下の「② 接続QRを読み取る」を押し、PCのQRを読む
              </li>
              <li>
                <b>3</b> 表示された「③ 返答QR」をPCのカメラに見せる
              </li>
            </ol>
            {!code ? (
              <QrScanner label="② 接続QRを読み取る" onScan={acceptOffer} />
            ) : (
              <QrDisplay value={code} label="③ 返答QRをPCのカメラに見せる" />
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
          ①だけがURLです。②と返答QRは画面内のカメラで読み取ります。
        </p>
      </dialog>
    </div>
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
