'use client';
import {useState} from 'react';
import {Trophy,Radio,Timer} from 'lucide-react';
import type {SessionView,RoundKind} from '@/lib/game/types';
import {money} from '@/lib/client';
import PuzzleBoard from './puzzle-board';
import Wheel from './wheel';
import Standings from './standings';
import FinalSpinAnnouncement from './final-spin-announcement';

const wheelPhases=new Set([
  'turn','spinning','finalSpinning','letter','wildLetter','mysteryChoice',
  'expressChoice','express','speedup'
]);
function clockText(ms:number){
  const sec=Math.ceil(Math.max(0,ms)/1000);
  return String(Math.floor(sec/60)).padStart(2,'0')+':'+String(sec%60).padStart(2,'0');
}

/** A read-only broadcast layout; puzzle solutions stay restricted by the API projection. */
export default function AudienceStage({s,remaining}:{s:SessionView;remaining:number}){
  const [settledId,setSettledId]=useState('');
  const isWheel=wheelPhases.has(s.phase);
  const isBonus=['bonusSpin','bonusSpinning','bonusCategory','bonusLetters','bonusTimer','bonusResult'].includes(s.phase);
  const isTossup=['tossup','tossupAnswer','tieTossup','tieAnswer'].includes(s.phase);
  const isFinalSpin=s.phase==='finalSpinning'||s.phase==='speedup';
  const pending=!!s.spin?.startedAt&&isWheel&&s.spin.id!==settledId;
  const spinning=s.phase==='finalSpinning'||(s.phase==='speedup'&&pending);
  const kind:RoundKind=['regular','mystery','prize','final'].includes(s.roundKind)
    ?s.roundKind as RoundKind:'regular';
  const nowPlaying=s.players.find(p=>p.id===s.currentPlayerId);
  const respondent=s.players.find(p=>p.id===s.respondent);
  const finalist=s.players.find(p=>p.id===s.bonusPlayerId);
  const bonusSpinning=s.phase==='bonusSpinning';
  const hasWheel=isWheel||(isBonus&&['bonusSpin','bonusSpinning','bonusCategory'].includes(s.phase));
  const label=s.phase==='roundResult'?'PUZZLE COMPLETE':
    s.phase==='bonusResult'?'BONUS FINALE':
    isTossup?'BUZZER ROUND':isFinalSpin?'FINAL SHOWDOWN':
    isBonus?'BONUS ROUND':'NOW PLAYING';
  return <div className="broadcast-stage" data-broadcast-phase={s.phase}>
    <div className="broadcast-masthead">
      <div className="broadcast-live"><Radio size={16}/> LIVE GAME SHOW</div>
      <div className="broadcast-stage-label">
        <span>{label}</span>
        <strong>{s.roundTitle}</strong>
        {s.puzzlesInRound>1&&<small>PUZZLE {s.puzzleIndex+1} / {s.puzzlesInRound}</small>}
      </div>
      {((isTossup||s.phase==='bonusTimer'||s.phase==='speedup'&&s.speedupCanSolve)&&
        <div className={'broadcast-clock '+(remaining<=5000?'urgent':'')}>
          <Timer size={18}/><strong>{clockText(remaining)}</strong></div>)}
    </div>
    {isFinalSpin&&<FinalSpinAnnouncement spinning={spinning}
      value={spinning?undefined:s.speedupValue}/>}
    <div className={'broadcast-main '+(hasWheel?'with-wheel':'board-only')}>
      <div className="broadcast-board" key={s.roundKind+':'+s.roundIndex+':'+s.puzzleIndex}>
        {['bonusSpin','bonusSpinning','bonusCategory'].includes(s.phase)?
          <div className="broadcast-bonus-prompt">
            <span>THE BONUS FINALE</span>
            <strong>{finalist?.name??'Our finalist'}</strong>
            <p>{s.phase==='bonusSpinning'?'Selecting a numbered sealed envelope…':
              s.phase==='bonusSpin'?'Get ready to spin for a sealed prize':
              'Choosing the Bonus Round category'}</p>
          </div>:
          <PuzzleBoard s={s}/>}
        {isTossup&&respondent&&<p className="broadcast-answer-status">{respondent.name} is answering!</p>}
        {isTossup&&!respondent&&<p className="broadcast-answer-status">Buzz in when you know the puzzle!</p>}
        {s.phase==='bonusResult'&&<div className="broadcast-bonus-outcome">
          {s.bonusWon?'BONUS PUZZLE SOLVED!':'BONUS PUZZLE NOT SOLVED'}
          {s.bonusPrize&&<small>Envelope: {s.bonusPrize.label} {s.bonusWon?'· Awarded':'· Not awarded'}</small>}
        </div>}
        {s.phase==='speedup'&&!spinning&&s.speedupValue!==undefined&&
          <p className="broadcast-speedup-value">{money(s.speedupValue)} PER CONSONANT</p>}
      </div>
      {hasWheel&&<div className="broadcast-wheel-area">
        <div className="broadcast-wheel-heading">{bonusSpinning?'BONUS WHEEL SPINNING':spinning?'THE FINAL SPIN':isBonus?'BONUS WHEEL':'SPIN TO WIN'}</div>
        <Wheel kind={isBonus?'regular':kind} bonus={isBonus} mysteryReveals={s.mysteryReveals} spin={s.spin} compact onSpinSettled={setSettledId}/>
        <p>{bonusSpinning?'One numbered envelope determines the prize':
          spinning?'The wheel decides the final cash value':
          isBonus?'The prize envelope stays sealed':
          s.phase==='speedup'?'One letter at a time':
          nowPlaying?nowPlaying.name+' has the wheel':'The wheel is ready'}</p>
      </div>}
    </div>
    <div className="broadcast-bottom">
      <div className="broadcast-scoreboard"><Standings s={s} compact/></div>
      <div className="broadcast-event" role="status" aria-live="polite">
        <span><Trophy size={18}/> LIVE GAME UPDATE</span>
        <strong>{bonusSpinning?'Bonus Wheel in progress — the sealed prize is being selected':
          spinning?'Final Spin in progress — Speed-Up begins when it lands':
          s.lastAction??'Contestants are getting ready'}</strong>
      </div>
    </div>
  </div>;
}
