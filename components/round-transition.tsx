'use client';
import {useLayoutEffect,useRef,useState} from 'react';
import {Sparkles} from 'lucide-react';
import type {SessionView} from '@/lib/game/types';

interface Cue {key:string;kicker:string;title:string;subtitle:string;}
const INTRO_DURATION_MS=3200;
const MAX_LIVE_ARRIVAL_MS=1500;

/** A stage transition is a live cue, not a replayable part of saved game state.
 * Stale refreshes and reconnections should go straight to the current puzzle. */
export function isFreshRoundCue(s:SessionView,foregroundAt=0,clientNow=Date.now()){
  if(s.roundBeganAt===undefined)return false;
  const age=s.serverNow-s.roundBeganAt;
  if(age<0||age>MAX_LIVE_ARRIVAL_MS)return false;
  // Translate the locally recorded foreground instant to the server clock.
  const foregroundServerTime=foregroundAt+s.serverNow-clientNow;
  return foregroundAt===0||s.roundBeganAt>=foregroundServerTime-80;
}
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
  const foregroundAt=useRef(0);
  const [active,setActive]=useState<Cue|undefined>();
  useLayoutEffect(()=>{
    // When a phone returns to the app, old round transitions are discarded.
    // A future round that begins while the phone is visible still animates.
    const onVisibility=()=>{
      setActive(undefined);
      if(document.visibilityState==='visible')foregroundAt.current=Date.now();
    };
    const onFocus=()=>{
      setActive(undefined);
      if(document.visibilityState==='visible')foregroundAt.current=Date.now();
    };
    document.addEventListener('visibilitychange',onVisibility);
    window.addEventListener('pageshow',onFocus);
    window.addEventListener('focus',onFocus);
    return()=>{
      document.removeEventListener('visibilitychange',onVisibility);
      window.removeEventListener('pageshow',onFocus);
      window.removeEventListener('focus',onFocus);
    };
  },[]);
  useLayoutEffect(()=>{
    const id=next?.key??s.phase;
    if(prior.current===undefined){prior.current=id;return;}
    if(prior.current===id)return;
    prior.current=id;
    if(!next||document.visibilityState!=='visible'||
      !isFreshRoundCue(s,foregroundAt.current)){
      setActive(undefined);return;
    }
    setActive(next);
    const timer=setTimeout(()=>setActive(current=>current?.key===next.key?undefined:current),INTRO_DURATION_MS);
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
