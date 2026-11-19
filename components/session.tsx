'use client';
import {useEffect,useMemo,useState} from 'react';
import Link from 'next/link';
import {QRCodeSVG} from 'qrcode.react';
import {
  ArrowLeft,ArrowRight,Check,X,Play,Pause,RotateCcw,Zap,Coins,Gift,Lock,Unlock,
  Copy,Monitor,Trophy,Volume2,VolumeX,Wifi,WifiOff,Timer,Star,CheckCircle2,Hand,
  CircleDollarSign,RefreshCcw,Power,Users
} from 'lucide-react';
import {HostAuth,SetupNotice} from './auth';
import {api,configured,money} from '@/lib/client';
import type {Command} from '@/lib/game/schema';
import type {SessionView} from '@/lib/game/types';
import {MAX_PLAYERS,MIN_PLAYERS,total} from '@/lib/game/engine';
import {sessionReturnHref} from '@/lib/session-navigation';
import {useRoom} from './use-room';
import Wheel from './wheel';
import PuzzleBoard from './puzzle-board';
import Standings from './standings';
import KeepAwake from './keep-awake';
import RecoveryCode from './recovery-code';
import RecoveryRequests from './recovery-requests';
import DisplayAccess from './display-access';
import ResultsConfetti from './results-confetti';
import HostAnswer from './host-answer';
import BonusReveal from './bonus-reveal';
import WedgeHelp from './wedge-help';
import RoundTransition from './round-transition';
import GameBuzzer from './game-buzzer';
import AudienceStage from './audience-stage';
import FinalSpinAnnouncement from './final-spin-announcement';
import ScoreCorrections from './score-corrections';

