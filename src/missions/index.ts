import type { MissionDefinition, ModuleId } from '../app/contracts';
import { SIGNAL_HOLD_MS } from '../app/contracts';
import './missions.css';
import { AccessMission } from './AccessMission';
import { GravityMission } from './GravityMission';
import { MemoryMission } from './MemoryMission';
import { PowerMission } from './PowerMission';
import { SignalMission } from './SignalMission';
import { GRAVITY_SPEC } from './gravity';
import { POWER_PAIRS } from './power';
import { SIGNAL_TOLERANCE } from './signal';

const holdS = (SIGNAL_HOLD_MS / 1000).toFixed(0);

export const MISSIONS: Record<ModuleId, MissionDefinition> = {
  POWER: {
    id: 'POWER',
    nameKo: '배전반 복구',
    nameEn: 'POWER',
    instrument: '배전반 단자대',
    briefing: {
      1: `같은 색 단자 ${POWER_PAIRS[1]}쌍을 손가락이나 마우스로 선을 그어 연결합니다.`,
      2: `같은 색 단자 ${POWER_PAIRS[2]}쌍을 손가락이나 마우스로 선을 그어 연결합니다.`,
      3: `같은 색 단자 ${POWER_PAIRS[3]}쌍을 손가락이나 마우스로 선을 그어 연결합니다.`,
    },
    Component: PowerMission,
  },
  SIGNAL: {
    id: 'SIGNAL',
    nameKo: '신호 동기화',
    nameEn: 'SIGNAL',
    instrument: '오실로스코프 · 다이얼',
    briefing: {
      1: `주파수를 맞춰 수신 파형을 기준 파형에 일치시키고 ${holdS}초 유지합니다 (±${SIGNAL_TOLERANCE[1].freq} Hz).`,
      2: `주파수와 진폭을 맞추고 ${holdS}초 유지합니다 (±${SIGNAL_TOLERANCE[2].freq} Hz, ±${SIGNAL_TOLERANCE[2].amp} V).`,
      3: `주파수·진폭·위상을 맞추고 ${holdS}초 유지합니다 (±${SIGNAL_TOLERANCE[3].freq} Hz, ±${SIGNAL_TOLERANCE[3].amp} V, ±${SIGNAL_TOLERANCE[3].phase}°).`,
    },
    Component: SignalMission,
  },
  MEMORY: {
    id: 'MEMORY',
    nameKo: '기억 회로 진단',
    nameEn: 'MEMORY',
    instrument: '메모리 진단 격자',
    briefing: {
      1: '3×3 격자에서 차례로 켜지는 3개 셀을 같은 순서로 입력합니다.',
      2: '4×4 격자에서 차례로 켜지는 5개 셀을 같은 순서로 입력합니다.',
      3: '5×5 격자에서 차례로 켜지는 7개 셀을 같은 순서로 입력합니다.',
    },
    Component: MemoryMission,
  },
  GRAVITY: {
    id: 'GRAVITY',
    nameKo: '중력 기준 보정',
    nameEn: 'GRAVITY',
    instrument: '항공 자세계',
    briefing: {
      1: `넓은 범위(±${GRAVITY_SPEC[1].tolerance}°)에서 목표 자세를 ${GRAVITY_SPEC[1].holdMs / 1000}초 유지합니다. 기기를 살짝 기울이거나 터치로 조작.`,
      2: `좁은 범위(±${GRAVITY_SPEC[2].tolerance}°)에서 목표 자세를 ${GRAVITY_SPEC[2].holdMs / 1000}초 유지합니다. 기기를 살짝 기울이거나 터치로 조작.`,
      3: `목표 3곳을 차례로 보정합니다(±${GRAVITY_SPEC[3].tolerance}°, 각 ${GRAVITY_SPEC[3].holdMs / 1000}초). 기기를 살짝 기울이거나 터치로 조작.`,
    },
    Component: GravityMission,
  },
  ACCESS: {
    id: 'ACCESS',
    nameKo: '접근 권한 복구',
    nameEn: 'ACCESS',
    instrument: '물리 키패드',
    briefing: {
      1: '기호 대응표로 4자리 암호를 숫자로 바꿔 입력합니다.',
      2: '6자리 암호를 숫자로 바꾼 뒤 순서 규칙을 적용해 입력합니다.',
      3: '8자리 암호에 숫자 규칙과 순서 규칙을 차례로 적용해 입력합니다.',
    },
    Component: AccessMission,
  },
};

export { generatePower, validatePower } from './power';
export { generateSignal, validateSignal } from './signal';
export { generateMemory, validateMemory } from './memory';
export { generateGravity, validateGravity } from './gravity';
export { generateAccess, validateAccess } from './access';
