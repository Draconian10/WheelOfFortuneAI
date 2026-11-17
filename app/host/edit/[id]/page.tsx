import Editor from '@/components/editor';
export default async function EditPage({params}:{params:Promise<{id:string}>}){
  return <Editor id={(await params).id}/>;
}
