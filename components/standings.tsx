'use client';
import {useLayoutEffect,useRef} from 'react';
import {Trophy,TrendingUp,Gift} from 'lucide-react';
import {money} from '@/lib/client';
import AnimatedMoney from './animated-money';
import {total} from '@/lib/game/engine';
import type {SessionView} from '@/lib/game/types';
export default function Standings({s,compact=false}:{s:SessionView;compact?:boolean}){
  const sorted=[...s.players].sort((a,b)=>total(b)-total(a)||a.seat-b.seat);
  const element=useRef(new Map<string,HTMLDivElement>());
  const prior=useRef(new Map<string,number>());
  const animation=useRef<Animation[]>([]);
  const signature=JSON.stringify(sorted.map(p=>[p.id,total(p),p.roundMoney]));
  useLayoutEffect(()=>{
    animation.current.forEach(a=>a.cancel());animation.current=[];
    const next=new Map<string,number>();
    const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    for(const p of sorted){
      const el=element.current.get(p.id);if(!el)continue;
      const top=el.offsetTop;next.set(p.id,top);
      const previous=prior.current.get(p.id);
      if(previous!==undefined&&previous!==top&&!reduced){
        animation.current.push(el.animate([{transform:'translateY('+(previous-top)+'px)'},{transform:'translateY(0)'}],
          {duration:700,easing:'cubic-bezier(.19,1,.22,1)'}));
      }
    }
    prior.current=next;
    return()=>animation.current.forEach(a=>a.cancel());
  },[signature]);
  return <section className={'standings '+(compact?'compact':'')}>
    <div className="section-heading"><h2><Trophy size={18}/> {s.phase==='finished'?'Final Standings':'Live Standings'}</h2>
      <span className="badge">{sorted.length} PLAYERS</span></div>
    <div className="standings-rows">
      {sorted.map((p,i)=>{
        const roundEvents=s.events.filter(e=>e.playerId===p.id&&e.round===s.roundIndex);
        const last=roundEvents.at(-1);
        return <div key={p.id} className={'standing-row '+(i===0?'leader':'')}
          ref={el=>{if(el)element.current.set(p.id,el);else element.current.delete(p.id);}}>
          <span className="standing-rank">{i===0?<Trophy size={20}/>:String(i+1).padStart(2,'0')}</span>
          <span className={'avatar seat-'+p.seat}>{p.name.slice(0,1).toUpperCase()}</span>
          <div className="standing-person"><strong>{p.name}</strong>
            <small>{p.roundMoney>0?money(p.roundMoney)+' this round':p.prizes.length?
              p.prizes.length+' prize'+(p.prizes.length>1?'s':''):'Contestant '+(p.seat+1)}</small></div>
          <div className="standing-money"><strong><AnimatedMoney value={total(p)}/></strong>
            {last&&['roundResult','bonusResult','finished'].includes(s.phase)&&
              <small className={last.delta>0?'positive':'muted'}>{last.delta>0?'+':''}{money(last.delta)}</small>}</div>
        </div>;
      })}
    </div>
    {!compact&&<p className="standings-note"><TrendingUp size={14}/> Rankings include banked winnings and secured prizes.</p>}
  </section>;
}
