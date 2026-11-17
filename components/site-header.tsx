'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import type {User} from '@supabase/supabase-js';
import {LogOut,UserRound} from 'lucide-react';
import {configured,supabase} from '@/lib/client';

export default function SiteHeader(){
  const [host,setHost]=useState<User|null>(null);
  const [signingOut,setSigningOut]=useState(false);
  useEffect(()=>{
    if(!configured())return;
    let live=true;
    const client=supabase();
    void client.auth.getSession().then(({data})=>{
      if(live)setHost(data.session?.user&&!data.session.user.is_anonymous?data.session.user:null);
    }).catch(()=>{if(live)setHost(null);});
    const {data}=client.auth.onAuthStateChange((_event,session)=>{
      if(live)setHost(session?.user&&!session.user.is_anonymous?session.user:null);
    });
    return()=>{live=false;data.subscription.unsubscribe();};
  },[]);
  const logout=async()=>{
    setSigningOut(true);
    try{await supabase().auth.signOut({scope:'local'});}
    finally{setSigningOut(false);}
  };
  return <header className="site-header">
    <div className="site-header-inner">
      <Link className="brand" href="/" aria-label="Fortune Live, home">
        <span className="brand-wheel" aria-hidden="true"><span/></span>
        <span className="brand-copy">
          <span className="brand-title">FORTUNE</span>
          <span className="brand-live">LIVE</span>
        </span>
      </Link>
      {host&&<div className="site-account" aria-label="Host account">
        <span className="site-account-icon"><UserRound size={16} aria-hidden="true"/></span>
        <span className="site-account-email" title={host.email}> {host.email}</span>
        <button type="button" className="site-logout" onClick={()=>void logout()} disabled={signingOut}
          aria-label="Sign out" title="Sign out"><LogOut size={17} aria-hidden="true"/><span>Sign out</span></button>
      </div>}
    </div>
  </header>;
}
