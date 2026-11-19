'use client';
import {Zap} from 'lucide-react';

/** One responsive, keyboard-operable game-show buzzer for Toss-Ups and Final Spin. */
export default function GameBuzzer({ready,onBuzz,context='tossup'}:{
  ready:boolean;onBuzz:()=>void;context?:'tossup'|'speedup';
}){
  return <button type="button" className={'buzzer game-show-buzzer '+(ready?'ready':'waiting')+
    ' buzzer-'+context} disabled={!ready} onClick={onBuzz}
    aria-label={ready?'Buzz in to answer':'Buzzer unavailable'}
    title={ready?'Tap or press Space to buzz in':'Buzzer unavailable'}>
    <span className="game-show-buzzer-inner" aria-hidden="true">
      <span className="game-show-buzzer-live">{ready?'ON AIR':'STANDBY'}</span>
      <Zap className="game-show-buzzer-bolt" size={51} strokeWidth={3.2} fill="currentColor"/>
      <strong>{ready?'BUZZ!':'WAIT'}</strong>
      <span className="game-show-buzzer-foot">{ready?'CLAIM YOUR ANSWER':'NOT YOUR TURN'}</span>
    </span>
  </button>;
}
