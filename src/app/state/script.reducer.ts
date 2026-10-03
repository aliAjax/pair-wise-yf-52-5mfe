import { createReducer, on } from '@ngrx/store';
import {
  activateVersion,
  addActorQuestion,
  addVersion,
  closeQuestion,
  discardPendingChange,
  flushQuestionOutbox,
  rebasePendingChange,
  reconfirmQuestion,
  reorderLines,
  resolveArbitration,
  retryAllPendingChanges,
  retryPendingChange,
  reviewCue,
  reviewLine,
  setOnline,
  submitPlaywrightDraft,
  toggleRehearsal
} from './script.actions';
import {
  ActorQuestion,
  ArbitrationItem,
  mergePlaywrightDraft,
  PendingChange,
  PlaywrightDraft,
  rebaseDraft,
  resolveArbitration as applyArbitration,
  ScriptVersion
} from './script';

export type { ActorQuestion, ArbitrationItem, PendingChange, PlaywrightDraft, ScriptVersion } from './script';

export interface ScriptState {
  versions: ScriptVersion[];
  activeVersionId: string;
  rehearsalMode: boolean;
  online: boolean;
  pendingChanges: PendingChange[];
  arbitration: ArbitrationItem[];
  questions: ActorQuestion[];
}

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const seedVersions: ScriptVersion[] = [
  {
    id: 'v12', label: '排练稿 v12', playwright: '林编剧', note: '重写第三场父女冲突，舞台灯光提示延后2拍。', revision: 2,
    lines: [
      { id: 'l1', role: '周岚', text: '你每次都说等明天，可舞台不会等我们。', status: 'returned' },
      { id: 'l2', role: '周野', text: '那就让灯灭吧，我早已背熟黑暗。', status: 'accepted' }
    ],
    cues: [
      { id: 'c1', scene: '第三场', text: '侧灯收至30%，雨声渐入', status: 'pending' },
      { id: 'c2', scene: '第三场', text: '周野坐到舞台左前区，保留两拍静默', status: 'accepted' }
    ]
  },
  {
    id: 'v13', label: '排练稿 v13', playwright: '林编剧', note: '调整周岚结论，加入一次性追光变化。', revision: 1,
    lines: [
      { id: 'l1', role: '周岚', text: '你总说明天，但今晚我们必须把话说完。', status: 'pending' },
      { id: 'l3', role: '周岚', text: '看着灯，再说一次你为什么回来。', status: 'pending' }
    ],
    cues: [{ id: 'c3', scene: '第三场', text: '追光由冷白切换至琥珀，等待雨声下落', status: 'pending' }]
  }
];

const staleDraft: PlaywrightDraft = {
  id: 'd1',
  baseVersionId: 'v12',
  baseRevision: 1,
  playwright: '林编剧',
  note: '联排当晚修订：改周岚开场句，并补一句新台词。',
  submittedAt: '2026-10-03T10:20:00.000Z',
  lineChanges: [
    { id: 'l1', role: '周岚', text: '你总说等明天，可今晚这场戏不能再等。' },
    { id: 'l4', role: '周野', text: '灯还没灭，我先替你们把沉默数完。' }
  ],
  cueChanges: [{ id: 'c1', scene: '第三场', text: '侧灯收至20%，雨声提前一小节进入' }]
};

const seedQuestions: ActorQuestion[] = [
  {
    id: 'q1', lineId: 'l1', actor: '陈荻', text: '这句退回了，我该照旧词还是等编剧新稿？',
    versionId: 'v12', versionRevision: 1, synced: true, status: 'open', createdAt: '2026-10-03T09:40:00.000Z'
  },
  {
    id: 'q2', lineId: 'l2', actor: '赵培', text: '“背熟黑暗”前要不要再留一拍？',
    versionId: 'v12', versionRevision: 2, synced: true, status: 'open', createdAt: '2026-10-03T09:55:00.000Z'
  }
];

