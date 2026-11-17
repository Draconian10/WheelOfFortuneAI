import Link from 'next/link';
import {ArrowRight,Monitor,Smartphone,Users,Trophy,RadioTower} from 'lucide-react';
import Wheel from '@/components/wheel';
export default function Home(){
  return <main className="container home-page">
    <section className="hero-layout">
      <div className="hero-copy">
        <div className="eyebrow hero-kicker"><span className="live-dot"/> THE ULTIMATE GAME NIGHT</div>
        <h1>Make every spin <span className="gold-text">legendary.</span></h1>
        <p className="hero-description">The classic wheel. The suspenseful puzzle board. The thrill of buzzing in first. All together, live on your screens.</p>
        <div className="entry-grid">
          <Link href="/host" className="entry-card host-entry">
            <div className="entry-icon"><Monitor size={30}/></div>
            <h2>Host Game</h2><p>Build puzzles and run your show from a laptop.</p>
            <span>Enter Host Studio <ArrowRight size={18}/></span>
          </Link>
          <Link href="/join" className="entry-card player-entry">
            <div className="entry-icon"><Smartphone size={30}/></div>
            <h2>Join Game</h2><p>Grab your phone, buzz in, and claim the spotlight.</p>
            <span>Join the Fun <ArrowRight size={18}/></span>
          </Link>
        </div>
        <div className="hero-features"><span><Users size={17}/> 1–5 live contestants</span>
          <span><RadioTower size={17}/> Real-time buzzers</span>
          <span><Trophy size={17}/> Animated standings</span></div>
      </div>
      <div className="hero-wheel"><div className="hero-wheel-halo"/><Wheel kind="tossup"/>
        <div className="hero-wheel-caption">SPIN THE WHEEL. CHASE YOUR FORTUNE.</div></div>
    </section>
  </main>;
}
