export type RoundKind = 'tossup' | 'regular' | 'mystery' | 'prize' | 'triple' | 'final';
export type WedgeKind = 'cash' | 'bankrupt' | 'lose' | 'free' | 'wild' | 'mystery' | 'express' | 'million';
export type Phase =
  | 'lobby' | 'tossup' | 'tossupAnswer' | 'turn' | 'letter' | 'mysteryChoice'
  | 'expressChoice' | 'express' | 'speedup' | 'roundResult' | 'tieTossup'
  | 'tieAnswer' | 'bonusCategory' | 'bonusSpin' | 'bonusLetters' | 'bonusTimer'
  | 'bonusResult' | 'finished' | 'ended';
export interface Puzzle { id: string; category: string; answer: string; hint?: string; }
export interface Prize { label: string; value: number; }
export interface GameRound {
  id: string;
  kind: RoundKind;
  title: string;
  puzzles: Puzzle[];
  prize?: Prize;
}
export interface GameDefinition {
  title: string;
  opening: 'traditional' | 'frenzy';
  rounds: GameRound[];
  bonus: { puzzles: Puzzle[]; envelopes: Prize[] };
  tiebreaker: Puzzle;
}
export interface Wedge { kind: WedgeKind; label: string; value: number; color: string; }
export interface Player {
  id: string;
  name: string;
  seat: number;
  banked: number;
  roundMoney: number;
  prizes: Prize[];
  pendingPrizes: Prize[];
  wildCard: boolean;
  millionWedge: boolean;
  removed: boolean;
  lastSeen: number;
}
export interface Spin { id: string; index: number; wedge: Wedge; playerId: string; sequence: number; }
export interface ScoreEvent {
  id: string;
  playerId: string;
  delta: number;
  reason: string;
  round: number;
  at: number;
}
export interface GameState {
  id: string;
  gameId: string;
  title: string;
  hostId: string;
  joinCode: string;
  definition: GameDefinition;
  version: number;
  actionVersion: number;
  controller?: string;
  hostSeen: number;
  paused: boolean;
  pauseReason?: string;
  locked: boolean;
  phase: Phase;
  roundIndex: number;
  puzzleIndex: number;
  players: Player[];
  currentPlayerId?: string;
  roundStarterId?: string;
  respondent?: string;
  windowId?: string;
  attempted: string[];
  revealed: string[];
  usedLetters: string[];
  spin?: Spin;
  pendingSpin?: Spin;
  mysteryCash?: number;
  lastAction?: string;
  deadline?: number;
  remaining?: number;
  speedupValue?: number;
  speedupCanSolve?: boolean;
  bonusPlayerId?: string;
  bonusPuzzleIndex?: number;
  bonusEnvelopeIndex?: number;
  bonusLetters: string[];
  bonusWon?: boolean;
  tripleWinners: string[];
  tieEligible?: string[];
  events: ScoreEvent[];
  processed: string[];
  // A checkpoint also restores the event ledger; no reversal may cross a completed puzzle.
  undo?: Omit<GameState,'undo'>;
  createdAt: number;
  updatedAt: number;
}
export interface Context {
  userId: string;
  actionId: string;
  now: number;
  expectedVersion: number;
  controller?: string;
  pinVerified?: boolean;
  random?: (count: number) => number;
}
export interface SessionView {
  id: string; gameId: string; title: string; joinCode: string;
  phase: Phase; version: number; actionVersion: number;
  roundIndex: number; totalRounds: number; roundTitle: string; roundKind: RoundKind | 'bonus' | 'tie';
  puzzleIndex: number; puzzlesInRound: number;
  puzzle: { category: string; tiles: string[]; answer?: string; hint?: string };
  players: Player[];
  currentPlayerId?: string; respondent?: string; windowId?: string; attempted: string[];
  revealed: string[]; usedLetters: string[]; spin?: Spin; pendingSpin?: Spin;
  lastAction?: string; deadline?: number; remaining?: number;
  speedupValue?: number; speedupCanSolve?: boolean;
  bonusPlayerId?: string; bonusPuzzleIndex?: number;
  bonusCategories?: string[]; bonusLetters: string[]; bonusPrize?: Prize; bonusWon?: boolean;
  tripleWinners: string[]; tieEligible?: string[];
  events: ScoreEvent[];
  paused: boolean; pauseReason?: string; locked: boolean;
  controllerOwned: boolean; hostConnected: boolean; serverNow: number;
  canUndo: boolean; createdAt: number; runtimeAt?: number;
}
