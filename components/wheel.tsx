'use client';
import {useEffect,useId,useRef,useState} from 'react';
import type {RoundKind,Spin,Wedge,MysteryReveal} from '@/lib/game/types';
import {wheelForRound,bonusWheelWedges} from '@/lib/game/wheel';

function polar(cx:number,cy:number,r:number,degrees:number){
  const a=(degrees-90)*Math.PI/180;
  return [cx+r*Math.cos(a),cy+r*Math.sin(a)];
}
function sector(index:number){
  const a=index*15-7.5,b=index*15+7.5;
  const first=polar(350,350,341,a),last=polar(350,350,341,b);
  return 'M 350 350 L '+first.join(' ')+' A 341 341 0 0 1 '+last.join(' ')+' Z';
}
function radialLabel(w:Wedge){
  if(w.kind==='bankrupt')return 'BANKRUPT';
  if(w.kind==='lose')return 'LOSE A TURN';
  return w.label;
}
function wedgeLabelSize(label:string){
  if(label.length>9)return 22;
  if(label.length>7)return 26;
  if(label.length>5)return 31;
  if(label.length>4)return 37;
  return 43;
}
export default function Wheel({kind,spin,compact=false,onSpinSettled,bonus=false,mysteryReveals=[]}:{
  kind:RoundKind;spin?:Spin;compact?:boolean;onSpinSettled?:(id:string)=>void;
  bonus?:boolean;mysteryReveals?:MysteryReveal[];
}){
  const wedges=bonus?bonusWheelWedges():wheelForRound(kind,mysteryReveals);
  const uid=useId().replace(/:/g,'');
  const [rotation,setRotation]=useState(0);
  const [spinning,setSpinning]=useState(false);
  const [duration,setDuration]=useState(4200);
  const [settledId,setSettledId]=useState('');
  const seen=useRef('');
  const completed=useRef('');
  const onSpinSettledRef=useRef(onSpinSettled);
  const angleRef=useRef(0);
  useEffect(()=>{onSpinSettledRef.current=onSpinSettled;},[onSpinSettled]);
  const settle=(id:string)=>{
    if(completed.current===id)return;
    completed.current=id;setSpinning(false);setSettledId(id);
    onSpinSettledRef.current?.(id);
  };
  useEffect(()=>{
    if(!spin||spin.id===seen.current)return;
    const desired=(360-spin.index*15)%360;
    const current=((angleRef.current%360)+360)%360;
    const extra=(desired-current+360)%360;
    // A late-joining audience tab or a reconnect must not replay the entire spin.
    // The server picks both the wedge and the start time; every screen lands on it.
    const elapsed=spin.startedAt===undefined?0:Math.max(0,Date.now()-spin.startedAt);
    const left=Math.max(0,4200-elapsed);
    const next=angleRef.current+(left>80?2160:0)+extra;
    const id=spin.id;
    if(left<=80){
      angleRef.current=next;seen.current=id;setSpinning(false);setRotation(next);
      settle(id);
      return;
    }
    const frame=requestAnimationFrame(()=>{
      angleRef.current=next;
      seen.current=id;
      setDuration(left);
      setSpinning(true);
      setRotation(next);
    });
    // Reduced motion/background tabs may not send transitionend.
    const fallback=setTimeout(()=>settle(id),left+120);
    return()=>{cancelAnimationFrame(frame);clearTimeout(fallback);};
  },[spin?.id,spin?.index]);

  return <div className={'wheel-assembly'+(compact?' wheel-compact':'')+(bonus?' wheel-bonus':'')}>
    <span className="wheel-pointer" aria-hidden="true"/>
    <div className="wheel-disc" style={{
      transform:'rotate('+rotation+'deg)',
      transition:spinning?'transform '+duration+'ms cubic-bezier(.09,.72,.09,1)':'none'
    }} onTransitionEnd={e=>{
      if(e.target===e.currentTarget&&spin)settle(spin.id);
    }}>
      <svg viewBox="0 0 700 700" role="img"
        aria-label={bonus?'Bonus Wheel with 24 numbered sealed envelopes':'Twenty-four-segment Wheel of Fortune prize wheel with colorful cash and specialty wedges'}>
        <defs>
          <filter id={'wheelInk'+uid} x="-40%" y="-40%" width="180%" height="180%">
            <feDropShadow dx="1" dy="2" stdDeviation="1.4" floodColor="#000" floodOpacity=".65"/>
          </filter>
          {/* Upper word runs along the inner upper arc; lower word stays upright on the outer lower arc. */}
          <path id={'wheelTop'+uid} d="M 260 350 A 90 90 0 0 1 440 350"/>
          <path id={'wheelBottom'+uid} d="M 231 350 A 119 119 0 0 0 469 350"/>
        </defs>
        <circle cx="350" cy="350" r="348" fill="#030507"/>
        {wedges.map((w,i)=>{
          const label=radialLabel(w);
          const lightText=w.kind==='bankrupt'||w.kind==='lose';
          const prizeClaimed=!bonus&&mysteryReveals.some(entry=>entry.index===i&&entry.outcome==='prize');
          return <g key={i} transform={'rotate('+(i*15)+' 350 350)'}>
            <path d={sector(0)} fill={w.color} stroke="#090b0d" strokeWidth="1.5"/>
            <text x="350" y="104" textAnchor="middle" dominantBaseline="central"
              transform="rotate(90 350 104)"
              fontFamily="Arial Black, Impact, sans-serif"
              fontSize={wedgeLabelSize(label)} fontWeight="900" letterSpacing=".3"
              textLength={label.length>=8?169:label.length>=5?158:147}
              lengthAdjust="spacingAndGlyphs"
              paintOrder="stroke" stroke={lightText?'#060606':'#f8f9f9'}
              strokeWidth={lightText?1.2:1.6} strokeLinejoin="round"
              fill={lightText?'#ffffff':'#050607'}
              filter={'url(#wheelInk'+uid+')'}>{label}</text>
            {prizeClaimed&&<text x="350" y="54" textAnchor="middle"
              fontFamily="Arial Black, sans-serif" fontWeight="900" fontSize="17"
              transform="rotate(90 350 54)" fill="#fff" stroke="#251005"
              strokeWidth="2.4" paintOrder="stroke">10K WON</text>}
          </g>;
        })}
        {/* Center artwork changes with the actual wheel being spun. */}
        {bonus?<>
          <circle cx="350" cy="350" r="148" fill="#111f4c" stroke="#e3be71" strokeWidth="18"/>
          <circle cx="350" cy="350" r="126" fill="none" stroke="#f6e7bd" strokeWidth="3"/>
          <text x="350" y="339" textAnchor="middle" fill="#fff1b9" fontSize="56"
            fontWeight="900" fontFamily="Arial Black, Impact, sans-serif">BONUS</text>
          <text x="350" y="388" textAnchor="middle" fill="#eef4ff" fontSize="42"
            fontWeight="900" fontFamily="Arial Black, Impact, sans-serif">WHEEL</text>
        </>:<>
        <circle cx="350" cy="350" r="146" fill="#050507" stroke="#0bd51c" strokeWidth="19"/>
        <circle cx="350" cy="350" r="132" fill="none" stroke="#ffffff" strokeWidth="3"/>
        <circle cx="350" cy="350" r="78" fill="#ffffff" stroke="#e8edf0" strokeWidth="3"/>
        {Array.from({length:12},(_,i)=>{
          const a=(i*30-90)*Math.PI/180,b=((i+1)*30-90)*Math.PI/180;
          const p1=[350+41*Math.cos(a),350+41*Math.sin(a)];
          const p2=[350+77*Math.cos(a),350+77*Math.sin(a)];
          const p3=[350+77*Math.cos(b),350+77*Math.sin(b)];
          const p4=[350+41*Math.cos(b),350+41*Math.sin(b)];
          return <path key={i} d={'M '+p1.join(' ')+' L '+p2.join(' ')+' L '+p3.join(' ')+' L '+p4.join(' ')+' Z'}
            fill={i%2===0?'#070708':'#fff'}/>;
        })}
        <circle cx="350" cy="350" r="43" fill="#050507" stroke="#ffffff" strokeWidth="2.5"/>
        <text x="350" y="362" textAnchor="middle" fill="#fff" fontSize="31"
          fontFamily="Arial Black, Impact, sans-serif" fontWeight="900" letterSpacing="-1">OF</text>
        <g fill="#ffffff" stroke="#050507" strokeWidth="1" paintOrder="stroke"
          fontWeight="900" fontFamily="Arial Black, Impact, sans-serif">
          <text fontSize="43" letterSpacing="1">
            <textPath href={'#wheelTop'+uid} textAnchor="middle" startOffset="50%">WHEEL</textPath>
          </text>
          <text fontSize="37" letterSpacing=".2">
            <textPath href={'#wheelBottom'+uid} textAnchor="middle" startOffset="50%">FORTUNE</textPath>
          </text>
        </g>
        <circle cx="239" cy="350" r="6.5" fill="#fff"/>
        <circle cx="461" cy="350" r="6.5" fill="#fff"/>
        </>}
      </svg>
    </div>
    {spin&&<div className="wheel-result" aria-live="polite">{settledId===spin.id?(bonus?'ENVELOPE '+spin.wedge.label:wedges[spin.index]?.label??spin.wedge.label):'SPINNING…'}</div>}
  </div>;
}
