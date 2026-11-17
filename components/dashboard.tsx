'use client';
import {useCallback,useEffect,useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {Plus,Play,Copy,Pencil,Archive,RotateCcw,Lock,Check,ArrowRight,Trophy,Users} from 'lucide-react';
import {api} from '@/lib/client';
import {handoffController} from '@/lib/launch-controller';
import {HostAuth} from './auth';
import type {GameDefinition} from '@/lib/game/types';
type Game={id:string;title:string;version:number;archived:boolean;updatedAt:string};
type Session={id:string;gameId:string;joinCode:string;active:boolean;phase:string;title:string;players:number;createdAt:string};
export default function Dashboard(){return <HostAuth>{()=> <DashboardInner/>}</HostAuth>;}
function DashboardInner(){
  const [games,setGames]=useState<Game[]>([]),[sessions,setSessions]=useState<Session[]>([]);
  const [loading,setLoading]=useState(true),[error,setError]=useState('');
  const [launch,setLaunch]=useState<Game>(),[pin,setPin]=useState(''),[separate,setSeparate]=useState(false);
  const [requestId,setRequestId]=useState(''),[controller,setController]=useState('');
  const [busy,setBusy]=useState(false),[archiveView,setArchiveView]=useState(false);
  const router=useRouter();
  const refresh=useCallback(async()=>{
    try{
      const data=await api<{games:Game[];sessions:Session[]}>('games');
      setGames(data.games);setSessions(data.sessions);setError('');
    }catch(e){setError((e as Error).message);}finally{setLoading(false);}
  },[]);
  useEffect(()=>{void refresh();},[refresh]);
  const start=async()=>{
    if(!launch)return;
    setBusy(true);setError('');
    try{
      const {id}=await api<{id:string}>('games/'+launch.id+'/start','POST',
        {pin,separate,requestId,controller});
      handoffController(id,controller);
      router.push('/host/session/'+id);
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  };
  return <main className="container shell-section">
    <header className="page-heading">
      <div><div className="eyebrow">THE HOST'S STUDIO</div>
        <h1>Your <span className="gold-text">game night</span> starts here.</h1>
        <p className="muted">Build a show, invite up to five contestants, then let the wheel decide.</p>
      </div>
      <Link href="/host/edit/new" className="button primary"><Plus size={19}/> Create New Game</Link>
    </header>
    {error&&<p className="error" role="alert">{error}</p>}
    <div className="section-heading"><h2>Saved game shows <span className="count">{games.filter(g=>g.archived===archiveView).length}</span></h2>
      <button className="text-button" onClick={()=>setArchiveView(!archiveView)}>
        <Archive size={16}/>{archiveView?'Active games':'Archived games'}</button></div>
    {loading?<div className="panel">Loading your games…</div>:
      !games.filter(g=>g.archived===archiveView).length?
      <section className="panel empty-state"><Trophy size={42}/><h2>Make your first fortune.</h2>
        <p className="muted">The puzzle editor includes a complete sample show you can personalize.</p>
        <Link className="button primary" href="/host/edit/new">Create a game <ArrowRight size={17}/></Link></section>:
      <div className="games-grid">{games.filter(g=>g.archived===archiveView).map((g,i)=>{
        const active=sessions.filter(s=>s.gameId===g.id&&s.active);
        return <article className="game-card" key={g.id}>
          <div className={'game-card-banner banner-'+i%4}><div className="banner-glow"/>
            <span>THE WHEEL<br/><strong>OF FORTUNE</strong></span><Trophy size={54}/></div>
          <div className="game-card-body">
            <div className="card-top"><span className={'badge '+(active.length?'badge-live':'')}>{active.length?'● LIVE SESSION':'SAVED SHOW'}</span>
              <small className="muted">{new Date(g.updatedAt).toLocaleDateString()}</small></div>
            <h3>{g.title}</h3>
            {active.map(s=><div className="resume-row" key={s.id}>
              <div><strong>Code {s.joinCode}</strong><small>{s.players} players · {s.phase}</small></div>
              <Link className="button secondary small-button" href={'/host/session/'+s.id}><RotateCcw size={15}/> Resume</Link>
              <button className="icon-button" title="End session" onClick={async()=>{
                if(!confirm('End this live session permanently?'))return;
                setBusy(true);try{await api('sessions/'+s.id+'/end','POST',{actionId:crypto.randomUUID(),confirmed:true});void refresh();}
                catch(e){setError((e as Error).message);}finally{setBusy(false);}
              }}><Lock size={16}/></button>
            </div>)}
            <div className="card-actions">
              {!g.archived&&<button className="button primary" onClick={()=>{
                setLaunch(g);setPin('');setSeparate(false);
                setRequestId(crypto.randomUUID());setController(crypto.randomUUID());setError('');
              }}><Play size={16}/> {active.length?'New Session':'Start Game'}</button>}
              <Link href={'/host/edit/'+g.id} className="icon-button" aria-label={'Edit '+g.title}><Pencil size={18}/></Link>
              <button className="icon-button" title="Duplicate" onClick={async()=>{
                const newPin=prompt('Set a six-digit PIN for the copy:');
                if(!newPin)return;
                try{
                  const data=await api<{definition:GameDefinition}>('games/'+g.id);
                  const out=await api<{id:string}>('games','POST',{definition:{...data.definition,title:g.title+' (copy)'},pin:newPin});
                  router.push('/host/edit/'+out.id);
                }catch(e){setError((e as Error).message);}
              }}><Copy size={18}/></button>
              <button className="icon-button" title={g.archived?'Restore':'Archive'} onClick={async()=>{
                try{await api('games/'+g.id+'/archive','POST',{archived:!g.archived,version:g.version});void refresh();}
                catch(e){setError((e as Error).message);}
              }}><Archive size={18}/></button>
            </div>
          </div>
        </article>;
      })}</div>}
    {!!sessions.filter(s=>!s.active).length&&<section className="history-panel panel">
      <h2>Previous broadcasts</h2>{sessions.filter(s=>!s.active).slice(0,8).map(s=>
        <div className="history-row" key={s.id}><div><strong>{s.title}</strong><span>{new Date(s.createdAt).toLocaleDateString()} · {s.players} contestants</span></div>
          <Link href={'/host/session/'+s.id} className="text-button">View results <ArrowRight size={15}/></Link></div>)}
    </section>}
    {launch&&<div className="modal-backdrop" onClick={()=>!busy&&setLaunch(undefined)}>
      <form className="modal panel" onClick={e=>e.stopPropagation()} onSubmit={e=>{e.preventDefault();void start();}}>
        <div className="eyebrow">YOU'RE ABOUT TO GO LIVE</div>
        <h2>{launch.title}</h2><p className="muted">Enter the six-digit host PIN. A new six-digit player join code will be generated.</p>
        <label>Host PIN<input autoFocus required type="password" inputMode="numeric"
          pattern="[0-9]{6}" maxLength={6} value={pin}
          onChange={e=>setPin(e.target.value.replace(/\D/g,''))} placeholder="••••••"/></label>
        {!!sessions.find(s=>s.gameId===launch.id&&s.active)&&<label className="checkbox-line">
          <input type="checkbox" checked={separate} onChange={e=>setSeparate(e.target.checked)}/>
          Start a separate game while an unfinished session exists
        </label>}
        {error&&<p className="error" role="alert">{error}</p>}
        <div className="button-row"><button type="button" className="button secondary" onClick={()=>setLaunch(undefined)}>Cancel</button>
          <button className="button primary" disabled={busy||pin.length!==6}><Play size={16}/>{busy?'Starting…':'Start Game'}</button></div>
      </form></div>}
  </main>;
}
