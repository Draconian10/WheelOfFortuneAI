import type {SessionView} from '@/lib/game/types';
export default function PuzzleBoard({s,small=false}:{s:SessionView;small?:boolean}){
  const tiles=s.puzzle.tiles,words:string[][]=[];
  let current:string[]=[];
  for(const tile of tiles){
    if(tile===' '){if(current.length)words.push(current);current=[];}
    else current.push(tile);
  }
  if(current.length)words.push(current);
  return <section className={'puzzle-display '+(small?'puzzle-small':'')}>
    <div className="puzzle-category">{s.puzzle.category||'WORD PUZZLE'}</div>
    <div className="puzzle-tiles" aria-label="Puzzle letters, with hidden letters shown as blanks">
      {words.map((word,i)=><div className="puzzle-word" key={i}>
        {word.map((letter,j)=>{
          const punctuation=!!letter&&!/[A-Z0-9]/.test(letter);
          const shown=!!letter;
          return <span key={j} className={'puzzle-tile '+(shown?'revealed':'hidden')+(punctuation?' punctuation':'')}
            aria-label={shown?'Letter '+letter:'Hidden letter'}>{letter}</span>;
        })}
      </div>)}
    </div>
    {s.puzzle.answer&&['roundResult','bonusResult','finished','ended'].includes(s.phase)&&
      <div className="puzzle-solution"><span>SOLUTION</span><strong>{s.puzzle.answer}</strong></div>}
  </section>;
}
