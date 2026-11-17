import type { GameDefinition, GameRound, Puzzle } from './types';
const puzzle=(category:string,answer:string):Puzzle=>({id:crypto.randomUUID(),category,answer,hint:''});
export function starterGame():GameDefinition {
  const round=(kind:GameRound['kind'],title:string, answers:[string,string][],prize?:GameRound['prize']):GameRound=>({
    id:crypto.randomUUID(),kind,title,puzzles:answers.map(([category,answer])=>puzzle(category,answer)),
    ...(prize?{prize}:{})
  });
  return {
    title:'Friday Night Fortune',
    opening:'frenzy',
    rounds:[
      round('tossup','Fortune Frenzy',[['Phrase','LET THE GOOD TIMES ROLL'],['Food & Drink','FRESHLY BAKED COOKIES'],['Thing','A BRIGHT IDEA']]),
      round('regular','Round 1 · The First Spin',[['Phrase','THE FUTURE IS BRIGHT']]),
      round('mystery','Round 2 · Mystery',[['Before & After','GOLDEN STATE OF MIND']]),
      round('prize','Round 3 · Prize Puzzle',[['Place','A TROPICAL PARADISE']],{label:'Dream vacation',value:8000}),
      round('triple','Triple Toss-Up',[['Event','THE BIG CELEBRATION'],['Thing','A STANDING OVATION'],['Phrase','WINNING IS EVERYTHING']]),
      round('final','Round 4 · Final Spin',[['Food & Drink','CHOCOLATE CHIP PANCAKES']])
    ],
    bonus:{puzzles:[puzzle('Phrase','A DREAM COME TRUE'),puzzle('Thing','A PERFECT FIT'),puzzle('What Are You Doing?','LIVING MY BEST LIFE')],
       envelopes:[{label:'$40,000',value:40000},{label:'$45,000',value:45000},{label:'$50,000',value:50000},{label:'$75,000',value:75000},{label:'$100,000',value:100000}]},
    tiebreaker:puzzle('Phrase','LUCK OF THE DRAW')
  };
}
export function emptyGame():GameDefinition {
  const d=starterGame();d.title='My Wheel of Fortune Game';
  for(const r of d.rounds) for(const p of r.puzzles){p.answer='';p.hint='';}
  for(const p of d.bonus.puzzles){p.answer='';p.hint='';}
  d.tiebreaker.answer='';
  return d;
}