const VOWELS='AEIOU';
const LETTERS='ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
function formattedTime(ms:number){const sec=Math.ceil(ms/1000);return String(Math.floor(sec/60)).padStart(2,'0')+':'+String(sec%60).padStart(2,'0');}
export default function Session({id,role,displayToken}:{
  id:string;role:'host'|'player'|'audience';displayToken?:string;
}){
  if(role==='host')return <HostAuth>{()=> <LiveSession id={id} role={role}/>}</HostAuth>;
  if(!configured()&&role!=='audience')return <main className="container"><SetupNotice/></main>;
  return <LiveSession id={id} role={role} displayToken={displayToken}/>;
}
function LiveSession({id,role,displayToken}:{
  id:string;role:'host'|'player'|'audience';displayToken?:string;
}){
  const {state:s,userId,controller,error,connected,busy,realtime,send,refresh,remaining}=useRoom(id,role,displayToken);
  const host=role==='host',player=role==='player',audience=role==='audience';
  const control=host&&!!s?.controllerOwned;
  const ended=s&&['finished','ended'].includes(s.phase);
  const [pin,setPin]=useState(''),[solve,setSolve]=useState(''),[showSolve,setShowSolve]=useState(false);
  const [joinUrl,setJoinUrl]=useState(''),[copied,setCopied]=useState(false);
  const [sound,setSound]=useState(false);
  const [settledSpinId,setSettledSpinId]=useState('');
  const spinPendingVisual=!!s?.spin?.startedAt&&
    ['spinning','finalSpinning','turn','letter','wildLetter','mysteryChoice','expressChoice','express','speedup','speedupAnswer'].includes(s.phase)&&
    s.spin.id!==settledSpinId;
  const me=s?.players.find(p=>p.id===userId),active=s?.players.find(p=>p.id===s.currentPlayerId);
  const respondent=s?.players.find(p=>p.id===s.respondent);
  const finalist=s?.players.find(p=>p.id===s.bonusPlayerId);
  const canAct=!!s&&connected&&!busy&&!s.paused&&!spinPendingVisual&&(control||(player&&s.currentPlayerId===userId));
  const wedgeInfo=!!s&&!spinPendingVisual&&s.phase!=='spinning'&&
    (s.pendingSpin?.wedge||(/landed on|hit BANKRUPT|Wild Card collected|Million Dollar Wedge collected/i.test(s.lastAction??'')
      ?s.spin?.wedge:undefined));
  const canSpeedupBuzz=!!s&&s.phase==='speedup'&&s.speedupCanSolve&&
    !!s.windowId&&remaining>0&&canAct;
  const canBuzz=!!s&&player&&connected&&!busy&&!s.paused&&
    ['tossup','tieTossup'].includes(s.phase)&&remaining>0&&!!s.windowId&&
    !s.attempted.includes(userId)&&(s.phase!=='tieTossup'||!!s.tieEligible?.includes(userId));
  useEffect(()=>{setJoinUrl(window.location.origin+'/join?code='+(s?.joinCode??''));},[s?.joinCode]);
  useEffect(()=>{setShowSolve(s?.phase==='speedupAnswer');setSolve('');},[s?.phase,s?.roundIndex,s?.puzzleIndex]);
  useEffect(()=>{
    const key=(e:KeyboardEvent)=>{
      if((e.target as HTMLElement).matches('input,textarea,select,button'))return;
      if((player||control)&&e.code==='Space'&&canSpeedupBuzz&&s?.windowId){
        e.preventDefault();void send({type:'speedupBuzz',windowId:s.windowId});
        return;
      }
      if(player&&e.code==='Space'&&canBuzz&&s?.windowId){
        e.preventDefault();void send({type:'buzz',windowId:s.windowId});
      }
      if(control&&s&&['tossupAnswer','tieAnswer'].includes(s.phase)){
        if(e.key.toLowerCase()==='c')void send({type:'judgeBuzz',correct:true});
        if(e.key.toLowerCase()==='x')void send({type:'judgeBuzz',correct:false});
      }
    };
    window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
  },[player,canBuzz,canSpeedupBuzz,s?.windowId,control,s?.phase,send]);
  useEffect(()=>{
    if(!sound||!s)return;
    if(['tossupAnswer','tieAnswer','roundResult','bonusResult'].includes(s.phase)){
      try{
        const ctx=new AudioContext(),osc=ctx.createOscillator(),gain=ctx.createGain();
        osc.connect(gain);gain.connect(ctx.destination);
        gain.gain.value=.035;osc.frequency.value=s.phase==='roundResult'?990:720;
        osc.start();osc.stop(ctx.currentTime+.12);osc.onended=()=>void ctx.close();
      }catch{}
    }
  },[s?.phase,sound]);
  const doSend=(command:Command)=>{void send(command);};
  const isTossup=!!s&&['tossup','tossupAnswer','tieTossup','tieAnswer'].includes(s.phase);
  const isWheel=!!s&&['spinning','finalSpinning','turn','letter','wildLetter','mysteryChoice','expressChoice','express','speedup','speedupAnswer'].includes(s.phase);
  const speedupBuzzActive=!!s&&s.phase==='speedup'&&s.speedupCanSolve;
  const isBonus=!!s&&['bonusCategory','bonusSpin','bonusSpinning','bonusLetters','bonusTimer','bonusResult'].includes(s.phase);
  const canSolve=!!s&&['turn','express','speedupAnswer','letter'].includes(s.phase)&&canAct&&
    (s.phase!=='letter'||s.pendingSpin?.wedge.kind==='free');
  const wheelKind=s&&['regular','mystery','prize','final'].includes(s.roundKind)
    ?s.roundKind as 'regular'|'mystery'|'prize'|'final':'regular';
  const selectedConsonants=s?.bonusLetters.filter(l=>!VOWELS.includes(l)).length??0;
  const selectedVowels=s?.bonusLetters.filter(l=>VOWELS.includes(l)).length??0;
  const allowedConsonants=finalist?.wildCard?4:3;
  if(!s)return <main className="container shell-section"><div className="panel loading-panel">
    <div className="loading-wheel">✦</div><h2>Connecting to the show…</h2>
    <p className="muted">{error||'Synchronizing your game state.'}</p>
    <Link href={host?'/host':'/join'} className="button secondary">Go back</Link>
  </div></main>;
  const dashboardHref=sessionReturnHref(role,Boolean(ended));
  const clock=<div className={'timer '+(remaining<=5000?'urgent':'')} aria-label="Time remaining">
    <Timer size={19}/><strong>{formattedTime(remaining)}</strong></div>;
  const headline=<div className="live-heading">
    <div><div className="eyebrow">{host?'HOST CONSOLE':audience?'AUDIENCE DISPLAY':s.phase==='lobby'?'YOU ARE IN':'CONTESTANT STATION'}</div>
      <h1>{player?'Welcome, '+(me?.name??'contestant')+'!':s.title}</h1>
      <p className="muted">{s.phase==='lobby'?'The stage is set. Waiting for the show to begin.':s.roundTitle}</p></div>
    <div className="live-code"><small>GAME CODE</small><strong>{s.joinCode}</strong></div>
  </div>;
  const choices=(vowelsOnly:boolean|undefined,express=false)=>{
    const letters=LETTERS.filter(l=>vowelsOnly===undefined||VOWELS.includes(l)===vowelsOnly);
    return <div className="alphabet" role="group" aria-label="Select a letter">
      {letters.map(letter=>{
        const used=s.usedLetters.includes(letter);
        const disabled=!canAct||used||express&&VOWELS.includes(letter)&&((active?.roundMoney??0)<250);
        return <button key={letter} className={'alphabet-key '+(used?'used':'')}
          disabled={disabled} onClick={()=>doSend({type:'letter',letter})}>{letter}</button>;
      })}
    </div>;
  };
  const solutionForm=canSolve&&showSolve&&<form className="solve-form panel" onSubmit={e=>{
    e.preventDefault();doSend({type:'solve',text:solve});setShowSolve(false);
  }}><label>Enter your full solution<input required maxLength={180} autoFocus
    placeholder="Type the complete phrase…" value={solve} onChange={e=>setSolve(e.target.value.toUpperCase())}/></label>
    <div className="button-row"><button className="button primary" disabled={!solve.trim()||busy}><Check size={17}/> Submit Solution</button>
      <button type="button" className="button secondary" onClick={()=>setShowSolve(false)}>Cancel</button></div></form>;
  const solveButton=canSolve&&(!showSolve||s.phase!=='speedupAnswer')&&<button className="button primary" onClick={()=>setShowSolve(true)}>
    <CheckCircle2 size={19}/> Solve Puzzle</button>;
  const resultView=<section className="panel celebration">
    {s.phase==='finished'&&<ResultsConfetti sessionId={id}/>}
    <div className="celebration-icon">{s.closedInLobby?<Lock size={44}/>:<Trophy size={48}/>}</div>
    <div className="eyebrow">{s.closedInLobby?'SESSION CLOSED':s.phase==='finished'?'SHOW CHAMPION':'THE SHOW HAS ENDED'}</div>
    {s.closedInLobby?<><h2>Lobby closed.</h2>
      <p className="muted">The room has ended without starting a game. Any joined players will see that the session is closed.</p></>:
      <><h2>{(finalist??[...s.players].sort((a,b)=>total(b)-total(a))[0])?.name} {s.phase==='finished'?'wins!':'took the spotlight!'}</h2>
      {s.bonusWon!==undefined&&<p className="muted">Bonus Round: {s.bonusWon?'Solved! '+(s.bonusPrize?.label??'Prize')+' added to total.':'No solve this time. The envelope held '+(s.bonusPrize?.label??'a mystery prize')+'.'}</p>}
      <Standings s={s}/></>}
    <div className="button-row centered">{host&&!s.closedInLobby&&<button className="button secondary" onClick={async()=>{
      try{
        const token=await (await import('@/lib/client')).supabase().auth.getSession();
        const r=await fetch('/api/sessions/'+id+'/results',{headers:{Authorization:'Bearer '+token.data.session?.access_token}});
        if(!r.ok)throw new Error('Results download failed.');
        const blob=await r.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');
        a.href=url;a.download='fortune-results-'+s.joinCode+'.csv';a.click();URL.revokeObjectURL(url);
      }catch(e){alert((e as Error).message);}
    }}>Download results CSV</button>}
      <Link href="/" className="button primary">Back to Home <ArrowRight size={16}/></Link></div>
  </section>;
  return <main className={'container shell-section session-container '+(player?'player-container ':'')+(audience?'audience-container':'')}
    data-game-phase={s.phase} data-buzzer-window={s.windowId??''}>
    <div className="session-topline"><Link href={dashboardHref} className="back-link"><ArrowLeft size={15}/> {ended?'Home':host?'Your games':audience?'Home':'Join Game'}</Link>
      <div className="button-row connection-actions">{!audience&&!ended&&<KeepAwake/>}
        <span className={'connection '+(connected?'connected':'disconnected')}>
          {connected?<Wifi size={14}/>:<WifiOff size={14}/>}
          {connected?(realtime?'Live':'Connected'):'Reconnecting'}</span>
        <button className="icon-button" title={sound?'Mute sounds':'Enable sound'} onClick={()=>setSound(!sound)}>
          {sound?<Volume2 size={18}/>:<VolumeX size={18}/>}</button>
      </div>
    </div>
    {headline}
    <RoundTransition s={s}/>
    {error&&<p className="error" role="alert">{error}</p>}
    {host&&!ended&&!control&&<section className="panel claim-panel">
      <div className="claim-heading"><Lock size={20} aria-hidden="true"/>
        <div><h2>Reclaim host controls</h2>
          <p className="muted">Enter your six-digit host PIN to resume control. Your game is safe.</p></div>
      </div>
      <form className="claim-form" onSubmit={e=>{e.preventDefault();doSend({type:'claim',pin,controller});}}>
        <label htmlFor="reclaim-host-pin">Host PIN</label>
        <div className="claim-form-row">
          <input id="reclaim-host-pin" aria-label="Six-digit host PIN" type="password" inputMode="numeric" pattern="[0-9]{6}"
            autoComplete="off" maxLength={6} required value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,''))}/>
          <button className="button primary" disabled={busy||pin.length!==6}><Lock size={16}/> Take control</button>
        </div>
      </form>
    </section>}
    {s.paused&&!ended&&<div className="pause-banner"><Pause size={20}/>
      <div><strong>{s.pauseReason==='Host disconnected'?'Host reconnecting — game paused':'Game paused'}</strong>
        <p>Scores, prizes, puzzle progress, and your seat are saved.</p></div>
      {control&&<button className="button primary pause-resume-button" onClick={()=>doSend({type:'continue'})}><Play size={18} fill="currentColor" strokeWidth={2.5} aria-hidden="true"/> Continue</button>}
    </div>}
    {ended?resultView:s.phase==='lobby'?
      <div className="lobby-layout">
        <section className="panel invite-panel"><span className="eyebrow">THE ROOM IS OPEN</span>
          <h2>{player?'You have a seat!':'Invite your contenders.'}</h2>
          <p className="muted">{player?'Leave this page open. The host will start the show.':
            'Share the code or let players scan the QR code from their phones.'}</p>
          {!player&&<><div className="qr-wrap"><QRCodeSVG value={joinUrl} size={164} bgColor="#fff" fgColor="#13204b"/></div>
            <div className="join-code">{s.joinCode}</div>
            <button className="text-button" onClick={async()=>{
              try{await navigator.clipboard.writeText(joinUrl);setCopied(true);setTimeout(()=>setCopied(false),2000);}
              catch{}
            }}><Copy size={16}/>{copied?'Link copied':'Copy invitation link'}</button></>}
          {control&&<div className="lobby-actions">
            <button className="button secondary full" onClick={()=>doSend({type:'lockLobby',locked:!s.locked})}>
              {s.locked?<Unlock size={17}/>:<Lock size={17}/>} {s.locked?'Unlock Lobby':'Lock Lobby'}</button>
            <button className="button primary full" disabled={busy||s.paused||s.players.length<MIN_PLAYERS}
              onClick={()=>doSend({type:'start'})}><Play size={18}/> Start the Show</button>
            <button type="button" className="button lobby-end-button full"
              disabled={busy||!connected}
              onClick={()=>{
                if(window.confirm('End this session for everyone? The room code will stop working and this action cannot be undone.'))
                  doSend({type:'end'});
              }}><Power size={17}/> End Session</button>
          </div>}
          {host&&<DisplayAccess sessionId={id} placement="lobby"/>}
        </section>
        <section className="panel lobby-players"><div className="section-heading"><h2>Our contestants</h2>
          <span className="count" aria-label={`${s.players.length} out of ${MAX_PLAYERS} contestant seats filled`}>{s.players.length}/{MAX_PLAYERS}</span></div>
          {s.players.length?s.players.map(p=><div className="lobby-player" key={p.id}>
            <span className={'avatar seat-'+p.seat}>{p.name.charAt(0).toUpperCase()}</span>
            <div><strong>{p.name}{p.id===userId?' (you)':''}</strong>
              <small>Contestant {p.seat+1}</small></div>
            <span className="ready-pill">● READY</span>
            {control&&<button className="icon-button" title={'Remove '+p.name}
              onClick={()=>{if(confirm('Remove '+p.name+' from the lobby?'))doSend({type:'remove',playerId:p.id});}}><X size={16}/></button>}
          </div>):<div className="empty-players"><span className="empty-players-icon"><Users size={36} aria-hidden="true"/></span>
            <strong>No contestants yet</strong>
            <p>The first player will appear here after joining with the six-digit code.</p>
          </div>}
          <div className="waiting-bar" role="progressbar" aria-label="Contestant seats filled"
            aria-valuenow={s.players.length} aria-valuemin={0} aria-valuemax={MAX_PLAYERS}>
            <span style={{width:(s.players.length/MAX_PLAYERS*100)+'%'}}/></div>
          <p className="muted tiny">{s.players.length===0?
            'Waiting for the first contestant to join…':
            s.players.length===MAX_PLAYERS?
            'The lobby is full. Everyone is ready to play!':
            `${s.players.length} ready · ${MAX_PLAYERS-s.players.length} open ${MAX_PLAYERS-s.players.length===1?'seat':'seats'}. The host can start now.`}</p>
        </section>
      </div>:
      audience?<AudienceStage s={s} remaining={remaining}/>:
      <div className={'game-layout '+(isBonus?'bonus-layout':'')}>
        <div className="game-primary">
          <div className="game-progress"><span className="eyebrow">
            {s.phase==='tieTossup'||s.phase==='tieAnswer'?'TIEBREAKER':
              isBonus?'BONUS FINALE':'STAGE '+(s.roundIndex+1)+' OF '+s.totalRounds}
          </span><span className="round-title">{s.roundTitle}
            {s.roundKind==='tossup'&&s.roundIndex===0&&
              <span className="frenzy-puzzle-count"> · Puzzle {s.puzzleIndex+1}/{s.puzzlesInRound} · 30s each</span>}
          </span>
            {isTossup&&clock}</div>
          {(s.phase==='finalSpinning'||s.phase==='speedup')&&
            <FinalSpinAnnouncement spinning={s.phase==='finalSpinning'||spinPendingVisual}
              value={!spinPendingVisual?s.speedupValue:undefined}/>}
          {!['bonusCategory','bonusSpin','bonusSpinning'].includes(s.phase)&&<PuzzleBoard s={s}/> }
          {s.lastAction&&<div className="action-ticker" role="status" aria-live="polite">
            <span className="action-ticker-icon"><Star size={23} aria-hidden="true"/></span>
            <div><span className="action-ticker-label">LIVE GAME UPDATE</span>
              <strong>{s.phase==='finalSpinning'||s.phase==='speedup'&&spinPendingVisual?
                'Final Spin is underway — Speed-Up starts when the wheel stops.':
                spinPendingVisual?(active?.name??'The contestant')+' is spinning the wheel…':s.lastAction}</strong>
            </div>
          </div>}
          {wedgeInfo&&<WedgeHelp kind={wedgeInfo.kind}/>}
          {isTossup&&<section className="panel phase-panel tossup-stage">
            <div className="eyebrow">{s.phase==='tieTossup'||s.phase==='tieAnswer'?'SUDDEN DEATH':'BUZZER ROUND'}</div>
            {s.phase==='tieTossup'||s.phase==='tossup'?
              <>
                <h2>{s.phase==='tieTossup'?'Only the tied leaders can buzz!':'Know the phrase? Hit the buzzer!'}</h2>
                {player&&<GameBuzzer ready={canBuzz} onBuzz={()=>{
                  if(navigator.vibrate)navigator.vibrate(35);
                  if(s.windowId)doSend({type:'buzz',windowId:s.windowId});
                }}/>} 
                <p className="muted">{player?(s.attempted.includes(userId)?'You have already attempted this puzzle.':
                  canBuzz?'Tap to claim your chance to solve.':'Waiting for the host or another contestant.'):
                  'Letters appear automatically. Buzzers close after the first accepted press.'}</p>
              </>:
              <>
                <h2>{respondent?.name} buzzed in first!</h2>
                <p className="muted">Please give your full solution aloud. The host judges the response.</p>
                {host&&s.puzzle.answer&&<HostAnswer
                  key={s.roundIndex+':'+s.puzzleIndex+':buzz'} answer={s.puzzle.answer} hint={s.puzzle.hint}/>}
                {control&&<div className="button-row centered">
                  <button className="button success" onClick={()=>doSend({type:'judgeBuzz',correct:true})} disabled={busy||s.paused}>
                    <Check size={18}/> Correct</button>
                  <button className="button danger" onClick={()=>doSend({type:'judgeBuzz',correct:false})} disabled={busy||s.paused}>
                    <X size={18}/> Incorrect</button></div>}
                {player&&<div className="buzz-answer">{s.respondent===userId?'YOU ARE UP!':'Watching '+respondent?.name+' answer'}</div>}
              </>}
          </section>}
          {isWheel&&<div className={'wheel-game-grid'+(speedupBuzzActive?' speedup-buzz-layout':'')}>
            {!speedupBuzzActive&&<div className="wheel-area"><Wheel kind={wheelKind} spin={s.spin} mysteryReveals={s.mysteryReveals} onSpinSettled={setSettledSpinId}/>
              {s.speedupValue!==undefined&&!spinPendingVisual&&<p className="speedup-banner">FINAL SPIN · {money(s.speedupValue)} per consonant</p>}
            </div>}
            <section className="panel turn-panel">
              <div className="eyebrow">CURRENT TURN</div>
              <div className="turn-person"><span className={'avatar seat-'+(active?.seat??0)}>{active?.name.slice(0,1)}</span>
                <div><h2>{active?.name}</h2><p className="muted">{active?.id===userId?'Your move!':'Time to make a move'}</p></div></div>
              <div className="round-money"><div><small>Round earnings</small><strong>{money(active?.roundMoney??0)}</strong></div>
                <div><small>Secured cash</small><strong>{money(active?.banked??0)}</strong></div></div>
              {(s.phase==='spinning'||s.phase==='finalSpinning'||spinPendingVisual)&&<div className="spin-progress" role="status">
                <RotateCcw size={17} aria-hidden="true"/> The wheel is spinning. Wait for the result.
              </div>}
              {s.phase==='turn'&&!spinPendingVisual&&<div className="turn-actions">
                <button className="button primary full" disabled={!canAct} onClick={()=>doSend({type:'spin'})}>
                  <RotateCcw size={18}/> Spin the Wheel</button>
                <button className="button secondary full" disabled={!canAct||(active?.roundMoney??0)<250}
                  onClick={()=>doSend({type:'buyVowel'})}><Coins size={18}/> Buy Vowel · $250</button>
                {active?.wildCard&&s.wildCardValue!==undefined&&<button className="button secondary full"
                  disabled={!canAct} onClick={()=>doSend({type:'useWildCard'})}>
                  <Star size={18}/> Use Wild Card · Extra consonant at {money(s.wildCardValue)} each
                </button>}
                {solveButton}
                {control&&s.roundKind==='final'&&<div className="final-spin-control">
                  <button className="button secondary full" disabled={!canAct}
                    title="Host calls the final spin: lock the wheel value and begin Speed-Up play."
                    onClick={()=>doSend({type:'speedUp'})}><Timer size={16}/> Start Final Spin</button>
                  <p>The wheel spins once more, then locks the value for Speed-Up.</p>
                </div>}
              </div>}
              {s.phase==='letter'&&!spinPendingVisual&&<>
                <h3>{s.pendingSpin?.wedge.kind==='free'?'Free Play — choose any letter':
                  s.pendingSpin?'Call a consonant for '+s.pendingSpin.wedge.label:'Choose a vowel'}</h3>
                {choices(s.pendingSpin?.wedge.kind==='free'?undefined:!s.pendingSpin)}
                {solveButton}
              </>}
              {s.phase==='wildLetter'&&<>
                <h3>Wild Card · One extra consonant at {money(s.wildCardValue??0)} each</h3>
                <p className="muted">The Wild Card has been spent. An incorrect consonant loses the turn.</p>
                {choices(false)}
              </>}
              {s.phase==='mysteryChoice'&&<>
                <h3>Mystery Wedge!</h3><p className="muted">Keep $1,000 per matching consonant, or take a 50/50 chance on $10,000 or Bankrupt.</p>
                <button className="button secondary full" disabled={!canAct} onClick={()=>doSend({type:'mystery',reveal:false})}>Keep the cash</button>
                <button className="button primary full" disabled={!canAct} onClick={()=>doSend({type:'mystery',reveal:true})}>Reveal the mystery</button>
              </>}
              {s.phase==='expressChoice'&&<>
                <h3>Express Lane!</h3><p className="muted">Keep calling letters for $1,000 per consonant. An incorrect letter means BANKRUPT.</p>
                <button className="button primary full" disabled={!canAct} onClick={()=>doSend({type:'express',accept:true})}>Play Express</button>
                <button className="button secondary full" disabled={!canAct} onClick={()=>doSend({type:'express',accept:false})}>Decline</button>
              </>}
              {s.phase==='express'&&<>
                <h3>Express Mode · Risk it all</h3>
                {choices(undefined,true)}{solveButton}
              </>}
              {s.phase==='speedup'&&<>
                <h3>{s.speedupCanSolve?'Final Spin · Buzz for the answer!':'Final Spin · One letter at a time'}</h3>
                {!s.speedupCanSolve?choices(undefined):<div className="speedup-buzz-stage">
                  <div className="speedup-solve-clock speedup-buzz-timer" role="status" aria-live="off">
                    <span>Ten seconds to buzz</span>{clock}
                  </div>
                  <p className="muted">Buzz within ten seconds to claim your answer. Once you buzz, the typing clock stops and you can enter the entire solution.</p>
                  {(player||control)&&<GameBuzzer context="speedup" ready={canSpeedupBuzz} onBuzz={()=>{
                    if(navigator.vibrate)navigator.vibrate(35);
                    if(s.windowId)doSend({type:'speedupBuzz',windowId:s.windowId});
                  }}/>}
                </div>}
              </>
              {s.phase==='speedupAnswer'&&<>
                <h3>Final Spin · Answer claimed!</h3>
                <p className="muted">{active?.name} buzzed in on time. The countdown is stopped — take your time entering the full solution. An incorrect answer passes control to the next contestant.</p>
                {solveButton}
                {(control||player&&s.currentPlayerId===userId)&&<button className="button secondary full"
                  disabled={!canAct} onClick={()=>doSend({type:'pass'})}>Pass without answering <ArrowRight size={16}/></button>}
              </>}
              {solutionForm}
              {host&&s.puzzle.answer&&s.phase!=='spinning'&&<HostAnswer
                key={s.roundIndex+':'+s.puzzleIndex} answer={s.puzzle.answer} hint={s.puzzle.hint}/>}
              {control&&['turn','letter','express','speedupAnswer'].includes(s.phase)&&
                <div className="host-oral">
                <button className="button primary full host-solve-button"
                  disabled={!canAct}
                  onClick={()=>{
                    // A valid Speed-Up buzz removes the answer deadline.
                    if(active&&(s.phase==='speedupAnswer'||confirm('Confirm '+active.name+' solved the puzzle correctly aloud?')))
                      doSend({type:'hostSolve',playerId:active.id});
                  }}><Check size={19} strokeWidth={2.6} aria-hidden="true"/> Mark Solution Correct</button>
              </div>}
            </section>
          </div>}
          {s.phase==='roundResult'&&<section className="panel round-complete">
            <div className="celebration-icon"><Trophy size={40}/></div>
            <div className="eyebrow">{s.puzzleTimedOut?'TIMER COMPLETE':'PUZZLE COMPLETE'}</div>
            <h2>{s.puzzleTimedOut?"Time's up!":"That's a wrap!"}</h2>
            <p className="muted">{s.puzzleTimedOut?
              'The answer stays concealed until the host chooses to reveal it. You can advance to the next puzzle instead.':
              'The puzzle is finished. Here are the updated standings.'}</p>
            <Standings s={s}/>
            {control&&<div className="button-row centered">
              {s.puzzleTimedOut&&<button className="button secondary" disabled={busy||s.paused}
                onClick={()=>doSend({type:'revealTimedOut'})}>Reveal this solution</button>}
              <button className="button primary" disabled={busy||s.paused}
                onClick={()=>doSend({type:'nextRound'})}>
                {['triple','tossup'].includes(s.roundKind)&&s.puzzleIndex+1<s.puzzlesInRound?
                  s.roundKind==='tossup'&&s.roundIndex===0?'Next Frenzy Puzzle':'Next Toss-Up':
                  s.roundIndex===s.totalRounds-1?'See our finalist':'Next Round'}
                <ArrowRight size={17}/></button>
            </div>}
          </section>}
          {s.phase==='bonusCategory'&&<section className="panel bonus-stage">
            <div className="bonus-star">✦</div><div className="eyebrow">THE GRAND FINALE</div>
            <h2>{finalist?.name}, pick your category!</h2>
            <p className="muted">The bonus envelope is sealed. Choose a category for the ten-second puzzle.</p>
            {s.spin&&<div className="bonus-wheel"><Wheel kind="regular" bonus spin={s.spin} compact/></div>}
            <div className="bonus-categories">{s.bonusCategories?.map((name,i)=>
              <button key={i} className="bonus-category" disabled={!canAct&&userId!==s.bonusPlayerId||s.paused||busy}
                onClick={()=>doSend({type:'chooseBonus',index:i})}>
                <span>OPTION 0{i+1}</span><strong>{name}</strong><ArrowRight size={17}/></button>)}</div>
          </section>}
          {['bonusSpin','bonusSpinning'].includes(s.phase)&&<section className="panel bonus-stage bonus-spin-stage">
            <div className="eyebrow">THE 24-ENVELOPE BONUS WHEEL</div>
            <h2>{s.phase==='bonusSpinning'?'The Bonus Wheel is spinning!':
              finalist?.name+', spin for a sealed prize!'}</h2>
            <p className="muted">{s.phase==='bonusSpinning'?
              'The pointer is selecting one numbered envelope. Categories unlock after it lands.':
              'Each numbered slot corresponds to a real prize envelope. Its value stays sealed until the puzzle is judged.'}</p>
            <div className="bonus-wheel"><Wheel kind="regular" bonus spin={s.spin} compact/></div>
            {s.phase==='bonusSpin'&&(control||userId===s.bonusPlayerId)&&<button className="button primary"
              disabled={busy||s.paused||!connected} onClick={()=>doSend({type:'spinBonus'})}>
              <RotateCcw size={18}/> Spin Bonus Wheel</button>}
            {s.phase==='bonusSpinning'&&<p className="bonus-spin-wait" role="status">Sealed envelope in motion…</p>}
          </section>}
          {s.phase==='bonusLetters'&&<section className="panel bonus-stage">
            <div className="eyebrow">BONUS ROUND · PICK YOUR LETTERS</div>
            <h2>R, S, T, L, N, E are yours.</h2>
            <p className="muted">Choose {allowedConsonants} consonants and one vowel. An eligible Wild Card adds one consonant.</p>
            <div className="bonus-picks"><span>Consonants {selectedConsonants}/{allowedConsonants}</span><span>Vowels {selectedVowels}/1</span></div>
            <div className="alphabet">{LETTERS.filter(l=>!'RSTLNE'.includes(l)).map(letter=>
              <button className={'alphabet-key '+(s.bonusLetters.includes(letter)?'used':'')} key={letter}
                disabled={s.bonusLetters.includes(letter)||(VOWELS.includes(letter)?selectedVowels>=1:selectedConsonants>=allowedConsonants)
                  ||!(control||userId===s.bonusPlayerId)||busy||s.paused}
                onClick={()=>doSend({type:'bonusLetter',letter})}>{letter}</button>)}</div>
            {control&&<button className="button primary" disabled={busy||s.paused||selectedVowels!==1||selectedConsonants!==allowedConsonants}
              onClick={()=>doSend({type:'startBonus'})}><Timer size={18}/> Start 10-second finale</button>}
            {player&&userId!==s.bonusPlayerId&&<p className="muted">Cheer on {finalist?.name}!</p>}
          </section>}
          {s.phase==='bonusTimer'&&<section className="panel bonus-stage">
            <div className="eyebrow">TEN SECONDS TO FORTUNE</div><h2>It's all on this puzzle.</h2>{clock}
            {host&&s.puzzle.answer&&<HostAnswer key={'bonus:'+s.bonusPuzzleIndex}
              answer={s.puzzle.answer} hint={s.puzzle.hint}/>}

            {player&&userId===s.bonusPlayerId&&<form className="solve-form" onSubmit={e=>{
              e.preventDefault();doSend({type:'bonusSolve',text:solve});
            }}><label>Your final solution<input autoFocus required maxLength={180} value={solve}
              onChange={e=>setSolve(e.target.value.toUpperCase())}/></label>
              <button className="button primary" disabled={busy||s.paused||remaining<=0}>Lock in solution</button></form>}
            {control&&<div className="button-row centered">
              <button className="button success" disabled={busy||remaining<=0} onClick={()=>doSend({type:'bonusJudge',correct:true})}>Correct</button>
              <button className="button danger" disabled={busy||remaining<=0} onClick={()=>doSend({type:'bonusJudge',correct:false})}>Incorrect</button></div>}
          </section>}
          {s.phase==='bonusResult'&&<BonusReveal
            won={!!s.bonusWon} prize={s.bonusPrize} finalist={finalist}
            control={control} busy={busy} paused={s.paused}
            onFinish={()=>doSend({type:'finish'})}/>}

        </div>
        <aside className="game-sidebar">
          {player&&me&&<div className="panel personal-score">
            <div className="eyebrow">YOUR FORTUNE</div><strong>{money(total(me))}</strong>
            <div className="score-split"><span>Current round <b>{money(me.roundMoney)}</b></span>
              <span>Banked cash <b>{money(me.banked)}</b></span></div>
            <small>Standing #{[...s.players].sort((a,b)=>total(b)-total(a)).findIndex(p=>p.id===userId)+1} of {s.players.length}</small>
          </div>}
          {!player&&<div className="panel"><Standings s={s} compact/></div>}
          {host&&<div className="panel host-tools">
            <div className="eyebrow">SHOW CONTROLS</div>
            <div className="host-action-stack">
              <button className="button secondary full" disabled={!control||busy}
                onClick={()=>doSend({type:s.paused?'continue':'pause'})}>
                {s.paused?<Play size={16}/>:<Pause size={16}/>}
                {s.paused?'Continue Show':'Pause Show'}</button>
              {s.canUndo&&<button className="button secondary full" disabled={!control||busy} onClick={()=>{
                if(confirm('Undo the last judgment? The show will pause for review.'))doSend({type:'undo'});
              }}><RotateCcw size={16}/> Undo Judgment</button>}
              <DisplayAccess sessionId={id}/>
              {!ended&&<button className="button host-end-game full" disabled={!control||busy}
                onClick={()=>{if(confirm('End this game and save the current standings? This cannot be undone.'))doSend({type:'end'});}}>
                <X size={16}/> End Game
              </button>}
            </div>
          </div>}
          {host&&!ended&&
            <ScoreCorrections s={s} enabled={control&&!busy&&connected&&!s.paused} onCommand={doSend}/>}
          {host&&!ended&&<RecoveryRequests sessionId={id} onApproved={refresh}/>}
          {player&&<div className="panel player-instruction">
            <div className="eyebrow">HOW TO PLAY</div>
            <p>Spin, call letters, buy vowels, and solve on your turn. Your round money becomes secure only when you solve the puzzle.</p>
            <p className="muted tiny">A Bankrupt only removes the applicable unbanked round money.</p>
          </div>}
        </aside>
      </div>}
    {player&&me&&!ended&&<RecoveryCode sessionId={id}/>}
  </main>;
}
