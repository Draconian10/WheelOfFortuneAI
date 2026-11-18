import type { RoundKind, Wedge } from './types';

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
export function wheelForRound(kind: RoundKind): Wedge[] {
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
    for(const i of [5,19]) wheel[i]={...wheel[i],kind:'mystery',label:'MYSTERY',value:1000};
    wheel[16]={...wheel[16],kind:'million',label:'MILLION',value:500};
  }
  if(kind === 'prize'){
    wheel[6]={...wheel[6],kind:'express',label:'EXPRESS',value:1000};
    wheel[16]={...wheel[16],kind:'wild',label:'WILD CARD',value:500};
  }
  return wheel;
}
export function secureIndex(count: number) {
  const bound = Math.floor(0x100000000/count)*count;
  const array = new Uint32Array(1);
  do { crypto.getRandomValues(array); } while(array[0]>=bound);
  return array[0]%count;
}
