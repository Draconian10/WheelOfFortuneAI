import Session from '@/components/session';
export default async function DisplayPage({params,searchParams}:{
  params:Promise<{id:string}>;searchParams:Promise<{token?:string}>}){
  const {id}=await params,{token}=await searchParams;
  return <Session id={id} role="audience" displayToken={token}/>;
}
