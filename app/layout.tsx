import type {Metadata} from 'next';
import Link from 'next/link';
import './globals.css';
export const metadata:Metadata={
  title:'Fortune Live | Spin. Solve. Celebrate.',
  description:'A live multiplayer Wheel of Fortune inspired game for hosts, players and audiences.'
};
export default function RootLayout({children}:{children:React.ReactNode}){
  return <html lang="en"><body>
    <div className="ambient ambient-one"/><div className="ambient ambient-two"/>
    <header className="site-header"><Link className="brand" href="/">
      <span className="brand-symbol">✦</span>
      <span>FORTUNE<span className="brand-gold">LIVE</span></span>
    </Link><nav><Link href="/host">Host Game</Link><Link href="/join">Join Game</Link></nav></header>
    {children}
    <footer className="site-footer">Fortune Live · A fan-made interactive game-night experience.</footer>
  </body></html>;
}
