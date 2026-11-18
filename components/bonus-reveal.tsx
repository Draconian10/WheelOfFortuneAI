'use client';
import {Gift,Trophy} from 'lucide-react';
import {total} from '@/lib/game/engine';
import {money} from '@/lib/client';
import type {Player,Prize} from '@/lib/game/types';

/** Keeps envelope face value separate from the money actually awarded. */
export default function BonusReveal({won,prize,finalist,control,busy,paused,onFinish}:{
  won:boolean;prize?:Prize;finalist?:Player;control:boolean;busy:boolean;paused:boolean;
  onFinish:()=>void;
}){
  const prizeValue=prize?.value??0;
  const finalTotal=finalist?total(finalist):0;
  const mainTotal=finalTotal-(won?prizeValue:0);
  return <section className={'panel bonus-stage bonus-reveal '+(won?'bonus-reveal-won':'bonus-reveal-missed')}>
    <div className="celebration-icon"><Gift size={36} aria-hidden="true"/></div>
    <div className="eyebrow">BONUS ROUND RESULT</div>
    <h2>{won?'BONUS PUZZLE SOLVED!':'BONUS PUZZLE NOT SOLVED'}</h2>
    <p className="bonus-reveal-lead">{won
      ?(finalist?.name??'The finalist')+' solved the final puzzle and earned the envelope prize.'
      :(finalist?.name??'The finalist')+' did not solve the final puzzle in time.'}</p>
    <div className="bonus-envelope-card">
      <span className="bonus-envelope-label">THE BONUS ENVELOPE CONTAINED</span>
      <strong className="bonus-envelope-value">{prize?.label??'Mystery Prize'}</strong>
      <span className={'bonus-award-status '+(won?'is-awarded':'not-awarded')}>
        {won?'PRIZE AWARDED':'NOT AWARDED'}
      </span>
    </div>
    <div className="bonus-result-breakdown" aria-label="Bonus round winnings summary">
      <div><span>Main game winnings</span><strong>{money(mainTotal)}</strong></div>
      <div><span>Bonus awarded</span><strong>{money(won?prizeValue:0)}</strong></div>
      <div className="bonus-result-total"><span>Total secured winnings</span><strong>{money(finalTotal)}</strong></div>
    </div>
    <p className="bonus-reveal-footnote">{won
      ?'The envelope prize has been added to the finalist’s total.'
      :'The envelope is revealed for the audience only; no bonus prize is added. Main-game winnings are kept.'}</p>
    {control&&<button className="button primary bonus-announce-button" disabled={busy||paused}
      onClick={onFinish}><Trophy size={18} aria-hidden="true"/> Announce the Champion</button>}
  </section>;
}
