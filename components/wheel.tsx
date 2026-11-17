'use client';
import {useEffect,useId,useRef,useState} from 'react';
import type {RoundKind,Spin,Wedge} from '@/lib/game/types';
import {wheelForRound} from '@/lib/game/wheel';

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
export default function Wheel({kind,spin,compact=false}:{kind:RoundKind;spin?:Spin;compact?:boolean}){
  const wedges=wheelForRound(kind);
  const uid=useId().replace(/:/g,'');
  const [rotation,setRotation]=useState(0);
  const [spinning,setSpinning]=useState(false);
  const seen=useRef('');
  const angleRef=useRef(0);
  useEffect(()=>{
    if(!spin||spin.id===seen.current)return;
    const desired=(360-spin.index*15)%360;
    const current=((angleRef.current%360)+360)%360;
    const extra=(desired-current+360)%360;
    const next=angleRef.current+2160+extra;
    const frame=requestAnimationFrame(()=>{
      angleRef.current=next;
      seen.current=spin.id;
      setSpinning(true);
      setRotation(next);
    });
    return()=>cancelAnimationFrame(frame);
  },[spin?.id,spin?.index]);

  return <div className={'wheel-assembly'+(compact?' wheel-compact':'')}>
    <span className="wheel-pointer" aria-hidden="true"/>
    <div className="wheel-disc" style={{
      transform:'rotate('+rotation+'deg)',
      transition:spinning?'transform 4.2s cubic-bezier(.09,.72,.09,1)':'none'
    }} onTransitionEnd={()=>setSpinning(false)}>
      <svg viewBox="0 0 700 700" role="img"
        aria-label="Twenty-four-segment Wheel of Fortune prize wheel with vivid cash wedges and a large readable center logo">
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
          </g>;
        })}
        {/* In the source wheel the lime-green rim frames a black logo medallion. */}
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
      </svg>
    </div>
    {spin&&<div className="wheel-result" aria-live="polite">{spinning?'SPINNING…':spin.wedge.label}</div>}
  </div>;
}
