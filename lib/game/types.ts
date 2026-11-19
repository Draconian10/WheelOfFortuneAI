export type RoundKind = 'tossup' | 'regular' | 'mystery' | 'prize' | 'triple' | 'final';
export type WedgeKind = 'cash' | 'bankrupt' | 'lose' | 'free' | 'wild' | 'mystery' | 'express' | 'million';
export type Phase =
  | 'lobby' | 'tossup' | 'tossupAnswer' | 'turn' | 'spinning' | 'letter' | 'wildLetter' | 'mysteryChoice'
  | 'expressChoice' | 'express' | 'finalSpinning' | 'speedup' | 'speedupAnswer' | 'roundResult' | 'tieTossup'
  | 'tieAnswer' | 'bonusCategory' | 'bonusSpin' | 'bonusSpinning' | 'bonusLetters' | 'bonusTimer'
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
  /** Collected this round; active only if the holder solves that puzzle. */
  pendingMillionWedge?: boolean;
  removed: boolean;
  lastSeen: number;
}
export interface MysteryReveal { index: number; outcome: 'prize' | 'bankrupt'; }
export interface Spin { id: string; index: number; wedge: Wedge; playerId: string; sequence: number; startedAt?: number; }
export interface ScoreEvent {
  id: string;
  playerId: string;
  delta: number;
  reason: string;
  round: number;
  /** Zero-based puzzle index at the moment points were awarded. */
  puzzleIndex?: number;
  at: number;
}
/** Internal host-export-only audit trail, not included in audience/player views. */
export interface GameHistoryEntry {
  at: number;
  actorId?: string;
  subjectId?: string;
  action: string;
  stageIndex: number;
  puzzleIndex: number;
  phase: Phase;
  detail: string;
  /** Letter or typed response when supplied; never stores host PINs. */
  input?: string;
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
  /** True when the host ended a room before starting the show. */
  closedInLobby?: boolean;
  roundIndex: number;
  puzzleIndex: number;
  /** Server timestamp of the current round entrance, not a client animation clock. */
  roundBeganAt?: number;
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
  /** Secret server-side winning wedge, selected once when Mystery Round starts. */
  mysteryPrizeIndex?: number;
  /** Only revealed outcomes are included in the audience and player projections. */
  mysteryReveals?: MysteryReveal[];
  lastAction?: string;
  deadline?: number;
  /** Wait until the broadcast wheel has completed before resolving the wedge. */
  spinEndsAt?: number;
  /** Legacy time field for sessions created before the per-puzzle countdown fix. */
  frenzyRemaining?: number;
  /** The buzzer countdown expired without a correct solve; do not expose the answer until the host reveals it. */
  puzzleTimedOut?: boolean;
  puzzleStartedAt?: number;
  answerStartedAt?: number;
  pausedAt?: number;
  remaining?: number;
  speedupValue?: number;
  speedupCanSolve?: boolean;
  /** Cash-per-consonant available for the Wild Card's extra guess. */
  wildCardValue?: number;
  bonusPlayerId?: string;
  bonusPuzzleIndex?: number;
  bonusEnvelopeIndex?: number;
  bonusLetters: string[];
  bonusWon?: boolean;
  tripleWinners: string[];
  tieEligible?: string[];
  events: ScoreEvent[];
  /** Optional for compatibility with sessions created before activity reporting. */
  history?: GameHistoryEntry[];
  /** Only the immediately preceding letter command may be reversed. */
  lastLetterActionVersion?: number;
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
  closedInLobby?: boolean;
  roundIndex: number; totalRounds: number; roundBeganAt?: number; roundTitle: string; roundKind: RoundKind | 'bonus' | 'tie';
  puzzleIndex: number; puzzlesInRound: number;
  puzzle: { category: string; tiles: string[]; answer?: string; hint?: string };
  players: Player[];
  currentPlayerId?: string; respondent?: string; windowId?: string; attempted: string[];
  revealed: string[]; usedLetters: string[]; spin?: Spin; pendingSpin?: Spin;
  mysteryReveals?: MysteryReveal[];
  lastAction?: string; deadline?: number; remaining?: number; spinEndsAt?: number; frenzyRemaining?: number;
  puzzleTimedOut?: boolean;
  speedupValue?: number; speedupCanSolve?: boolean; wildCardValue?: number;
  bonusPlayerId?: string; bonusPuzzleIndex?: number;
  bonusCategories?: string[]; bonusLetters: string[]; bonusPrize?: Prize; bonusWon?: boolean;
  tripleWinners: string[]; tieEligible?: string[];
  events: ScoreEvent[];
  paused: boolean; pauseReason?: string; locked: boolean;
  controllerOwned: boolean; hostConnected: boolean; serverNow: number;
  canUndo: boolean; canUndoLetter?: boolean; createdAt: number; runtimeAt?: number;
}