function buildInitialState(): ScriptState {
  const seeded: ScriptState = {
    versions: seedVersions,
    activeVersionId: 'v12',
    rehearsalMode: false,
    online: true,
    pendingChanges: [
      {
        id: 'pc1',
        kind: 'playwright-draft',
        draft: staleDraft,
        reason: `基线版本已变化（排练稿 v12 从 rev1 推进到 rev2），合并失败，改动未落地。可先变基再合并。`,
        createdAt: '2026-10-03T10:20:30.000Z'
      }
    ],
    arbitration: [],
    questions: seedQuestions
  };
  if (typeof localStorage === 'undefined') return seeded;
  const saved = localStorage.getItem('yf52-script-state');
  if (!saved) return seeded;
  return migrate(JSON.parse(saved) as Partial<ScriptState>, seeded);
}

/** 兼容早期持久化结构：补齐 revision、待处理队列、疑问等新字段 */
function migrate(saved: Partial<ScriptState>, seeded: ScriptState): ScriptState {
  const versions = (saved.versions ?? seeded.versions).map((version) => ({
    ...version,
    revision: typeof version.revision === 'number' ? version.revision : 1
  }));
  return {
    versions,
    activeVersionId: saved.activeVersionId ?? seeded.activeVersionId,
    rehearsalMode: saved.rehearsalMode ?? false,
    online: saved.online ?? true,
    pendingChanges: saved.pendingChanges ?? [],
    arbitration: saved.arbitration ?? [],
    questions: saved.questions ?? []
  };
}

function versionOf(state: ScriptState, versionId: string): ScriptVersion | undefined {
  return state.versions.find((version) => version.id === versionId);
}

/** 尝试合并一份待处理稿件；成功则落地（含挂待裁决）并出队，失败则保留在队列并更新原因 */
function processChange(state: ScriptState, change: PendingChange): { state: ScriptState; change: PendingChange; merged: boolean } {
  const base = versionOf(state, change.draft.baseVersionId);
  if (!base) {
    return { state, change: { ...change, reason: `基线版本 ${change.draft.baseVersionId} 已不存在，无法合并。` }, merged: false };
  }
  const result = mergePlaywrightDraft(base, change.draft, { now: new Date().toISOString(), mkid: () => uid('arb') });
  if (!result.ok || !result.outcome) {
    return { state, change: { ...change, reason: result.error ?? '合并失败' }, merged: false };
  }
  const outcome = result.outcome;
  return {
    state: {
      ...state,
      versions: state.versions.map((version) => (version.id === base.id ? outcome.version : version)),
      arbitration: [...state.arbitration, ...outcome.arbitration]
    },
    change,
    merged: true
  };
}

/** 恢复网络时把离线记的疑问逐条标记为已同步（挂回各自锚定的台词） */
function flushOutbox(state: ScriptState): ScriptState {
  return state.online ? { ...state, questions: state.questions.map((q) => ({ ...q, synced: true })) } : state;
}

function setOnlineState(state: ScriptState, online: boolean): ScriptState {
  if (state.online === online) return state;
  // 恢复网络：待处理改动逐条重试合并，离线疑问逐条同步回来
  return online ? drainQueue(flushOutbox({ ...state, online })) : { ...state, online };
}
function drainQueue(state: ScriptState, changeIds?: string[]): ScriptState {
  if (!state.online) return state;
  let next = state;
  const remaining: PendingChange[] = [];
  for (const change of state.pendingChanges) {
    if (changeIds && !changeIds.includes(change.id)) {
      remaining.push(change);
      continue;
    }
    let updated: PendingChange = change;
    let merged = false;
    ({ state: next, change: updated, merged } = processChange(next, change));
    if (!merged) remaining.push(updated); // 合并失败：改动留在待处理，稍后可继续处理
  }
  return { ...next, pendingChanges: remaining };
}

