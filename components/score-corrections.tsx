'use client';
import {useState} from 'react';
import {RotateCcw,SlidersHorizontal} from 'lucide-react';
import type {Command} from '@/lib/game/schema';
import type {SessionView} from '@/lib/game/types';
import {money} from '@/lib/client';

export default function ScoreCorrections({s,enabled,onCommand}:{
  s:SessionView;enabled:boolean;onCommand:(command:Command)=>void;
}){
  const [chosen,setChosen]=useState(s.players[0]?.id??'');
  const [balance,setBalance]=useState<'banked'|'roundMoney'>('banked');
  const [direction,setDirection]=useState<'add'|'remove'>('add');
  const [amount,setAmount]=useState('500');
  const [reason,setReason]=useState('');
  const [expanded,setExpanded]=useState(false);
  const player=s.players.find(p=>p.id===chosen)??s.players[0];
  const amountValue=Number(amount);
  const delta=direction==='remove'?-amountValue:amountValue;
  const wheelPhase=['turn','spinning','letter','wildLetter','mysteryChoice',
    'expressChoice','express','finalSpinning','speedup'].includes(s.phase);
  const valid=!!player&&enabled&&Number.isSafeInteger(delta)&&amountValue>0&&amountValue<=1000000&&
    reason.trim().length>=3&&(balance==='banked'||wheelPhase)&&player[balance]+delta>=0;
  return <section className="panel host-score-tools" aria-label="Host scoring corrections">
    <div className="eyebrow"><SlidersHorizontal size={15}/> SCORING CORRECTIONS</div>
    {s.canUndoLetter&&<button type="button" className="button secondary full undo-letter-button"
      disabled={!enabled} onClick={()=>{
        onCommand({type:'undoLetter'});
      }}><RotateCcw size={16}/> Undo Last Letter</button>}
    <button type="button" className="button secondary full score-tools-toggle"
      aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>
      {expanded?'Close score corrections':'Adjust a contestant score'}
    </button>
    {expanded&&<form className="score-adjust-form" onSubmit={e=>{
      e.preventDefault();if(!valid||!player)return;
      onCommand({type:'adjustScore',playerId:player.id,balance,amount:delta,reason:reason.trim()});
      setReason('');
    }}>
      <label>Contestant<select value={player?.id??''} onChange={e=>setChosen(e.target.value)}>
        {s.players.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
      </select></label>
      <label>Balance<select value={balance} onChange={e=>setBalance(e.target.value as 'banked'|'roundMoney')}>
        <option value="banked">Secured cash</option>
        <option value="roundMoney" disabled={!wheelPhase}>Current round earnings</option>
      </select></label>
      <div className="score-adjust-pair">
        <label>Change<select value={direction} onChange={e=>setDirection(e.target.value as 'add'|'remove')}>
          <option value="add">Add (+)</option><option value="remove">Subtract (−)</option>
        </select></label>
        <label>Amount ($)<input type="number" min="1" max="1000000" step="1" required
          value={amount} onChange={e=>setAmount(e.target.value)}/></label>
      </div>
      <label>Reason for correction<input required minLength={3} maxLength={160}
        value={reason} onChange={e=>setReason(e.target.value)}
        placeholder="e.g. Incorrect consonant payout"/></label>
      <p className="muted tiny" role="status">{player?'Current '+(balance==='banked'?'secured cash':'round earnings')+
        ': '+money(player[balance])+'. New balance: '+(Number.isSafeInteger(delta)?money(player[balance]+delta):'—'):''}</p>
      <button className="button primary full" type="submit" disabled={!valid}>Apply Score Correction</button>
      <p className="muted tiny">Corrections are recorded in the private game history and score ledger.</p>
    </form>}
  </section>;
}
