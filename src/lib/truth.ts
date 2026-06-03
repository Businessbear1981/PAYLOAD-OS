// Truth layer — output verification for AI agent claims.
//
// Two surfaces:
//   * verify(claim, opts) — check a claim against sources, return verdict
//   * gate(claim, opts)   — verify + throw if confidence below threshold
//
// Every check logs to the truth_checks table so the /audit page can show
// per-agent truth-pass rate over time.
//
// Verification tiers (pick one or more):
//   - 'db'                — does a SQL query find supporting rows?
//   - 'web'               — does a web search corroborate?
//   - 'self_consistency'  — does the same model answer consistently across N samples?
//   - 'multi_model'       — does a different model agree?
//   - 'depscope'          — for code claims, do the named packages actually exist?
//   - 'cove'              — Chain-of-Verification: model proposes its own verification questions
//
// This module is a thin runtime — heavy lifting (web search, multi-model
// orchestration) goes to your agent layer. The module's job is logging +
// gating.

import {createClient as createSupa} from '@supabase/supabase-js';
import {complete} from './ai';

export type Tier = 'db' | 'web' | 'self_consistency' | 'multi_model' | 'depscope' | 'cove';

export type TruthSource =
  | {type: 'db'; table: string; row_id?: string; query?: string}
  | {type: 'web'; url: string; title?: string}
  | {type: 'model'; name: string; agrees: boolean}
  | {type: 'static'; note: string};

export type Verdict = 'verified' | 'contradicted' | 'unverifiable' | 'warn';

export type TruthResult = {
  verdict: Verdict;
  confidence: number;        // 0..1
  tier: Tier;
  sources: TruthSource[];
  reasoning?: string;
  latency_ms: number;
};

type TierHandler = (
  claim: string,
) => Promise<{verdict: Verdict; confidence: number; sources: TruthSource[]; reasoning?: string}>;

export type VerifyOpts = {
  against: Tier[];
  runId?: string;            // links to runs.id from the agents data engine
  agentId?: string;
  // Per-tier handlers. The defaults below cover self_consistency + cove via the
  // AI Gateway. db / web / multi_model / depscope are project-specific —
  // override these in the call.
  handlers?: Partial<Record<Tier, TierHandler>>;
};

function admin() {
  return createSupa(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {auth: {persistSession: false}},
  );
}

export async function verify(claim: string, opts: VerifyOpts): Promise<TruthResult[]> {
  const results: TruthResult[] = [];

  for (const tier of opts.against) {
    const start = Date.now();
    const handler = opts.handlers?.[tier] ?? defaultHandlers[tier];
    if (!handler) {
      results.push({
        verdict: 'unverifiable',
        confidence: 0,
        tier,
        sources: [],
        reasoning: `no handler registered for tier "${tier}"`,
        latency_ms: 0,
      });
      continue;
    }
    try {
      const r = await handler(claim);
      const result: TruthResult = {
        ...r,
        tier,
        latency_ms: Date.now() - start,
      };
      results.push(result);

      // Log to truth_checks
      await admin().from('truth_checks').insert({
        run_id: opts.runId ?? null,
        agent_id: opts.agentId ?? null,
        claim,
        verdict: result.verdict,
        confidence: result.confidence,
        tier,
        sources: result.sources,
        latency_ms: result.latency_ms,
        reasoning: result.reasoning,
      });
    } catch (err) {
      results.push({
        verdict: 'unverifiable',
        confidence: 0,
        tier,
        sources: [],
        reasoning: err instanceof Error ? err.message : String(err),
        latency_ms: Date.now() - start,
      });
    }
  }

  return results;
}

export type GateOpts = VerifyOpts & {
  threshold?: number;   // default 0.7
  requireAll?: boolean; // default false — true means every tier must verify
};

export class UnverifiedError extends Error {
  constructor(public claim: string, public results: TruthResult[]) {
    super(`Claim failed truth gate: "${claim.slice(0, 120)}…"`);
    this.name = 'UnverifiedError';
  }
}

// gate() throws if the claim doesn't meet the threshold. Use to block a
// response from reaching the user when high-stakes (financial, medical, legal).
export async function gate(claim: string, opts: GateOpts): Promise<TruthResult[]> {
  const results = await verify(claim, opts);
  const threshold = opts.threshold ?? 0.7;
  const pass = opts.requireAll
    ? results.every((r) => r.verdict === 'verified' && r.confidence >= threshold)
    : results.some((r) => r.verdict === 'verified' && r.confidence >= threshold);
  if (!pass) {
    // mark each row as gated
    await admin().from('truth_checks').update({gated: true}).match({
      claim,
      run_id: opts.runId ?? null,
    });
    throw new UnverifiedError(claim, results);
  }
  return results;
}

// --- Default handlers --------------------------------------------------------

const defaultHandlers: Partial<Record<Tier, TierHandler>> = {
  self_consistency: async (claim) => {
    // Ask the same model 3 times whether the claim is true; pass if 2/3 agree.
    const votes = await Promise.all(
      [0, 1, 2].map(() => complete(`Is the following claim true? Answer "yes" or "no" only.\n\nClaim: ${claim}`, {system: 'You are a factual oracle. Answer only "yes" or "no".'})),
    );
    const yesCount = votes.filter((v) => v.trim().toLowerCase().startsWith('y')).length;
    return {
      verdict: yesCount >= 2 ? 'verified' : 'contradicted',
      confidence: yesCount / 3,
      sources: votes.map((v, i) => ({type: 'model' as const, name: `self#${i}`, agrees: v.trim().toLowerCase().startsWith('y')})),
      reasoning: `${yesCount}/3 self-consistency votes`,
    };
  },

  cove: async (claim) => {
    // Chain-of-Verification: ask the model to propose 3 verification questions,
    // answer them, then judge the original claim.
    const result = await complete(
      `Given this claim, propose 3 verification questions, answer them, then state whether the claim is verified, contradicted, or unverifiable. End with one line: VERDICT: <verified|contradicted|unverifiable> CONFIDENCE: <0.0-1.0>\n\nCLAIM: ${claim}`,
      {system: 'You are a careful fact-checker.'},
    );
    const match = result.match(/VERDICT:\s*(verified|contradicted|unverifiable)\s+CONFIDENCE:\s*([\d.]+)/i);
    if (!match) {
      return {verdict: 'unverifiable', confidence: 0, sources: [], reasoning: 'no VERDICT line in CoVe output'};
    }
    return {
      verdict: match[1].toLowerCase() as Verdict,
      confidence: parseFloat(match[2]),
      sources: [{type: 'static', note: 'CoVe self-check'}],
      reasoning: result.split('\n').slice(0, 3).join(' '),
    };
  },
};
