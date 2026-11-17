'use client';
import {useEffect,useId,useRef,useState} from 'react';
import type {RoundKind,Spin,Wedge} from '@/lib/game/types';
import {wheelForRound} from '@/lib/game/wheel';
function polar(cx:number,cy:number,r:number,degree:number){
  const rad=(degree-90)*Math.PI/180;
  return [cx+r*Math.cos(rad),cy+r*Math.sin(rad)];
}
function sector(index:number){
  const angle=360/24,a=index*angle-angle/2,b=index*angle+angle/2;
  const p1=polar(350,350,341,a),p2=polar(350,350,341,b);
  return 'M 350 350 L '+p1.join(' ')+' A 341 341 0 0 1 '+p2.join(' ')+' Z';
}
export default function Wheel({kind,spin,compact=false}:{kind:RoundKind;spin?:Spin;compact?:boolean}){
  const wedges:Wedge[]=wheelForRound(kind);
  const uid=useId().replace(/:/g,'');
  const [rotation,setRotation]=useState(0);
  const [spinning,setSpinning]=useState(false);
  const seen=useRef('');
  const angleRef=useRef(0);
  useEffect(()=>{
    if(!spin||spin.id===seen.current)return;
    const desired=(360-spin.index*15)%360;
    const current=((angleRef.current%360)+360)%360;
    const extra=((desired-current)+360)%360;
    const next=angleRef.current+360*6+extra;
    const frame=requestAnimationFrame(()=>{
      angleRef.current=next;
      seen.current=spin.id;
      setSpinning(true);
      setRotation(next);
    });
    return()=>cancelAnimationFrame(frame);
  },[spin?.id,spin?.index]);
  return (
    <div className={'wheel-assembly'+(compact?' wheel-compact':'')}>
      <span className="wheel-pointer" aria-hidden="true"/>
      <div className="wheel-disc" style={{transform:'rotate('+rotation+'deg)',transition:spinning?'transform 4.2s cubic-bezier(.09,.72,.09,1)':'none'}}
        onTransitionEnd={()=>setSpinning(false)}>
        <svg viewBox="0 0 700 700" role="img" aria-label="Colorful twenty-four segment Wheel of Fortune prize wheel">
          <defs>
            <filter id={'wheelShadow'+uid} x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="1" dy="3" stdDeviation="2" floodColor="#000" floodOpacity=".65"/>
            </filter>
            <path id={'wheelTop'+uid} d="M 224 350 A 126 126 0 0 1 476 350"/>
            <path id={'wheelBottom'+uid} d="M 225 375 A 127 127 0 0 0 475 375"/>
          </defs>
          <circle cx="350" cy="350" r="348" fill="#040407"/>
          {wedges.map((w,i)=>(
            <g key={i}>
              <path d={sector(i)} fill={w.color} stroke="#06060a" strokeWidth="1.6"/>
              <text transform={'rotate('+(i*15)+' 350 350)'} x="350" y="36"
                textAnchor="start" writingMode="vertical-rl"
                letterSpacing={w.kind==='bankrupt'?'-3':'-3.2'}
                fontSize={w.kind==='bankrupt'?29:w.label.length>5?35:52}
                fontWeight="1000" fontFamily="Arial Black, Impact, sans-serif"
                fill={w.kind==='bankrupt'?'#ffffff':'#060606'}
                stroke={w.kind==='bankrupt'?'#000':'#ffffff'} strokeWidth={w.kind==='bankrupt'?1:1.4}
                paintOrder="stroke" filter={'url(#wheelShadow'+uid+')'}>{w.label}</text>
            </g>
          ))}
          <circle cx="350" cy="350" r="139" fill="#000" stroke="#0DE000" strokeWidth="22"/>
          <circle cx="350" cy="350" r="119" fill="#000" stroke="#f2f2f2" strokeWidth="3.2"/>
          <circle cx="350" cy="350" r="67" fill="#f9f9f9"/>
          {Array.from({length:12},(_,i)=>{
            const a=i*Math.PI/6;
            const p1=[350+36*Math.cos(a),350+36*Math.sin(a)];
            const p2=[350+67*Math.cos(a),350+67*Math.sin(a)];
            const p3=[350+67*Math.cos(a+Math.PI/6),350+67*Math.sin(a+Math.PI/6)];
            const p4=[350+36*Math.cos(a+Math.PI/6),350+36*Math.sin(a+Math.PI/6)];
            return <path key={i} d={'M '+p1.join(' ')+' L '+p2.join(' ')+' L '+p3.join(' ')+' L '+p4.join(' ')+' Z'}
              fill={i%2===0?'#090909':'#ffffff'}/>;
          })}
          <circle cx="350" cy="350" r="34" fill="#000" stroke="#fff" strokeWidth="2"/>
          <text x="350" y="363" fontSize="34" fill="#fff" fontWeight="1000" textAnchor="middle">OF</text>
          <text fontFamily="Arial Black, Impact, sans-serif" fontWeight="1000" fontSize="55"
            fill="#ffffff" letterSpacing="1">
            <textPath href={'#wheelTop'+uid} startOffset="50%" textAnchor="middle">WHEEL</textPath>
          </text>
          <text fontFamily="Arial Black, Impact, sans-serif" fontWeight="1000" fontSize="47"
            fill="#ffffff" letterSpacing="1">
            <textPath href={'#wheelBottom'+uid} startOffset="50%" textAnchor="middle">FORTUNE</textPath>
          </text>
          <circle cx="258" cy="350" r="8" fill="#ffffff"/>
          <circle cx="442" cy="350" r="8" fill="#ffffff"/>
        </svg>
      </div>
      {spin&&<div className="wheel-result" aria-live="polite">{spinning?'SPINNING…':spin.wedge.label}</div>}
    </div>
  );
}
