import {z} from 'zod';
import {gameSchema,prizeSchema} from './schema';
import type {GameDefinition,GameRound,Puzzle} from './types';

/**
 * Portable authoring format: UUIDs belong to the database/editor, not to
 * user-authored JSON. Legacy exports with IDs still import, but IDs are
 * regenerated after successful validation to avoid collisions.
 */
export const MAX_GAME_JSON_LENGTH=600000;
const text=(max:number)=>z.string().trim().max(max);
const portablePuzzle=z.object({
  id:z.string().uuid().optional(),category:text(80),answer:text(160),hint:text(300).optional()
}).strict();
const portableRound=z.object({
  id:z.string().uuid().optional(),
  kind:z.enum(['tossup','regular','mystery','prize','triple','final']),
  title:text(100).min(1),puzzles:z.array(portablePuzzle).min(1).max(12),
  prize:prizeSchema.optional()
}).strict();
export const portableGameSchema=z.object({
  title:text(100).min(1),
  opening:z.enum(['traditional','frenzy']),
  rounds:z.array(portableRound).length(6),
  bonus:z.object({
    puzzles:z.array(portablePuzzle).length(3),
    envelopes:z.array(prizeSchema).min(1).max(24)
  }).strict(),
  tiebreaker:portablePuzzle
}).strict();

function withoutPuzzleId(p:Puzzle){
  return {category:p.category,answer:p.answer,...(p.hint===undefined?{}:{hint:p.hint})};
}
export function gameToPortableJson(game:GameDefinition){
  return {
    title:game.title,opening:game.opening,
    rounds:game.rounds.map((r:GameRound)=>({
      kind:r.kind,title:r.title,puzzles:r.puzzles.map(withoutPuzzleId),
      ...(r.prize===undefined?{}:{prize:{...r.prize}})
    })),
    bonus:{puzzles:game.bonus.puzzles.map(withoutPuzzleId),
      envelopes:game.bonus.envelopes.map(p=>({...p}))},
    tiebreaker:withoutPuzzleId(game.tiebreaker)
  };
}
export function portableJsonToGame(input:unknown):GameDefinition{
  const source=portableGameSchema.parse(input);
  const puzzle=(p:z.infer<typeof portablePuzzle>):Puzzle=>({
    id:crypto.randomUUID(),category:p.category,answer:p.answer,
    ...(p.hint===undefined?{}:{hint:p.hint})
  });
  // Run the existing game schema's round sequence and duplicate ID checks.
  return gameSchema.parse({
    title:source.title,opening:source.opening,
    rounds:source.rounds.map(r=>({
      id:crypto.randomUUID(),kind:r.kind,title:r.title,
      puzzles:r.puzzles.map(puzzle),
      ...(r.prize===undefined?{}:{prize:r.prize})
    })),
    bonus:{puzzles:source.bonus.puzzles.map(puzzle),envelopes:source.bonus.envelopes},
    tiebreaker:puzzle(source.tiebreaker)
  });
}
export function parsePortableGameJson(text:string):GameDefinition{
  if(text.length>MAX_GAME_JSON_LENGTH)throw new Error('Game JSON is too large (600,000 characters maximum).');
  if(!text.trim())throw new Error('Paste a game JSON first.');
  let parsed:unknown;
  try{parsed=JSON.parse(text);}
  catch{throw new Error('Invalid JSON. Check quotes, commas and brackets.');}
  return portableJsonToGame(parsed);
}
