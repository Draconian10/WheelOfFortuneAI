'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {ArrowLeft,Save,Eye,Plus,Trash2,FileJson,Check,Copy,RefreshCw} from 'lucide-react';
import {HostAuth} from './auth';
import {api} from '@/lib/client';
import {gameSchema,playable} from '@/lib/game/schema';
import {emptyGame,starterGame} from '@/lib/game/starter';
import type {GameDefinition,Puzzle} from '@/lib/game/types';
export default function Editor({id}:{id:string}){
  return <HostAuth>{user=><GameEditor key={user.id+id} id={id} owner={user.id}/>}</HostAuth>;
}
function GameEditor({id,owner}:{id:string;owner:string}){
  const router=useRouter();
  const [game,setGame]=useState<GameDefinition|undefined>(undefined);
  const [roundIndex,setRoundIndex]=useState(0),[puzzleIndex,setPuzzleIndex]=useState(0);
  const [editingBonus,setEditingBonus]=useState(false),[editingTie,setEditingTie]=useState(false);
  const [pin,setPin]=useState(''),[busy,setBusy]=useState(false),[status,setStatus]=useState(''),[error,setError]=useState('');
  const [preview,setPreview]=useState(false),[jsonOpen,setJsonOpen]=useState(false),[jsonText,setJsonText]=useState('');
  const [jsonDirty,setJsonDirty]=useState(false),[recoverable,setRecoverable]=useState('');
  const version=useRef(0),latest=useRef<GameDefinition|undefined>(undefined);
  const dirty=useRef(false),saving=useRef(false);
  const key='fortune:editor:'+owner+':'+id;
  useEffect(()=>{
    let live=true;
    const read=async()=>{
      try{
        let value:GameDefinition;
        if(id==='new')value=starterGame();
        else{
          const data=await api<{definition:GameDefinition;version:number}>('games/'+id);
          value=data.definition;version.current=data.version;
        }
        if(!live)return;
        setGame(value);latest.current=value;
        const pending=localStorage.getItem(key);
        if(pending){try{
          const copy=JSON.parse(pending) as {definition:GameDefinition;jsonText?:string;jsonDirty?:boolean};
          if(gameSchema.safeParse(copy.definition).success)setRecoverable(pending);
        }catch{}}
      }catch(e){setError((e as Error).message);}
    };
    void read();return()=>{live=false;};
  },[id,key]);
  const update=useCallback((next:GameDefinition)=>{
    setGame(next);latest.current=next;dirty.current=true;
    setStatus('Unsaved changes');
    try{localStorage.setItem(key,JSON.stringify({
      definition:next,jsonText,jsonDirty,updatedAt:Date.now(),baseVersion:version.current
    }));}catch{}
  },[key,jsonText,jsonDirty]);
  useEffect(()=>{
    if(!game||id==='new'||!dirty.current)return;
    const timer=setTimeout(async()=>{
      if(saving.current)return;
      saving.current=true;const snapshot=latest.current!;
      setStatus('Saving…');
      try{
        const data=await api<{version:number}>('games/'+id,'PUT',{definition:snapshot,version:version.current});
        version.current=data.version;
        if(latest.current===snapshot){
          dirty.current=false;setStatus('All changes saved');
          if(!jsonDirty){try{localStorage.removeItem(key);}catch{}}
        }else setStatus('Newer edits pending');
      }catch(e){setStatus('Autosave blocked — use Save to retry');setError((e as Error).message);}
      finally{saving.current=false;}
    },1800);
    return()=>clearTimeout(timer);
  },[game,id,key,jsonDirty]);
  useEffect(()=>{
    const warn=(e:BeforeUnloadEvent)=>{
      if(dirty.current||jsonDirty){e.preventDefault();e.returnValue='';}
    };
    window.addEventListener('beforeunload',warn);
    return()=>window.removeEventListener('beforeunload',warn);
  },[jsonDirty]);
  const save=async()=>{
    if(!game||saving.current)return;
    setBusy(true);saving.current=true;setError('');
    try{
      gameSchema.parse(game);
      if(id==='new'){
        if(!/^\d{6}$/.test(pin))throw new Error('Set a six-digit host PIN.');
        const result=await api<{id:string}>('games','POST',{definition:game,pin});
        try{localStorage.removeItem(key);}catch{}
        router.replace('/host/edit/'+result.id);
      }else{
        const result=await api<{version:number}>('games/'+id,'PUT',{
          definition:game,pin:pin||undefined,version:version.current
        });
        version.current=result.version;dirty.current=false;setPin('');setStatus('All changes saved');
        if(!jsonDirty){try{localStorage.removeItem(key);}catch{}}
      }
    }catch(e){setError((e as Error).message);}
    finally{setBusy(false);saving.current=false;}
  };
  if(!game)return <main className="container shell-section"><p className="error">{error}</p><div className="panel">Opening game designer…</div></main>;
  const editRound=(index:number,patch:Partial<GameDefinition['rounds'][number]>)=>{
    update({...game,rounds:game.rounds.map((r,i)=>i===index?{...r,...patch}:r)});
  };
  const round=game.rounds[roundIndex];
  const selected=editingTie?game.tiebreaker:editingBonus?game.bonus.puzzles[puzzleIndex]:round.puzzles[puzzleIndex];
  const editPuzzle=(p:Puzzle)=>{
    if(editingTie)update({...game,tiebreaker:p});
    else if(editingBonus)update({...game,bonus:{...game.bonus,
      puzzles:game.bonus.puzzles.map((x,i)=>i===puzzleIndex?p:x)}});
    else editRound(roundIndex,{puzzles:round.puzzles.map((x,i)=>i===puzzleIndex?p:x)});
  };
  let ready=true;let validation='';
  try{playable(game);}catch(e){ready=false;validation=(e as Error).message;}
  const activateRound=(index:number)=>{setRoundIndex(index);setPuzzleIndex(0);setEditingTie(false);setEditingBonus(false);};
  return <main className="container shell-section editor-container">
    <Link className="back-link" href="/host"><ArrowLeft size={16}/> Your games</Link>
    <header className="page-heading"><div><div className="eyebrow">THE PUZZLE WORKSHOP</div>
      <h1>Build your <span className="gold-text">show.</span></h1>
      <p className="muted">Design your round sequence, puzzles, prizes, and bonus finale.</p></div>
      <div className="button-row"><button className="button secondary" onClick={()=>setPreview(!preview)}>
        <Eye size={16}/>{preview?'Edit puzzles':'Preview puzzle'}</button>
        <button className="button primary" disabled={busy} onClick={()=>void save()}><Save size={17}/>{busy?'Saving…':'Save Game'}</button></div>
    </header>
    {error&&<p className="error" role="alert">{error}</p>}
    {!!recoverable&&<section className="panel draft-recovery"><h3>Unsaved puzzle draft found</h3>
      <p className="muted">A recovery copy is available on this browser. PINs are never included.</p>
      <div className="button-row"><button className="button primary" onClick={()=>{
        try{const copy=JSON.parse(recoverable);
          update(copy.definition);
          setJsonText(copy.jsonText??'');setJsonDirty(!!copy.jsonDirty);
          setRecoverable('');
        }catch{setError('Could not restore this draft.');}
      }}><RefreshCw size={16}/> Restore draft</button>
      <button className="button secondary" onClick={()=>{setRecoverable('');localStorage.removeItem(key);}}>Discard</button></div>
    </section>}
    <div className="panel editor-meta">
      <label className="grow">Game title<input maxLength={100} value={game.title}
        onChange={e=>update({...game,title:e.target.value})}/></label>
      <label>Host PIN <small className="muted">{id==='new'?'(required)':'(optional to change)'}</small>
        <input type="password" inputMode="numeric" maxLength={6} pattern="[0-9]{6}"
          autoComplete="new-password" value={pin} placeholder="••••••"
          onChange={e=>setPin(e.target.value.replace(/\D/g,''))}/></label>
      <div className="save-status"><span className={'badge '+(ready?'badge-live':'')}>{ready?'✓ READY TO PLAY':'DRAFT'}</span>
        <small className="muted">{status}</small></div>
    </div>
    {!ready&&<p className="validation-hint">Before launch: {validation}</p>}
    <section className="panel round-tabs-panel">
      <div className="section-heading"><h2>Game sequence</h2>
        <label className="compact-select">Opening style<select value={game.opening}
          onChange={e=>update({...game,opening:e.target.value as GameDefinition['opening']})}>
          <option value="frenzy">Fortune Frenzy</option><option value="traditional">Traditional Toss-Ups</option>
        </select></label></div>
      <div className="round-tabs">
        {game.rounds.map((r,i)=><button key={r.id}
          className={'round-tab '+(!editingBonus&&!editingTie&&roundIndex===i?'active':'')}
          onClick={()=>activateRound(i)}><span className="round-number">{i+1}</span>{r.title}</button>)}
        <button className={'round-tab '+(editingBonus?'active':'')} onClick={()=>{
          setEditingBonus(true);setEditingTie(false);setPuzzleIndex(0);
        }}>✦ Bonus Round</button>
        <button className={'round-tab '+(editingTie?'active':'')} onClick={()=>{
          setEditingTie(true);setEditingBonus(false);setPuzzleIndex(0);
        }}>Tie-breaker</button>
      </div>
    </section>
    <div className="editor-main">
      <section className="panel puzzle-list">
        <div className="section-heading"><h2>{editingTie?'Tie-breaker':editingBonus?'Bonus Categories':round.title}</h2>
          {!editingTie&&!editingBonus&&<span className="badge">{round.kind}</span>}</div>
        {!editingBonus&&!editingTie&&<label>Round name<input value={round.title} maxLength={100}
          onChange={e=>editRound(roundIndex,{title:e.target.value})}/></label>}
        <div className="puzzle-list-items">
          {(editingTie?[game.tiebreaker]:editingBonus?game.bonus.puzzles:round.puzzles).map((p,i)=>
            <button key={p.id} className={'puzzle-row '+(i===puzzleIndex?'active':'')}
              onClick={()=>setPuzzleIndex(i)}>
              <span className="puzzle-number">{String(i+1).padStart(2,'0')}</span>
              <span><b>{p.category||'New category'}</b><small>{p.answer||'Add a solution'}</small></span>
              {p.answer&&<Check size={16}/>}
            </button>)}
        </div>
        {!editingBonus&&!editingTie&&<div className="button-row">
          <button className="button secondary" disabled={round.puzzles.length>=12} onClick={()=>{
            const p={id:crypto.randomUUID(),category:'',answer:'',hint:''};
            editRound(roundIndex,{puzzles:[...round.puzzles,p]});setPuzzleIndex(round.puzzles.length);
          }}><Plus size={16}/> Add puzzle</button>
          <button className="icon-button" title="Remove current puzzle" disabled={round.puzzles.length<=1}
            onClick={()=>{
              if(!confirm('Remove the selected puzzle?'))return;
              editRound(roundIndex,{puzzles:round.puzzles.filter((_,i)=>i!==puzzleIndex)});
              setPuzzleIndex(Math.max(0,puzzleIndex-1));
            }}><Trash2 size={17}/></button></div>}
        {round.kind==='prize'&&!editingBonus&&!editingTie&&<div className="prize-config">
          <h3>Prize Puzzle Award</h3>
          <label>Prize name<input value={round.prize?.label??''}
            onChange={e=>editRound(roundIndex,{prize:{label:e.target.value,value:round.prize?.value??0}})}/></label>
          <label>Prize value ($)<input type="number" min={0} max={1000000} value={round.prize?.value??0}
            onChange={e=>editRound(roundIndex,{prize:{label:round.prize?.label??'',value:Number(e.target.value)}})}/></label>
        </div>}
      </section>
      <section className="panel puzzle-editor">
        <div className="eyebrow">PUZZLE {String(puzzleIndex+1).padStart(2,'0')} · {editingBonus?'BONUS':editingTie?'TIE-BREAKER':round.title.toUpperCase()}</div>
        <h2>Make them say <span className="gold-text">aha!</span></h2>
        <div className="puzzle-preview"><span className="eyebrow">{selected.category||'CATEGORY'}</span>
          <div className="tile-preview">{selected.answer.toUpperCase().split(' ').map((word,i)=>
            <div className="word" key={i}>{word.split('').map((ch,j)=><span className="letter-tile" key={j}>{preview?ch:''}</span>)}</div>)}</div>
          {!selected.answer&&<p className="muted">Your live puzzle preview will appear here.</p>}</div>
        <label>Category<input maxLength={80} value={selected.category} disabled={preview}
          onChange={e=>editPuzzle({...selected,category:e.target.value})} placeholder="Phrase, Thing, Place…"/></label>
        <label>Puzzle solution<input maxLength={160} value={selected.answer} disabled={preview}
          onChange={e=>editPuzzle({...selected,answer:e.target.value.toUpperCase()})} placeholder="THE FUTURE IS BRIGHT"/></label>
        <label>Host hint or notes <small className="muted">(private)</small>
          <textarea rows={3} maxLength={300} value={selected.hint??''} disabled={preview}
            onChange={e=>editPuzzle({...selected,hint:e.target.value})} placeholder="Optional hint for the host"/></label>
        {editingBonus&&<div className="bonus-config">
          <h3>Bonus prize envelopes</h3><p className="muted small">One sealed envelope is selected at random.</p>
          {game.bonus.envelopes.map((e,i)=><div className="prize-row" key={i}>
            <input aria-label={'Envelope '+(i+1)+' label'} maxLength={80} value={e.label}
              onChange={ev=>update({...game,bonus:{...game.bonus,envelopes:game.bonus.envelopes.map((x,j)=>j===i?{...x,label:ev.target.value}:x)}})}/>
            <input aria-label={'Envelope '+(i+1)+' value'} type="number" min={0} max={1000000} value={e.value}
              onChange={ev=>update({...game,bonus:{...game.bonus,envelopes:game.bonus.envelopes.map((x,j)=>j===i?{...x,value:Number(ev.target.value)}:x)}})}/>
            <button className="icon-button" disabled={game.bonus.envelopes.length<=1} onClick={()=>
              update({...game,bonus:{...game.bonus,envelopes:game.bonus.envelopes.filter((_,j)=>j!==i)}})}><Trash2 size={15}/></button>
          </div>)}
          <button className="button secondary" disabled={game.bonus.envelopes.length>=24} onClick={()=>
            update({...game,bonus:{...game.bonus,envelopes:[...game.bonus.envelopes,{label:'$40,000',value:40000}]}})}>
            <Plus size={15}/> Add envelope</button>
        </div>}
      </section>
    </div>
    <section className="panel json-panel">
      <div className="section-heading"><div><h2>Import or export game JSON</h2>
        <p className="muted small">The JSON editor always starts with your current puzzles, rounds, and prize setup.</p></div>
        <button className="button secondary" onClick={()=>{
          if(!jsonOpen&&!jsonDirty){
            setJsonText(JSON.stringify(game,null,2));
          }setJsonOpen(!jsonOpen);
        }}><FileJson size={16}/>{jsonOpen?'Close JSON':'Import JSON'}</button></div>
      {jsonOpen&&<div><div className="button-row">
        <button className="button secondary" onClick={()=>{
          if(jsonDirty&&!confirm('Replace unapplied JSON with the current game?'))return;
          setJsonText(JSON.stringify(game,null,2));setJsonDirty(false);
        }}><RefreshCw size={15}/> Use current game JSON</button>
        <button className="button secondary" onClick={async()=>{
          try{await navigator.clipboard.writeText(JSON.stringify(game,null,2));setStatus('JSON copied.');}
          catch{setError('Unable to copy JSON.');}
        }}><Copy size={15}/> Copy JSON</button>
        <button className="button secondary" onClick={()=>{
          if(!confirm('Replace JSON text with the example game?'))return;
          setJsonText(JSON.stringify(starterGame(),null,2));setJsonDirty(true);
        }}>Load example</button></div>
        <textarea className="json-textarea" aria-label="Game JSON" spellCheck={false} rows={18}
          value={jsonText} onChange={e=>{setJsonText(e.target.value);setJsonDirty(true);}}/>
        <button className="button primary" onClick={()=>{
          try{
            const parsed=gameSchema.parse(JSON.parse(jsonText));
            if(!confirm('Replace the current editor game with this validated JSON?'))return;
            update(parsed);setJsonDirty(false);setStatus('Imported game JSON — save to persist.');
          }catch(e){setError((e as Error).message);}
        }}><Check size={16}/> Validate & apply JSON</button>
      </div>}
    </section>
    <p className="editor-footnote">This editor saves drafts even when some solutions are incomplete. Launch requires a playable, validated game.</p>
  </main>;
}
