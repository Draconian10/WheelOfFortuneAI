'use client';
import {CircleHelp} from 'lucide-react';
import type {WedgeKind} from '@/lib/game/types';

const guidance:Partial<Record<WedgeKind,{title:string;description:string}>>={
  free:{title:'FREE PLAY',description:'Call a consonant, take a free vowel, or attempt to solve. An incorrect attempt does not cost your turn.'},
  wild:{title:'WILD CARD',description:'Call a correct consonant to collect it. Keep it for an extra consonant opportunity during play or in the Bonus Round. BANKRUPT forfeits it.'},
  mystery:{title:'MYSTERY WEDGE',description:'After a correct consonant, keep $1,000 per match or risk your round money for a $10,000 prize or BANKRUPT.'},
  million:{title:'MILLION DOLLAR WEDGE',description:'Call a correct consonant, then solve this puzzle to secure eligibility for a $1 million Bonus Round envelope. BANKRUPT forfeits it.'},
  bankrupt:{title:'BANKRUPT',description:'Your current-round cash, unbanked prizes, Wild Card and Million Dollar eligibility are lost. Previously banked winnings stay safe.'}
};
export default function WedgeHelp({kind}:{kind:WedgeKind}){
  const info=guidance[kind];if(!info)return null;
  return <aside className={'wedge-help wedge-help-'+kind} aria-label={info.title+' rules'}>
    <span className="wedge-help-icon"><CircleHelp size={21} aria-hidden="true"/></span>
    <div><strong>{info.title}</strong><p>{info.description}</p></div>
  </aside>;
}
