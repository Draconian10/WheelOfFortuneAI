'use client';
import {useLayoutEffect,useRef,useState} from 'react';
import {Sparkles} from 'lucide-react';
import type {SessionView} from '@/lib/game/types';

interface Cue {key:string;kicker:string;title:string;subtitle:string;}
export function cueFor(s:SessionView):Cue|undefined{
  if(['lobby','finished','ended'].includes(s.phase))return;
  if(s.phase==='tieTossup'||s.phase==='tieAnswer')
    return {key:'tie',kicker:'THE SHOWDOWN',title:'SUDDEN DEATH',subtitle:'One final Toss-Up decides the finalist'};
  if(s.phase.startsWith('bonus'))
    return {key:'bonus',kicker:'THE GRAND FINALE',title:'BONUS ROUND',subtitle:'One finalist. One sealed envelope.'};
  const entries:Record<string,[string,string,string]>={
    tossup:['THE OPENING ACT','FORTUNE FRENZY','Get ready to buzz in'],
    regular:['THE GAME BEGINS','ROUND ONE','Time to spin the wheel'],
    mystery:['THE STAKES ARE HIGH','MYSTERY ROUND','Fortune or Bankrupt?'],
    prize:['WIN BIG','PRIZE PUZZLE','A special prize is on the line'],
    triple:['THREE PUZZLES','TRIPLE TOSS-UP','Every second counts'],
    final:['THE FINAL SHOWDOWN','ROUND FOUR','The Final Spin is coming']
  };
  const [kicker,title,subtitle]=entries[s.roundKind]??['UP NEXT',s.roundTitle,'Get ready'];
  return {key:'round:'+s.roundIndex,kicker,title,subtitle};
}
/** Broadcast-only intro; never delays the authoritative game clock or changes puzzle state. */
export default function RoundTransition({s}:{s:SessionView}){
  const next=cueFor(s);
  const prior=useRef<string|undefined>(undefined);
  const [active,setActive]=useState<Cue|undefined>();
  useLayoutEffect(()=>{
    const id=next?.key??s.phase;
    if(prior.current===undefined){prior.current=id;return;}
    if(prior.current===id)return;
    prior.current=id;
    if(!next){setActive(undefined);return;}
    setActive(next);
    const timer=setTimeout(()=>setActive(current=>current?.key===next.key?undefined:current),1700);
    return()=>clearTimeout(timer);
  },[next?.key]);
  if(!active)return null;
  return <div className="round-transition-overlay" aria-live="polite" role="status"
    aria-label={active.title+' — '+active.subtitle}>
    <div className="round-transition-glow" aria-hidden="true"/>
    <div className="round-transition-card">
      <div className="round-transition-kicker"><Sparkles size={22}/> {active.kicker}</div>
      <strong>{active.title}</strong>
      <p>{active.subtitle}</p>
      <div className="round-transition-ornament" aria-hidden="true"><i/><i/><i/></div>
    </div>
  </div>;
}
