'use client';
import {useEffect,useRef,useState} from 'react';
import {money} from '@/lib/client';

/** Accessible numeric score tween; reduced-motion viewers see the final value immediately. */
export default function AnimatedMoney({value}:{value:number}){
  const [visible,setVisible]=useState(value);
  const latest=useRef(value);
  useEffect(()=>{
    const startValue=latest.current;
    if(startValue===value)return;
    if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){
      latest.current=value;setVisible(value);return;
    }
    let id=0;
    const started=performance.now();
    const duration=650;
    const draw=(at:number)=>{
      const t=Math.min(1,(at-started)/duration);
      const ease=1-Math.pow(1-t,3);
      const next=Math.round(startValue+(value-startValue)*ease);
      latest.current=next;setVisible(next);
      if(t<1)id=requestAnimationFrame(draw);
      else{latest.current=value;setVisible(value);}
    };
    id=requestAnimationFrame(draw);
    return()=>cancelAnimationFrame(id);
  },[value]);
  return <span className="broadcast-score-number" aria-label={money(value)} aria-live="off">{money(visible)}</span>;
}
