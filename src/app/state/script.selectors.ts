import { ScriptState } from './script.reducer';
import { ActorQuestion, questionFlags, ScriptVersion, sortQuestions } from './script';

export interface EnrichedQuestion extends ActorQuestion {
  version?: ScriptVersion;
  flags: ReturnType<typeof questionFlags>;
}

export function enrichQuestions(questions: ActorQuestion[], versions: ScriptVersion[]): EnrichedQuestion[] {
  const byId = new Map(versions.map((version) => [version.id, version]));
  return sortQuestions(
    questions.map((q) => {
      const version = byId.get(q.versionId);
      return { ...q, version, flags: questionFlags(q, version) };
    }),
    (q) => byId.get(q.versionId)
  );
}

export function openArbitrationCount(state: ScriptState): number {
  return state.arbitration.filter((item) => item.open).length;
}

export function pendingChangeCount(state: ScriptState): number {
  return state.pendingChanges.length;
}

export function outboxCount(state: ScriptState): number {
  return state.questions.filter((q) => !q.synced).length;
}
