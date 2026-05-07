import { Composition } from 'remotion';
import {
  DreamAd,
  DREAM_AD_FPS,
  DREAM_AD_DURATION_FRAMES,
  DREAM_AD_WIDTH,
  DREAM_AD_HEIGHT,
} from './DreamAd';
import {
  VoicesCompare,
  VC_FPS,
  VC_WIDTH,
  VC_HEIGHT,
  VC_SEGMENT_FRAMES,
  VC_DEFAULT_VOICE_COUNT,
  VC_DEFAULT_VOICES,
} from './VoicesCompare';
import {
  CaptionsCompare,
  CC_FPS,
  CC_WIDTH,
  CC_HEIGHT,
  CC_DURATION_FRAMES,
} from './CaptionsCompare';
import {
  EndCard,
  EC_FPS,
  EC_WIDTH,
  EC_HEIGHT,
  EC_DURATION_FRAMES,
} from './EndCard';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="DreamAd"
        component={DreamAd}
        durationInFrames={DREAM_AD_DURATION_FRAMES}
        fps={DREAM_AD_FPS}
        width={DREAM_AD_WIDTH}
        height={DREAM_AD_HEIGHT}
        defaultProps={{ audioUrl: undefined, words: [] }}
      />
      <Composition
        id="VoicesCompare"
        component={VoicesCompare}
        durationInFrames={VC_SEGMENT_FRAMES * VC_DEFAULT_VOICE_COUNT}
        fps={VC_FPS}
        width={VC_WIDTH}
        height={VC_HEIGHT}
        defaultProps={{ audioUrl: undefined, voices: VC_DEFAULT_VOICES }}
      />
      <Composition
        id="CaptionsCompare"
        component={CaptionsCompare}
        durationInFrames={CC_DURATION_FRAMES}
        fps={CC_FPS}
        width={CC_WIDTH}
        height={CC_HEIGHT}
        defaultProps={{ audioUrl: undefined }}
      />
      <Composition
        id="EndCard"
        component={EndCard}
        durationInFrames={EC_DURATION_FRAMES}
        fps={EC_FPS}
        width={EC_WIDTH}
        height={EC_HEIGHT}
        defaultProps={{ cta: 'Try Dream Free', subtitle: 'Decode every dream', brand: 'Dream' }}
      />
    </>
  );
};
