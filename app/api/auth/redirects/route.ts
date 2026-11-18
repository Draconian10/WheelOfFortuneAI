import {NextRequest,NextResponse} from 'next/server';
import {hostConfirmationRedirect,hostPasswordRecoveryRedirect,publicHostRedirectOrigin} from '@/lib/auth-flow';

export const dynamic='force-dynamic';

// Return only public URLs. Keep preview deployment hosts out of outgoing emails.
export async function GET(req:NextRequest){
  const headers={'Cache-Control':'private, no-store'};
  try{
    const origin=publicHostRedirectOrigin(req.nextUrl.origin,{
      siteUrl:process.env.NEXT_PUBLIC_SITE_URL,
      vercelProductionUrl:process.env.VERCEL_PROJECT_PRODUCTION_URL,
      isVercel:process.env.VERCEL==='1'
    });
    return NextResponse.json({
      confirmation:hostConfirmationRedirect(origin),
      recovery:hostPasswordRecoveryRedirect(origin)
    },{headers});
  }catch{
    return NextResponse.json({
      error:'Email verification is not configured. Set NEXT_PUBLIC_SITE_URL to your public game URL (or enable Vercel system environment variables), then redeploy.'
    },{status:503,headers});
  }
}
