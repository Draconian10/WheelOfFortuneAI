import Session from '@/components/session';
export default async function HostSessionPage({params}:{params:Promise<{id:string}>}){
  return <Session id={(await params).id} role="host"/>;
}
