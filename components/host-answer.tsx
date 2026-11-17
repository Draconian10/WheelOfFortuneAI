'use client';
import {LockKeyhole} from 'lucide-react';
/** Render only in the authenticated host console; never send this to players. */
export default function HostAnswer({answer,hint}:{answer:string;hint?:string}){
  return <section className="host-private-answer" aria-label="Private Correct Response">
    <div className="host-private-answer-top"><LockKeyhole size={17} aria-hidden="true"/>
      <span>PRIVATE CORRECT RESPONSE</span><small>HOST ONLY</small></div>
    <strong>{answer}</strong>
    {hint?.trim()&&<p>Host note: {hint}</p>}
  </section>;
}
