import { z } from 'zod';
export const pinSchema=z.string().regex(/^\d{6}$/,'Enter exactly six digits.');
const text=(max:number)=>z.string().trim().max(max);
export const puzzleSchema=z.object({id:z.string().uuid(),category:text(80),answer:text(160),hint:text(300).optional()}).strict();
export const prizeSchema=z.object({label:text(80),value:z.number().int().min(0).max(1000000)}).strict();
export const roundSchema=z.object({
  id:z.string().uuid(),kind:z.enum(['tossup','regular','mystery','prize','triple','final']),
  title:text(100).min(1),puzzles:z.array(puzzleSchema).min(1).max(12),prize:prizeSchema.optional()
}).strict();
export const gameSchema=z.object({
  title:text(100).min(1),
  opening:z.enum(['traditional','frenzy']),
  rounds:z.array(roundSchema).length(6),
  bonus:z.object({puzzles:z.array(puzzleSchema).length(3),envelopes:z.array(prizeSchema).min(1).max(24)}).strict(),
  tiebreaker:puzzleSchema
}).strict().superRefine((g,ctx)=>{
  const kinds=['tossup','regular','mystery','prize','triple','final'];
  const minimum=[g.opening==='traditional'?2:1,1,1,1,3,1];
  const ids=new Set<string>();
  for(let i=0;i<g.rounds.length;i++){
    const r=g.rounds[i];
    if(r.kind!==kinds[i]||r.puzzles.length<minimum[i])ctx.addIssue({code:'custom',path:['rounds',i],message:'Invalid round sequence or missing puzzles'});
    for(const p of r.puzzles){
      if(ids.has(p.id))ctx.addIssue({code:'custom',message:'Duplicate puzzle ID'});
      ids.add(p.id);
    }
  }
  for(const p of [...g.bonus.puzzles,g.tiebreaker]){
    if(ids.has(p.id))ctx.addIssue({code:'custom',message:'Duplicate puzzle ID'});
    ids.add(p.id);
  }
});
export type GameInput=z.infer<typeof gameSchema>;
export function playable(input:unknown):asserts input is GameInput{
  const game=gameSchema.parse(input);
  const puzzles=[...game.rounds.flatMap(r=>r.puzzles),...game.bonus.puzzles,game.tiebreaker];
  if(puzzles.some(p=>!p.answer.trim()||!p.category.trim()))throw new Error('Complete every puzzle category and solution before starting.');
  if(puzzles.some(p=>!/^[A-Za-z0-9 &'\-.,!?/]+$/.test(p.answer)))
    throw new Error('Puzzle answers must use supported letters, numbers, spaces and common punctuation.');
}
export const commandSchema=z.discriminatedUnion('type',[
  z.object({type:z.literal('join'),name:text(24).min(1)}).strict(),
  z.object({type:z.literal('claim'),pin:pinSchema,controller:z.string().uuid()}).strict(),
  z.object({type:z.literal('heartbeat')}).strict(),
  z.object({type:z.literal('pause')}).strict(),z.object({type:z.literal('continue')}).strict(),
  z.object({type:z.literal('lockLobby'),locked:z.boolean()}).strict(),
  z.object({type:z.literal('remove'),playerId:z.string().uuid()}).strict(),
  z.object({type:z.literal('start')}).strict(),z.object({type:z.literal('nextRound')}).strict(),
  z.object({type:z.literal('revealLetter')}).strict(),
  z.object({type:z.literal('buzz'),windowId:z.string().uuid()}).strict(),
  z.object({type:z.literal('judgeBuzz'),correct:z.boolean()}).strict(),
  z.object({type:z.literal('spin')}).strict(),
  z.object({type:z.literal('buyVowel')}).strict(),
  z.object({type:z.literal('letter'),letter:z.string().regex(/^[A-Za-z]$/)}).strict(),
  z.object({type:z.literal('solve'),text:text(180).min(1)}).strict(),
  z.object({type:z.literal('hostSolve'),playerId:z.string().uuid()}).strict(),
  z.object({type:z.literal('mystery'),reveal:z.boolean()}).strict(),
  z.object({type:z.literal('express'),accept:z.boolean()}).strict(),
  z.object({type:z.literal('speedUp')}).strict(),
  z.object({type:z.literal('pass')}).strict(),
  z.object({type:z.literal('chooseBonus'),index:z.number().int().min(0).max(2)}).strict(),
  z.object({type:z.literal('spinBonus')}).strict(),
  z.object({type:z.literal('bonusLetter'),letter:z.string().regex(/^[A-Za-z]$/)}).strict(),
  z.object({type:z.literal('startBonus')}).strict(),
  z.object({type:z.literal('bonusSolve'),text:text(180).min(1)}).strict(),
  z.object({type:z.literal('bonusJudge'),correct:z.boolean()}).strict(),
  z.object({type:z.literal('finish')}).strict(),
  z.object({type:z.literal('undo')}).strict(),
  z.object({type:z.literal('end')}).strict()
]);
export type Command=z.infer<typeof commandSchema>;
export const envelopeSchema=z.object({
  actionId:z.string().uuid(),version:z.number().int().min(0),
  controller:z.string().uuid().optional(),command:commandSchema
}).strict();
export const saveSchema=z.object({definition:gameSchema,pin:pinSchema.optional(),version:z.number().int().min(0).optional()}).strict();
