'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { Controls } from '@/lib/game/track';
import {
  type PeerRole,
  isControllerPage,
  pack,
  unpack,
  waitIce,
} from '@/lib/game/webrtc';

type PeerConnectionOptions = {
  onControls: (controls: Controls) => void;
  onControllerConnected: () => void;
};

/** QR交換によるWebRTC接続とDataChannelの生存管理を行う。 */
export function usePeerConnection({
  onControls,
  onControllerConnected,
}: PeerConnectionOptions) {
  const pcRef = useRef<RTCPeerConnection | null>(null),
    channelRef = useRef<RTCDataChannel | null>(null),
    connectionTimeoutRef = useRef<number | null>(null);
  const [connected, setConnected] = useState(false),
    [pairOpen, setPairOpen] = useState(false),
    [pairRole, setPairRole] = useState<PeerRole>('host'),
    [code, setCode] = useState(''),
    [remoteCode, setRemoteCode] = useState(''),
    [connectionError, setConnectionError] = useState('');

  /** PeerConnectionの失敗を接続案内へ反映する。 */
  const watchPeerConnection = useCallback((pc: RTCPeerConnection) => {
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState !== 'failed') return;
      setConnected(false);
      setConnectionError(
        '接続に失敗しました。同じWi-Fiに接続していることを確認し、QRコードをもう一度読み取ってください。',
      );
      setPairRole(isControllerPage() ? 'controller' : 'host');
      setPairOpen(true);
    });
  }, []);

  /** DataChannelへ接続状態と操作受信のイベントを登録する。 */
  const attachChannel = useCallback(
    (channel: RTCDataChannel) => {
      channelRef.current = channel;
      channel.onopen = () => {
        if (connectionTimeoutRef.current)
          clearTimeout(connectionTimeoutRef.current);
        connectionTimeoutRef.current = null;
        setConnectionError('');
        setConnected(true);
        setPairOpen(false);
        if (isControllerPage()) onControllerConnected();
      };
      channel.onclose = () => {
        setConnected(false);
        if (!isControllerPage()) {
          setPairRole('host');
          setPairOpen(true);
        }
      };
      channel.onerror = () => {
        setConnectionError(
          '通信の開始に失敗しました。両方の画面を再読み込みして、もう一度お試しください。',
        );
        setPairOpen(true);
      };
      channel.onmessage = (event) => {
        try {
          onControls(JSON.parse(event.data) as Controls);
        } catch {}
      };
    },
    [onControllerConnected, onControls],
  );

  /** PC側でOfferを生成し、接続QRの文字列を作成する。 */
  const createOffer = useCallback(async () => {
    try {
      setConnectionError('');
      setCode('');
      pcRef.current?.close();
      const pc = new RTCPeerConnection({ iceServers: [] });
      pcRef.current = pc;
      watchPeerConnection(pc);
      attachChannel(
        pc.createDataChannel('drive', { ordered: false, maxRetransmits: 0 }),
      );
      await pc.setLocalDescription(await pc.createOffer());
      await waitIce(pc);
      setCode(await pack(pc.localDescription!));
    } catch {
      setConnectionError(
        '接続QRを作成できませんでした。ページを再読み込みして、もう一度お試しください。',
      );
    }
  }, [attachChannel, watchPeerConnection]);

  /** スマホ側でOfferを受け取り、返答用Answerを生成する。 */
  const acceptOffer = useCallback(
    async (scannedCode?: string) => {
      try {
        setConnectionError('');
        const incoming = scannedCode || remoteCode;
        setRemoteCode(incoming);
        const pc = new RTCPeerConnection({ iceServers: [] });
        pcRef.current = pc;
        watchPeerConnection(pc);
        pc.ondatachannel = (event) => attachChannel(event.channel);
        await pc.setRemoteDescription(await unpack(incoming));
        await pc.setLocalDescription(await pc.createAnswer());
        await waitIce(pc);
        setCode(await pack(pc.localDescription!));
      } catch {
        setCode('');
        setConnectionError(
          '接続QRを読み取れませんでした。PCに表示された「② 接続QR」をもう一度読み取ってください。',
        );
      }
    },
    [attachChannel, remoteCode, watchPeerConnection],
  );

  /** PC側でAnswerを受け取り、直接通信を確立する。 */
  const acceptAnswer = useCallback(
    async (scannedCode?: string) => {
      try {
        setConnectionError('');
        const incoming = scannedCode || remoteCode;
        setRemoteCode(incoming);
        await pcRef.current?.setRemoteDescription(await unpack(incoming));
        if (connectionTimeoutRef.current)
          clearTimeout(connectionTimeoutRef.current);
        connectionTimeoutRef.current = window.setTimeout(() => {
          if (pcRef.current?.connectionState === 'connected') return;
          setConnectionError(
            '接続がタイムアウトしました。同じWi-Fiを確認し、最初から接続し直してください。',
          );
          setPairOpen(true);
        }, 12000);
      } catch {
        setConnectionError(
          '返答QRを読み取れませんでした。スマホに表示された「③ 返答QR」をもう一度読み取ってください。',
        );
      }
    },
    [remoteCode],
  );

  // 画面破棄時に接続とタイムアウト監視を停止する。
  useEffect(
    () => () => {
      if (connectionTimeoutRef.current)
        clearTimeout(connectionTimeoutRef.current);
      channelRef.current?.close();
      pcRef.current?.close();
    },
    [],
  );

  return {
    channelRef,
    connected,
    pairOpen,
    setPairOpen,
    pairRole,
    setPairRole,
    code,
    remoteCode,
    setRemoteCode,
    connectionError,
    createOffer,
    acceptOffer,
    acceptAnswer,
  };
}
