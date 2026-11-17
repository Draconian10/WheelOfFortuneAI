/** Completed game navigation returns to the homepage for all roles. */
export function sessionReturnHref(role:'host'|'player'|'audience',ended:boolean):string{
  if(ended)return '/';
  return role==='host'?'/host':role==='player'?'/join':'/';
}
