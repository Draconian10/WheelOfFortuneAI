import type {Metadata} from 'next';
import SiteHeader from '@/components/site-header';
import './globals.css';
import './ui-refresh.css';
import './broadcast.css';
import './round-transitions.css';
import './gameplay-polish.css';
export const metadata:Metadata={
  title:'Fortune Live | Spin. Solve. Celebrate.',
  description:'A live multiplayer Wheel of Fortune inspired game for hosts, players and audiences.'
};
export default function RootLayout({children}:{children:React.ReactNode}){
  return <html lang="en"><body>
    <div className="ambient ambient-one"/><div className="ambient ambient-two"/>
    <SiteHeader/>
    {children}
    <footer className="site-footer">Fortune Live · A fan-made interactive game-night experience.</footer>
  </body></html>;
}
