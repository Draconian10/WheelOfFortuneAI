'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {RotateCcw,ArrowRight} from 'lucide-react';
import {api,configured,supabase} from '@/lib/client';
type Entry={id:string;title:string;joinCode:string;phase:string;createdAt:number};
export default function PlayerGames(){
  const [games,setGames]=useState<Entry[]>([]);
  useEffect(()=>{
    if(!configured())return;
    let alive=true;
    const load=async()=>{
      const auth=await supabase().auth.getSession();
      if(!auth.data.session){if(alive)setGames([]);return;}
      try{const data=await api<{sessions:Entry[]}>('player-sessions');
        if(alive)setGames(data.sessions);}catch{}
    };
    void load();const timer=setInterval(()=>void load(),15000);
    const focus=()=>void load();window.addEventListener('focus',focus);
    return()=>{alive=false;clearInterval(timer);window.removeEventListener('focus',focus);};
  },[]);
  if(!games.length)return null;
  return <section className="panel player-return">
    <div className="eyebrow"><RotateCcw size={14}/> PICK UP WHERE YOU LEFT OFF</div>
    {games.map(g=><div className="history-row" key={g.id}><div><strong>{g.title}</strong>
      <span>Room {g.joinCode} · {g.phase}</span></div>
      <Link className="button secondary" href={'/play/'+g.id}>Return <ArrowRight size={14}/></Link>
    </div>)}
  </section>;
}
