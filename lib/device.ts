export type DeviceKind = 'unknown' | 'phone' | 'tablet' | 'desktop';

/** ブラウザの情報からスマホ、タブレット、PCを判定する。 */
export function getDeviceKind(): DeviceKind {
  if (typeof navigator === 'undefined') return 'unknown';

  const userAgentData = (
    navigator as Navigator & { userAgentData?: { mobile?: boolean } }
  ).userAgentData;
  if (userAgentData?.mobile) return 'phone';

  const userAgent = navigator.userAgent;
  if (
    /iPhone|iPod|Windows Phone/i.test(userAgent) ||
    /Android.*Mobile|Mobile.*Android/i.test(userAgent)
  )
    return 'phone';
  if (
    /iPad|Tablet|Android|Kindle|Silk|PlayBook/i.test(userAgent) ||
    (/Macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1)
  )
    return 'tablet';
  return 'desktop';
}

/** 端末情報をuseSyncExternalStoreで安全に読むための購読関数。 */
export function subscribeToStaticDevice() {
  return () => undefined;
}

/** サーバー描画時は端末種別が不明であることを返す。 */
export function getServerDeviceKind(): DeviceKind {
  return 'unknown';
}
