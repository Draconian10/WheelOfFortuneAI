import {Timer,RotateCcw} from 'lucide-react';
import {money} from '@/lib/client';

export default function FinalSpinAnnouncement({spinning,value}:{spinning:boolean;value?:number}){
  return <section className={'final-spin-announcement '+(spinning?'is-spinning':'is-ready')}
    role="status" aria-live="polite">
    <div className="final-spin-announcement-icon">{spinning?<RotateCcw size={27}/>:<Timer size={27}/>}</div>
    <div className="final-spin-announcement-copy">
      <span className="final-spin-kicker">THE SHOWDOWN</span>
      <strong>FINAL SPIN!</strong>
      <p>{spinning?'One last spin sets the consonant value. Speed-Up begins when the wheel stops.':
        value!==undefined?money(value)+' per matching consonant · Speed-Up is underway':
        'Speed-Up is underway'}</p>
    </div>
  </section>;
}
