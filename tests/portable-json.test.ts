import {describe,it,expect} from 'vitest';
import {starterGame,emptyGame} from '@/lib/game/starter';
import {gameToPortableJson,parsePortableGameJson,portableJsonToGame,MAX_GAME_JSON_LENGTH} from '@/lib/game/portable-json';
import {gameSchema} from '@/lib/game/schema';

const ids=(game:ReturnType<typeof starterGame>)=>[
  ...game.rounds.map(r=>r.id),
  ...game.rounds.flatMap(r=>r.puzzles.map(p=>p.id)),
  ...game.bonus.puzzles.map(p=>p.id),game.tiebreaker.id
];
describe('portable ID-free Wheel of Fortune JSON',()=>{
  it('exports a complete show without any internal UUIDs, including the tiebreaker and bonus',()=>{
    const game=starterGame();
    const portable=gameToPortableJson(game);
    expect(JSON.stringify(portable)).not.toContain('"id"');
    expect(portable.rounds).toHaveLength(6);
    expect(portable.bonus.puzzles).toHaveLength(3);
    expect(portable.rounds[3].prize?.value).toBe(8000);
  });
  it('generates unique UUIDs for all round and puzzle entries when importing',()=>{
    const old=starterGame();
    const parsed=parsePortableGameJson(JSON.stringify(gameToPortableJson(old)));
    expect(gameSchema.parse(parsed)).toBeTruthy();
    expect(new Set(ids(parsed)).size).toBe(ids(parsed).length);
    for(const id of ids(parsed))expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i);
    expect(ids(parsed)).not.toEqual(ids(old));
    expect(gameToPortableJson(parsed)).toEqual(gameToPortableJson(old));
  });
  it('still imports legacy game JSON containing UUIDs, regenerating them to avoid clashes',()=>{
    const old=starterGame();
    const imported=portableJsonToGame(old);
    expect(gameToPortableJson(imported)).toEqual(gameToPortableJson(old));
    expect(ids(imported)).not.toEqual(ids(old));
  });
  it('accepts incomplete draft answers but rejects bad round sequence',()=>{
    const draft=emptyGame();
    expect(gameSchema.parse(portableJsonToGame(gameToPortableJson(draft)))).toBeTruthy();
    const bad=gameToPortableJson(starterGame());
    const reverse=structuredClone(bad);
    reverse.rounds.reverse();
    expect(()=>portableJsonToGame(reverse)).toThrow();
  });
  it('rejects invalid JSON, unsupported properties, and oversized payloads',()=>{
    expect(()=>parsePortableGameJson('oops')).toThrow('Invalid JSON');
    expect(()=>parsePortableGameJson('   ')).toThrow('Paste');
    expect(()=>parsePortableGameJson('x'.repeat(MAX_GAME_JSON_LENGTH+1))).toThrow('too large');
    expect(()=>portableJsonToGame({...gameToPortableJson(starterGame()),pin:'123456'})).toThrow();
  });
});
