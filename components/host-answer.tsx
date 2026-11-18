'use client';
import {ChevronDown,LockKeyhole} from 'lucide-react';

/**
 * Mirrors JeopardyAI's native disclosure interaction. The answer stays
 * collapsed until the host opens it; only server-authorized host views ever
 * render this component or receive the answer.
 */
export default function HostAnswer({answer,hint}:{answer:string;hint?:string}){
  return <details className="host-private-answer" aria-label="Private Correct Response">
    <summary className="host-private-answer-top">
      <span className="host-private-answer-icon"><LockKeyhole size={18} aria-hidden="true"/></span>
      <strong>Private Correct Response</strong>
      <span className="host-private-answer-tag">HOST ONLY</span>
      <ChevronDown className="host-private-answer-chevron" size={19} aria-hidden="true"/>
    </summary>
    <div className="host-private-answer-content">
      <p className="host-private-answer-response">{answer}</p>
      {hint?.trim()&&<div className="host-private-answer-note"><small>Host note</small><p>{hint}</p></div>}
    </div>
  </details>;
}
