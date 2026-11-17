'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {api,ApiError,supabase} from '@/lib/client';
import {takeLaunchController} from '@/lib/launch-controller';
import type {Command} from '@/lib/game/schema';
import type {SessionView} from '@/lib/game/types';

export function useRoom(id:string,role:'host'|'player'|'audience',displayToken?:string){
  const [state,setState]=useState<SessionView>();
  const reference=useRef<SessionView|undefined>(undefined);
  const [userId,setUserId]=useState('');
  const [controller,setController]=useState('');
  const launchController=useRef<{id:string;value:string}|undefined>(undefined);
  const [connected,setConnected]=useState(false);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [realtime,setRealtime]=useState(false);
  const realtimeRef=useRef(false);
  const refreshBusy=useRef<Promise<void>|undefined>(undefined);
  const trailing=useRef(false);
  const offset=useRef(0);
  const seq=useRef(0);
  const lastGood=useRef(0);
  const heartbeatBusy=useRef(false);
  const [now,setNow]=useState(Date.now());
  const accept=useCallback((next:SessionView,n:number)=>{
    const old=reference.current;
    if(!old||next.version>old.version||next.version===old.version&&
      (next.runtimeAt??n)>=(old.runtimeAt??lastGood.current)){
      reference.current=next;
      offset.current=next.serverNow-Date.now();
      setState(next);
    }
    if(n>=lastGood.current){lastGood.current=n;setConnected(true);setError('');}
  },[]);
  const refresh=useCallback(():Promise<void>=>{
    if(refreshBusy.current){trailing.current=true;return refreshBusy.current;}
    const run=async()=>{
      do{
        trailing.current=false;
        const n=++seq.current;
        try{
          let data:SessionView;
          if(role==='audience'&&displayToken){
            const response=await fetch('/api/display/'+id+'?token='+encodeURIComponent(displayToken),
              {cache:'no-store',signal:AbortSignal.timeout(12000)});
            if(!response.ok)throw new Error((await response.json().catch(()=>({}))).error??'Display disconnected.');
            data=await response.json();
          }else{
            data=await api<SessionView>('sessions/'+id,'GET',undefined,controller||undefined,12000);
          }
          accept(data,n);
        }catch(e){
          if(n>=lastGood.current){setConnected(false);setError((e as Error).message);}
        }
      }while(trailing.current);
    };
    const pending=run().finally(()=>{refreshBusy.current=undefined;});
    refreshBusy.current=pending;
    return pending;
  },[id,role,displayToken,controller,accept]);
  useEffect(()=>{
    if(role!=='host')return;
    if(launchController.current?.id!==id)
      launchController.current={id,value:takeLaunchController(id)??crypto.randomUUID()};
    setController(launchController.current.value);
  },[id,role]);
  useEffect(()=>{
    if(role==='audience'&&displayToken){setUserId('audience');void refresh();return;}
    if(role==='host'&&!controller)return;
    let live=true;
    supabase().auth.getUser().then(({data,error})=>{
      if(!live)return;
      if(error||!data.user){setError('Sign in or join this game again.');return;}
      setUserId(data.user.id);void refresh();
    });
    return()=>{live=false;};
  },[controller,displayToken,refresh,role]);
  useEffect(()=>{
    if(!userId||(role==='host'&&!state?.controllerOwned)||role==='audience'&&!!displayToken)return;
    let alive=true;
    const channel=supabase().channel('session:'+id,{config:{private:true}})
      .on('broadcast',{event:'changed'},({payload})=>{
        if(!alive)return;
        if(typeof payload?.version==='number'&&payload.version<=(reference.current?.version??-1))return;
        void refresh();
      }).subscribe(status=>{
        if(!alive)return;
        realtimeRef.current=status==='SUBSCRIBED';
        setRealtime(realtimeRef.current);
        if(realtimeRef.current)void refresh();
      });
    return()=>{alive=false;realtimeRef.current=false;setRealtime(false);void supabase().removeChannel(channel);};
  },[id,role,userId,displayToken,refresh,state?.controllerOwned]);
  useEffect(()=>{
    if(!userId)return;
    let stop=false;
    let timer:ReturnType<typeof setTimeout>;
    const poll=()=>{
      // A short fallback cadence lets the server reveal individual Toss-Up
      // letters even when every client is already subscribed to Realtime.
      const phase=reference.current?.phase;
      const timedReveal=phase==='tossup'||phase==='tieTossup';
      // A 4.2-second server-authoritative spin must be reconciled promptly
      // even when subscribed to Realtime (which only announces saved changes).
      const spinning=phase==='spinning';
      const delay=spinning?1200:role==='audience'&&displayToken?2500
        :timedReveal?2200:realtimeRef.current?10000:3000;
      timer=setTimeout(async()=>{await refresh();if(!stop)poll();},delay+Math.random()*250);
    };
    poll();
    const focus=()=>{if(document.visibilityState==='visible')void refresh();};
    window.addEventListener('online',focus);window.addEventListener('focus',focus);
    document.addEventListener('visibilitychange',focus);
    return()=>{stop=true;clearTimeout(timer);window.removeEventListener('online',focus);
      window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus);};
  },[userId,refresh,role,displayToken]);
  const send=useCallback(async(command:Command,quiet=false)=>{
    const current=reference.current;
    if(!current)return false;
    if(command.type==='heartbeat'){
      if(heartbeatBusy.current)return false;
      heartbeatBusy.current=true;
    }
    if(!quiet){setBusy(true);setError('');}
    const n=++seq.current;
    try{
      const next=await api<SessionView|{kind:'heartbeat';serverNow:number;needsRefresh?:boolean}>(
        'sessions/'+id+'/command','POST',{
          command,actionId:crypto.randomUUID(),version:current.actionVersion,
          ...(controller?{controller}:{})
        },controller||undefined,command.type==='heartbeat'?8000:15000);
      if('kind' in next){
        offset.current=next.serverNow-Date.now();
        if(next.needsRefresh)void refresh();
        if(n>=lastGood.current){lastGood.current=n;setConnected(true);}
      }else accept(next,n);
      return true;
    }catch(e){
      if(e instanceof ApiError&&e.status>=400&&e.status<500&&e.status!==401){
        if(!quiet)setError(e.message);
      }else {setConnected(false);setError((e as Error).message);}
      if(command.type!=='heartbeat')void refresh();
      return false;
    }finally{
      if(command.type==='heartbeat')heartbeatBusy.current=false;
      if(!quiet)setBusy(false);
    }
  },[id,controller,accept,refresh]);
  useEffect(()=>{
    if(!userId||role==='audience')return;
    const timer=setInterval(()=>{
      const s=reference.current;
      if(!s||['finished','ended'].includes(s.phase))return;
      if(role==='host'&&!s.controllerOwned)return;
      void send({type:'heartbeat'},true);
    },5000);
    return()=>clearInterval(timer);
  },[userId,role,send]);
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()+offset.current),100);return()=>clearInterval(timer);},[]);
  const remaining=state?.deadline!==undefined?Math.max(0,state.deadline-now):state?.remaining??0;
  useEffect(()=>{if(state?.deadline!==undefined&&remaining<=0)void refresh();},
    [remaining<=0,state?.deadline,refresh]);
  return {state,userId,controller,error,connected,busy,realtime,send,refresh,remaining,now};
}
