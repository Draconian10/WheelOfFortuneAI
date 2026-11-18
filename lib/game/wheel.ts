import type { RoundKind, Wedge, MysteryReveal } from './types';

// Twenty-four segments in the same clockwise palette and prize layout as the supplied wheel.
const segments: Wedge[] = [
  {label:'$500',value:500,kind:'cash',color:'#ff690d'},
  {label:'$700',value:700,kind:'cash',color:'#3bbaff'},
  {label:'$300',value:300,kind:'cash',color:'#fff200'},
  {label:'$800',value:800,kind:'cash',color:'#f90008'},
  {label:'$1500',value:1500,kind:'cash',color:'#ab79db'},
  {label:'$1500',value:1500,kind:'cash',color:'#f6999e'},
  {label:'$500',value:500,kind:'cash',color:'#3cb878'},
  {label:'$600',value:600,kind:'cash',color:'#ff690d'},
  {label:'BANKRUPT',value:0,kind:'bankrupt',color:'#060609'},
  {label:'$1000',value:1000,kind:'cash',color:'#d8d8d8'},
  {label:'$500',value:500,kind:'cash',color:'#3cb878'},
  {label:'$600',value:600,kind:'cash',color:'#fff200'},
  {label:'$700',value:700,kind:'cash',color:'#f90008'},
  {label:'$900',value:900,kind:'cash',color:'#3bbaff'},
  {label:'$650',value:650,kind:'cash',color:'#ff690d'},
  {label:'$300',value:300,kind:'cash',color:'#ab79db'},
  {label:'$700',value:700,kind:'cash',color:'#fff200'},
  {label:'$500',value:500,kind:'cash',color:'#f6999e'},
  {label:'$900',value:900,kind:'cash',color:'#f90008'},
  {label:'$500',value:500,kind:'cash',color:'#3bbaff'},
  {label:'$500',value:500,kind:'cash',color:'#3cb878'},
  {label:'$600',value:600,kind:'cash',color:'#f6999e'},
  {label:'BANKRUPT',value:0,kind:'bankrupt',color:'#060609'},
  {label:'$650',value:650,kind:'cash',color:'#ab79db'},
];
export const baseWheel = segments as readonly Wedge[];
export const MYSTERY_INDICES = [5,19] as const;
/** The outcomes are selected privately once; exposed wedges are no longer a mystery. */
export function wheelForRound(kind: RoundKind, revealed: readonly MysteryReveal[]=[]): Wedge[] {
  const wheel = segments.map(x => ({...x}));
  // The reference artwork remains unmodified for the landing page; live wheel rounds
  // substitute a silver wedge with the traditional Lose a Turn outcome.
  if(['regular','mystery','prize','final'].includes(kind))
    wheel[9]={...wheel[9],kind:'lose',label:'LOSE A TURN',value:0};
  if(kind === 'regular'){
    wheel[7] = { ...wheel[7], kind:'free', label:'FREE PLAY',value:500 };
    wheel[16] = { ...wheel[16], kind:'wild', label:'WILD CARD',value:500 };
  }
  if(kind === 'mystery'){
    for(const i of MYSTERY_INDICES) wheel[i]={...wheel[i],kind:'mystery',label:'MYSTERY',value:1000};
    for(const entry of revealed){
      if(!MYSTERY_INDICES.includes(entry.index as typeof MYSTERY_INDICES[number]))continue;
      wheel[entry.index]=entry.outcome==='bankrupt'
        ? {...wheel[entry.index],kind:'bankrupt',label:'BANKRUPT',value:0,color:'#08090b'}
        : {...wheel[entry.index],kind:'cash',label:'$1,000',value:1000,color:'#d7b365'};
    }
    wheel[16]={...wheel[16],kind:'million',label:'MILLION',value:500};
  }
  if(kind === 'prize'){
    wheel[6]={...wheel[6],kind:'express',label:'EXPRESS',value:1000};
    wheel[16]={...wheel[16],kind:'wild',label:'WILD CARD',value:500};
  }
  return wheel;
}
/** A sealed 24-position Bonus Wheel. No prize values are visible before judging. */
export function bonusWheelWedges():Wedge[]{
  const colors=['#7b4fb6','#236ca0','#d8ad5b','#a34f85','#287d78','#a36335'];
  return Array.from({length:24},(_,index)=>({
    label:String(index+1).padStart(2,'0'),kind:'cash' as const,value:0,color:colors[index%colors.length]
  }));
}
/** Every slot corresponds deterministically to one configured envelope.
 * Custom games may supply 1–24 envelope values; the physical wheel stays 24 slots. */
export function bonusEnvelopeForSlot(slot:number,envelopeCount:number){
  if(!Number.isInteger(slot)||slot<0||slot>=24||!Number.isInteger(envelopeCount)||envelopeCount<1||envelopeCount>24)
    throw new Error('Invalid Bonus Wheel slot or envelope count.');
  return slot%envelopeCount;
}
export function secureIndex(count: number) {
  const bound = Math.floor(0x100000000/count)*count;
  const array = new Uint32Array(1);
  do { crypto.getRandomValues(array); } while(array[0]>=bound);
  return array[0]%count;
}
