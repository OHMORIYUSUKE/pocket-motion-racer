import type { Controls } from '@/lib/game/track';

export type PeerRole = 'host' | 'controller';

const CONTROLLER_QUERY = 'controller';

/** バイナリをQRコードへ埋め込めるURLセーフBase64へ変換する。 */
const toBase64Url = (bytes: Uint8Array) => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
};

/** URLセーフBase64を元のバイナリへ戻す。 */
const fromBase64Url = (value: string) => {
  const base64 =
      value.replaceAll('-', '+').replaceAll('_', '/') +
      '='.repeat((4 - (value.length % 4)) % 4),
    binary = atob(base64),
    bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

/** WebRTCの接続情報を圧縮し、QRコード用の短い文字列へ変換する。 */
export async function pack(value: RTCSessionDescriptionInit) {
  const kind = value.type === 'offer' ? 'o' : 'a',
    source = new TextEncoder().encode(value.sdp || '');
  if (!('CompressionStream' in window)) return `j${kind}${toBase64Url(source)}`;
  const compressed = await new Response(
    new Blob([source]).stream().pipeThrough(new CompressionStream('deflate')),
  ).arrayBuffer();
  return `z${kind}${toBase64Url(new Uint8Array(compressed))}`;
}

/** QRコードから得た文字列をWebRTCの接続情報へ復元する。 */
export async function unpack(
  value: string,
): Promise<RTCSessionDescriptionInit> {
  const input = value.trim(),
    compressed = input[0] === 'z',
    type = input[1] === 'o' ? 'offer' : 'answer',
    bytes = fromBase64Url(input.slice(2));
  const data = compressed
    ? await new Response(
        new Blob([bytes])
          .stream()
          .pipeThrough(new DecompressionStream('deflate')),
      ).arrayBuffer()
    : bytes.buffer;
  return { type, sdp: new TextDecoder().decode(data) };
}

/** ローカルICE候補の収集完了、またはタイムアウトまで待機する。 */
export function waitIce(pc: RTCPeerConnection) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise<void>((resolve) => {
    const done = () => {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', done);
        resolve();
      }
    };
    pc.addEventListener('icegatheringstatechange', done);
    setTimeout(resolve, 3500);
  });
}

/** 現在のURLがスマホコントローラー用ページか判定する。 */
export function isControllerPage() {
  return (
    typeof location !== 'undefined' &&
    new URLSearchParams(location.search).get(CONTROLLER_QUERY) === '1'
  );
}

/** 変更されないURLのクエリをuseSyncExternalStoreで安全に読むための購読関数。 */
export function subscribeToStaticLocation() {
  return () => undefined;
}

/** 接続済みのDataChannelへ最新の操作状態を送る。 */
export function sendControls(
  channel: RTCDataChannel | null,
  controls: Controls,
) {
  if (channel?.readyState === 'open') channel.send(JSON.stringify(controls));
}
