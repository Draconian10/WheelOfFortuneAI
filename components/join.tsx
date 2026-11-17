'use client';
import {useEffect,useState} from 'react';
import {useRouter} from 'next/navigation';
import {ArrowRight,Zap,Users,Smartphone} from 'lucide-react';
import {api,supabase,configured} from '@/lib/client';
import {SetupNotice} from './auth';
import PlayerGames from './player-games';
import RecoveryJoin from './recovery-join';
export default function Join(){
  const [code,setCode]=useState(''),[name,setName]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const router=useRouter();
  useEffect(()=>{
    const c=new URLSearchParams(window.location.search).get('code');
    if(c&&/^\d{6}$/.test(c))setCode(c);
  },[]);
  if(!configured())return <main className="container"><SetupNotice/></main>;
  return <main className="container join-layout">
    <div className="join-story"><div className="eyebrow">STEP INTO THE SPOTLIGHT</div>
      <h1>It's your turn to <span className="gold-text">shine.</span></h1>
      <p className="muted">Three contestants. One brilliant wheel. Your phone is the buzzer, letter board, and personal scoreboard.</p>
      <div className="join-icon"><Smartphone size={72}/><Zap size={48} fill="currentColor"/></div></div>
    <div className="join-main"><PlayerGames/>
      <form className="panel join-card" onSubmit={async e=>{
        e.preventDefault();setBusy(true);setError('');
        try{
          const {data}=await supabase().auth.getSession();
          if(data.session&&!data.session.user.is_anonymous){
            const ok=confirm('This browser is signed in as a host. Switch this browser to a player identity? Use a separate device to keep the host console open.');
            if(!ok)return;
            const out=await supabase().auth.signOut({scope:'local'});
            if(out.error)throw out.error;
          }
          const current=await supabase().auth.getSession();
          if(!current.data.session){
            const result=await supabase().auth.signInAnonymously();
            if(result.error)throw result.error;
          }
          const room=await api<{id:string}>('join','POST',{code,name});
          router.push('/play/'+room.id);
        }catch(e){setError((e as Error).message);}finally{setBusy(false);}
      }}>
        <span className="eyebrow">JOIN THE SHOW</span>
        <h2>Grab your spot</h2><p className="muted">Ask the host for the six-digit game code.</p>
        <label>Game code<input className="code-input" required inputMode="numeric"
          autoComplete="off" pattern="[0-9]{6}" maxLength={6} value={code}
          onChange={e=>setCode(e.target.value.replace(/\D/g,''))} placeholder="000000"/></label>
        <label>Your display name<input required autoComplete="nickname" maxLength={24}
          value={name} onChange={e=>setName(e.target.value)} placeholder="Your name"/></label>
        {error&&<p className="error" role="alert">{error}</p>}
        <button className="button primary full" disabled={busy||code.length!==6||!name.trim()}>
          {busy?'Joining…':'Join Game'}<ArrowRight size={17}/></button>
        <p className="muted tiny"><Users size={15}/> No account needed. The host will start when all three contestants arrive.</p>
      </form>
      <RecoveryJoin initialCode={code}/>
    </div>
  </main>;
}
