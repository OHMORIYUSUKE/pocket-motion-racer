'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { ControllerScreen } from '@/components/controller-screen';
import { Pairing } from '@/components/pairing';
import { RaceScreen, type RacePhase } from '@/components/race-screen';
import { useDriveAudio } from '@/hooks/use-drive-audio';
import { usePeerConnection } from '@/hooks/use-peer-connection';
import {
  type CarState,
  type Controls,
  TRACK_LENGTH,
  initialCar,
  updateCarPhysics,
} from '@/lib/game/track';
import {
  type ThreeWorld,
  createThreeWorld,
  disposeThreeWorld,
  renderThree,
} from '@/lib/game/three-world';
import {
  isControllerPage,
  sendControls,
  subscribeToStaticLocation,
} from '@/lib/game/webrtc';

/** 数値を指定範囲内に収める。 */
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

/** PCのゲーム画面とスマホコントローラー画面を統括する。 */
export default function GameSession() {
  const canvasRef = useRef<HTMLCanvasElement>(null),
    worldRef = useRef<ThreeWorld | null>(null),
    controls = useRef<Controls>({
      steer: 0,
      throttle: 0,
      brake: 0,
      horn: 0,
      start: 0,
    }),
    car = useRef<CarState>(initialCar()),
    lastHornRef = useRef(0),
    lastStartRef = useRef(0),
    racePhaseRef = useRef<RacePhase>('waiting'),
    raceStartRef = useRef(0),
    lapStartRef = useRef(0),
    completedLapsRef = useRef(0),
    countdownTimersRef = useRef<number[]>([]),
    currentRoll = useRef(0),
    centerRoll = useRef(0),
    needsCalibration = useRef(true);
  const [speed, setSpeed] = useState(0),
    [progress, setProgress] = useState(0),
    [lap, setLap] = useState(1),
    [sound, setSound] = useState(true),
    [tilt, setTilt] = useState(0),
    [motionReady, setMotionReady] = useState(false),
    [calibrated, setCalibrated] = useState(false),
    [guideOpen, setGuideOpen] = useState(true),
    [racePhase, setRacePhase] = useState<RacePhase>('waiting'),
    [countdown, setCountdown] = useState(''),
    [elapsed, setElapsed] = useState(0),
    [lapTimes, setLapTimes] = useState<number[]>([]);
  const controller = useSyncExternalStore(
    subscribeToStaticLocation,
    isControllerPage,
    () => false,
  );
  const { playHorn, updateDriveAudio } = useDriveAudio(sound, controller);

  // PC画面だけにThree.jsワールドを作成し、終了時に破棄する。
  useEffect(() => {
    if (controller || !canvasRef.current) return;
    const world = createThreeWorld(canvasRef.current);
    worldRef.current = world;
    return () => {
      disposeThreeWorld(world);
      worldRef.current = null;
    };
  }, [controller]);

  /** 車と計測値を初期化し、3・2・1・GOのレース開始処理を行う。 */
  const beginCountdown = useCallback(() => {
    countdownTimersRef.current.forEach(clearTimeout);
    countdownTimersRef.current = [];
    car.current = initialCar();
    completedLapsRef.current = 0;
    racePhaseRef.current = 'countdown';
    setRacePhase('countdown');
    setCountdown('3');
    setElapsed(0);
    setLapTimes([]);
    setLap(1);
    setProgress(0);
    const schedule = (delay: number, action: () => void) => {
      countdownTimersRef.current.push(window.setTimeout(action, delay));
    };
    schedule(1000, () => setCountdown('2'));
    schedule(2000, () => setCountdown('1'));
    schedule(3000, () => setCountdown('GO!'));
    schedule(3800, () => {
      const now = performance.now();
      raceStartRef.current = now;
      lapStartRef.current = now;
      racePhaseRef.current = 'racing';
      setRacePhase('racing');
      setCountdown('');
    });
  }, []);
  // 画面破棄時にカウントダウン用タイマーを停止する。
  useEffect(() => () => countdownTimersRef.current.forEach(clearTimeout), []);
  /** PCが受信した操作値を保存し、単発操作の増分を処理する。 */
  const handleRemoteControls = useCallback(
    (incoming: Controls) => {
      controls.current = incoming;
      if (incoming.horn > lastHornRef.current) playHorn();
      lastHornRef.current = incoming.horn;
      if (incoming.start > lastStartRef.current) beginCountdown();
      lastStartRef.current = incoming.start;
    },
    [beginCountdown, playHorn],
  );

  /** スマホ接続時に毎回、構え方の案内を表示する。 */
  const handleControllerConnected = useCallback(() => setGuideOpen(true), []);

  const {
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
  } = usePeerConnection({
    onControls: handleRemoteControls,
    onControllerConnected: handleControllerConnected,
  });

  // PC側のゲームループで物理、衝突、計時、3D描画、HUDを更新する。
  useEffect(() => {
    let frame = 0,
      last = performance.now(),
      hudTick = 0;
    // requestAnimationFrameごとにゲーム状態を前進させる。
    const loop = (now: number) => {
      const dt = Math.min(0.035, (now - last) / 1000);
      last = now;
      if (!controller && canvasRef.current) {
        const canDrive = racePhaseRef.current === 'racing',
          gas = canDrive ? controls.current.throttle : 0,
          brake = canDrive ? controls.current.brake : 0,
          steer = canDrive ? controls.current.steer : 0,
          s = car.current;
        updateDriveAudio(Number(gas), Number(brake), Math.abs(s.speed));
        updateCarPhysics(
          s,
          { throttle: gas, brake, steer },
          worldRef.current?.colliders ?? [],
          dt,
        );
        if (racePhaseRef.current === 'racing') {
          const completed = Math.floor(Math.max(0, s.z) / TRACK_LENGTH);
          if (completed > completedLapsRef.current) {
            const lapTime = now - lapStartRef.current;
            completedLapsRef.current = completed;
            lapStartRef.current = now;
            setLapTimes((times) => [...times, lapTime]);
            if (completed >= 3) {
              const finalTime = now - raceStartRef.current;
              racePhaseRef.current = 'finished';
              setRacePhase('finished');
              setElapsed(finalTime);
              setLap(3);
              s.speed = 0;
            } else {
              setLap(completed + 1);
            }
          }
        }
        if (worldRef.current)
          renderThree(worldRef.current, s, canvasRef.current);
        if (now - hudTick > 90) {
          setSpeed(Math.max(0, Math.round(s.speed * 6.2)));
          setProgress(
            (((s.z % TRACK_LENGTH) + TRACK_LENGTH) % TRACK_LENGTH) /
              TRACK_LENGTH,
          );
          if (racePhaseRef.current === 'racing')
            setElapsed(now - raceStartRef.current);
          hudTick = now;
        }
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [controller, updateDriveAudio]);

  // スマホの傾きを操舵値へ変換し、操作状態を毎秒約30回PCへ送信する。
  useEffect(() => {
    if (!controller) return;
    // 重力方向から端末のロール角を求め、START時の中央角との差へ変換する。
    const motion = (e: DeviceMotionEvent) => {
      const gravity = e.accelerationIncludingGravity;
      if (!gravity || gravity.x == null || gravity.y == null) return;
      const roll = Math.atan2(gravity.x, gravity.y);
      currentRoll.current = roll;
      if (!motionReady) return;
      if (needsCalibration.current) {
        centerRoll.current = roll;
        needsCalibration.current = false;
        setCalibrated(true);
        setTilt(0);
        controls.current.steer = 0;
        return;
      }
      const delta = Math.atan2(
          Math.sin(roll - centerRoll.current),
          Math.cos(roll - centerRoll.current),
        ),
        value = clamp(delta / (Math.PI / 4), -1, 1);
      setTilt(value);
      controls.current.steer = value;
    };
    addEventListener('devicemotion', motion);
    const timer = setInterval(() => {
      sendControls(channelRef.current, controls.current);
    }, 33);
    return () => {
      removeEventListener('devicemotion', motion);
      clearInterval(timer);
    };
  }, [channelRef, controller, motionReady]);

  /** センサー許可と中央補正を行い、PCへレース開始信号を送る。 */
  const startRace = async () => {
    const alreadyReceivingMotion = motionReady;
    if (!alreadyReceivingMotion) {
      const permission = (
        DeviceMotionEvent as unknown as {
          requestPermission?: () => Promise<string>;
        }
      ).requestPermission;
      if (permission) {
        try {
          if ((await permission()) !== 'granted') return;
        } catch {
          return;
        }
      }
      setMotionReady(true);
    }
    controls.current.steer = 0;
    setTilt(0);
    if (alreadyReceivingMotion) {
      centerRoll.current = currentRoll.current;
      needsCalibration.current = false;
      setCalibrated(true);
    } else {
      needsCalibration.current = true;
      setCalibrated(false);
    }
    controls.current.start += 1;
    sendControls(channelRef.current, controls.current);
  };

  /** アクセルまたはブレーキの押下状態を更新する。 */
  const setPedal = (key: 'throttle' | 'brake', value: number) => {
    controls.current[key] = value;
  };

  /** クラクションの連番を進め、PCへ即時送信する。 */
  const honk = () => {
    controls.current.horn += 1;
    sendControls(channelRef.current, controls.current);
  };

  /** 対応ブラウザでスマホ画面の全画面表示を切り替える。 */
  const toggleFullscreen = async () => {
    const root = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => void;
    };
    if (document.fullscreenElement) {
      await document.exitFullscreen?.();
      return;
    }
    if (root.requestFullscreen) await root.requestFullscreen();
    else root.webkitRequestFullscreen?.();
  };
  const pairing = (
    <Pairing
      open={pairOpen || (!controller && !connected)}
      onClose={() => setPairOpen(false)}
      closable={pairRole === 'controller'}
      role={pairRole}
      error={connectionError}
      code={code}
      remoteCode={remoteCode}
      setRemoteCode={setRemoteCode}
      createOffer={createOffer}
      acceptOffer={acceptOffer}
      acceptAnswer={acceptAnswer}
    />
  );
  if (controller)
    return (
      <ControllerScreen
        connected={connected}
        tilt={tilt}
        motionReady={motionReady}
        calibrated={calibrated}
        guideOpen={guideOpen}
        pairing={pairing}
        onFullscreen={toggleFullscreen}
        onPedal={setPedal}
        onHonk={honk}
        onStart={startRace}
        onPair={() => {
          setPairRole('controller');
          setPairOpen(true);
        }}
        onGuideComplete={() => setGuideOpen(false)}
      />
    );
  return (
    <RaceScreen
      canvasRef={canvasRef}
      connected={connected}
      sound={sound}
      speed={speed}
      progress={progress}
      lap={lap}
      racePhase={racePhase}
      countdown={countdown}
      elapsed={elapsed}
      lapTimes={lapTimes}
      pairing={pairing}
      onSoundChange={setSound}
    />
  );
}
