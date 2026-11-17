import type {GameHistoryEntry,GameState,Player,Prize,ScoreEvent} from './types';
import {total} from './engine';

type Value=string|number;
type CsvRow=Value[];
const safeDate=(ms:number|undefined)=>ms===undefined?'':new Date(ms).toISOString();
function cell(value:unknown){
  const raw=String(value??'');
  // Spreadsheet formula injection protection for player names, puzzles, notes
  // and all host-authored content.
  const safe=/^[=+\-@\t\r\n]/.test(raw)?'\''+raw:raw;
  return '"'+safe.replace(/"/g,'""')+'"';
}
const prizeTotal=(p:Player)=>p.prizes.reduce((sum,prize)=>sum+prize.value,0);
const stage=(s:GameState,i:number)=>s.definition.rounds[i]?.title??'Stage '+(i+1);
const name=(s:GameState,id:string|undefined)=>s.players.find(p=>p.id===id)?.name??(id===s.hostId?'Host':id?'System / unknown':'System');
const puzzle=(s:GameState,stageIndex:number,puzzleIndex:number)=>
  s.definition.rounds[stageIndex]?.puzzles[puzzleIndex];
const money=(v:number)=>Number.isFinite(v)?v:0;
function summaryScore(s:GameState,p:Player,index:number){
  return [
    index+1,p.name,p.id,p.seat+1,p.banked,prizeTotal(p),total(p),
    p.roundMoney,p.pendingPrizes.reduce((sum,q)=>sum+q.value,0),
    p.wildCard?'Yes':'No',p.millionWedge?'Yes':'No',
    p.id===s.bonusPlayerId?'Finalist':'Contestant',p.removed?'Removed':'Active'
  ];
}

/**
 * One CSV contains clearly labelled sections so Excel, Sheets and text readers
 * can inspect standings, prize values, earnings by stage/puzzle and full action
 * history. Unlike the previous 2-section export, the puzzle answer key is
 * deliberately included: only the authenticated host may download results.
 */
export function resultsCsv(s:GameState,downloadedAt=Date.now()):string{
  const rows:CsvRow[]=[];
  const section=(name:string,header:CsvRow)=>{rows.push([],[name],header);};
  rows.push(['FORTUNE LIVE — RESULTS'],['GAME SUMMARY'],['Field','Value'],
    ['Show title',s.title],
    ['Session ID',s.id],['Game ID',s.gameId],
    ['Started / room created (UTC)',safeDate(s.createdAt)],
    ['Last updated (UTC)',safeDate(s.updatedAt)],
    ['Report generated (UTC)',safeDate(downloadedAt)],
    ['Status',s.phase],['Opening format',s.definition.opening],
    ['Stage reached',s.roundIndex+1],
    ['Stage title',stage(s,s.roundIndex)],
    ['Configured stages',s.definition.rounds.length],
    ['Contenders',s.players.filter(p=>!p.removed).length],
    ['Paused',s.paused?'Yes':'No'],
    ['Bonus finalist',name(s,s.bonusPlayerId)],
    ['Bonus result',s.bonusWon===undefined?'Not completed':s.bonusWon?'Solved':'Not solved']);
  const active=s.players.filter(p=>!p.removed).sort((a,b)=>total(b)-total(a)||a.seat-b.seat);
  section('FINAL STANDINGS',[
    'Rank','Contestant','Player ID','Seat','Banked cash ($)','Secured prize value ($)',
    'Total ($)','Unbanked round cash ($)','Unbanked prize value ($)',
    'Wild Card','Million Dollar eligibility','Role','Status'
  ]);
  for(const [index,p] of active.entries())rows.push(summaryScore(s,p,index));
  for(const p of s.players.filter(p=>p.removed))rows.push([
    'Removed',p.name,p.id,p.seat+1,p.banked,prizeTotal(p),total(p),
    p.roundMoney,p.pendingPrizes.reduce((sum,q)=>sum+q.value,0),
    p.wildCard?'Yes':'No',p.millionWedge?'Yes':'No','Contestant','Removed'
  ]);
  const bonusEvents=(e:ScoreEvent)=>e.reason.startsWith('Bonus Round prize:');
  section('EARNINGS BY STAGE',[
    'Stage number','Stage name','Contestant','Cash / event delta ($)',
    'Scoring events','Distinct scored puzzles'
  ]);
  for(let stageIndex=0;stageIndex<s.definition.rounds.length;stageIndex++){
    for(const p of active){
      const e=s.events.filter(v=>v.round===stageIndex&&v.playerId===p.id&&!bonusEvents(v));
      rows.push([stageIndex+1,stage(s,stageIndex),p.name,
        e.reduce((sum,v)=>sum+v.delta,0),e.length,
        new Set(e.map(v=>v.puzzleIndex).filter(x=>x!==undefined)).size]);
    }
  }
  section('PRIZE DETAILS',['Contestant','Prize name','Prize value ($)','Status']);
  let prizesFound=false;
  for(const p of s.players){
    for(const prize of p.prizes){rows.push([p.name,prize.label,prize.value,'Secured']);prizesFound=true;}
    for(const prize of p.pendingPrizes){rows.push([p.name,prize.label,prize.value,'Unbanked']);prizesFound=true;}
  }
  if(!prizesFound)rows.push(['None','','','']);
  section('SCORING LEDGER',[
    'Timestamp (UTC)','Contestant','Stage number','Stage name',
    'Puzzle number','Puzzle category','Delta ($)','Reason'
  ]);
  for(const e of s.events){
    const p=puzzle(s,e.round,e.puzzleIndex??0);
    rows.push([safeDate(e.at),name(s,e.playerId),e.round+1,
      bonusEvents(e)?'Bonus Round':stage(s,e.round),
      bonusEvents(e)?'Bonus':(e.puzzleIndex??0)+1,bonusEvents(e)?'Bonus':p?.category??'',
      e.delta,e.reason]);
  }
  if(!s.events.length)rows.push(['No score changes recorded']);
  section('PLAY-BY-PLAY ACTIVITY',[
    'Timestamp (UTC)','Actor','Contestant affected','Action','Stage','Stage name',
    'Puzzle','Phase after action','Details','Letter or response'
  ]);
  for(const event of s.history??[]){
    rows.push([safeDate(event.at),name(s,event.actorId),name(s,event.subjectId),
      event.action,event.stageIndex+1,stage(s,event.stageIndex),
      event.puzzleIndex+1,event.phase,event.detail,event.input??'']);
  }
  if(!s.history?.length)rows.push(['No detailed action history available for this session']);
  section('PUZZLE ANSWER KEY — HOST ONLY',[
    'Stage','Stage name','Puzzle number','Category','Solution','Hint','Puzzle ID'
  ]);
  for(const [i,round] of s.definition.rounds.entries()){
    for(const [j,p] of round.puzzles.entries())
      rows.push([i+1,round.title,j+1,p.category,p.answer,p.hint??'',p.id]);
  }
  rows.push(['Bonus','Bonus Round','','','','','']);
  for(const [i,p] of s.definition.bonus.puzzles.entries())
    rows.push(['Bonus','Bonus Round',i+1,p.category,p.answer,p.hint??'',p.id]);
  rows.push(['Tie','Sudden-Death Toss-Up',1,s.definition.tiebreaker.category,
    s.definition.tiebreaker.answer,s.definition.tiebreaker.hint??'',s.definition.tiebreaker.id]);
  rows.push([]);
  rows.push(['NOTES'],['Summary and score events represent saved session state. Unbanked winnings are not included in final totals.'],
    ['Play-by-play starts when the upgraded game engine begins recording actions; older sessions may have partial history.'],
    ['Correct puzzle responses are included for authorized host review; keep this CSV private.']);
  return '\ufeff'+rows.map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
}