export const scriptReducer = createReducer(
  buildInitialState(),

  on(addVersion, (state, { version }) => ({ ...state, versions: [...state.versions, version] })),
  on(activateVersion, (state, { id }) => ({ ...state, activeVersionId: id })),

  on(reviewLine, (state, { id, decision }) => ({
    ...state,
    versions: state.versions.map((version) =>
      version.id !== state.activeVersionId
        ? version
        : {
            ...version,
            revision: version.revision + 1, // 监督下了新结论，版本推进
            lines: version.lines.map((line) => (line.id === id ? { ...line, status: decision } : line))
          }
    )
  })),

  on(reviewCue, (state, { id, decision }) => ({
    ...state,
    versions: state.versions.map((version) =>
      version.id !== state.activeVersionId
        ? version
        : {
            ...version,
            revision: version.revision + 1,
            cues: version.cues.map((cue) => (cue.id === id ? { ...cue, status: decision } : cue))
          }
    )
  })),

  on(reorderLines, (state, { from, to }) => ({
    ...state,
    versions: state.versions.map((version) => {
      if (version.id !== state.activeVersionId || from === to) return version;
      const lines = [...version.lines];
      const [moved] = lines.splice(from, 1);
      lines.splice(to, 0, moved);
      return { ...version, lines };
    })
  })),

  on(submitPlaywrightDraft, (state, { draft }) => {
    if (!state.online) {
      // 离线：改动先留待处理，恢复网络再逐条落地
      return {
        ...state,
        pendingChanges: [
          ...state.pendingChanges,
          { id: uid('pc'), kind: 'playwright-draft' as const, draft, reason: '当前离线，改动尚未合并；恢复网络后自动重试。', createdAt: new Date().toISOString() }
        ]
      };
    }
    return drainQueue({
      ...state,
      pendingChanges: [...state.pendingChanges, { id: uid('pc'), kind: 'playwright-draft' as const, draft, reason: '', createdAt: new Date().toISOString() }]
    });
  }),

  on(retryPendingChange, (state, { id }) => drainQueue(state, [id])),
  on(retryAllPendingChanges, (state) => drainQueue(state)),

  on(rebasePendingChange, (state, { id }) => ({
    ...state,
    pendingChanges: state.pendingChanges.map((change) => {
      if (change.id !== id) return change;
      const base = versionOf(state, change.draft.baseVersionId);
      if (!base) return change;
      // 只挪基线指针，不落地改动
      return { ...change, draft: rebaseDraft(change.draft, base), reason: `已变基到 ${base.label} rev${base.revision}，可重试合并。` };
    })
  })),

  on(discardPendingChange, (state, { id }) => ({
    ...state,
    pendingChanges: state.pendingChanges.filter((change) => change.id !== id)
  })),

  on(resolveArbitration, (state, { id, resolution, finalText }) => {
    const item = state.arbitration.find((entry) => entry.id === id);
    if (!item || !item.open) return state;
    const target = versionOf(state, item.targetVersionId);
    if (!target) return state;
    const nextVersion =
      resolution === 'existing'
        ? target // 维持排练版本原文原结论，版本不推进
        : applyArbitration(target, item, resolution, finalText, true);
    return {
      ...state,
      versions: state.versions.map((version) => (version.id === target.id ? nextVersion : version)),
      arbitration: state.arbitration.map((entry) =>
        entry.id === id
          ? { ...entry, open: false, resolution, finalText: resolution === 'mixed' ? finalText : undefined }
          : entry
      )
    };
  }),

  on(addActorQuestion, (state, { actor, text, lineId }) => {
    const active = versionOf(state, state.activeVersionId);
    if (!active) return state;
    // 疑问逐条锚定记下时看的排练版本与修订号；离线先挂待同步
    const question: ActorQuestion = {
      id: uid('q'),
      lineId,
      actor,
      text,
      versionId: active.id,
      versionRevision: active.revision,
      synced: state.online,
      status: 'open',
      createdAt: new Date().toISOString()
    };
    return { ...state, questions: [...state.questions, question] };
  }),

  on(flushQuestionOutbox, (state) => flushOutbox(state)),

  on(reconfirmQuestion, (state, { id }) => ({
    ...state,
    questions: state.questions.map((question) => {
      if (question.id !== id) return question;
      const version = versionOf(state, question.versionId);
      return {
        ...question,
        // 按当前版本重新确认：锚点移到最新修订号
        versionRevision: version ? version.revision : question.versionRevision,
        status: 'reconfirmed' as const,
        reconfirmedAt: new Date().toISOString()
      };
    })
  })),

  on(closeQuestion, (state, { id }) => ({
    ...state,
    questions: state.questions.map((question) => (question.id === id ? { ...question, status: 'closed' as const } : question))
  })),

  on(toggleRehearsal, (state) => ({ ...state, rehearsalMode: !state.rehearsalMode })),

  on(setOnline, (state, { online }) => setOnlineState(state, online))
);
