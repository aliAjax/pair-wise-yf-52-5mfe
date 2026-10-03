import { createReducer, on } from '@ngrx/store';
import {
  activateVersion,
  addQuestion,
  addVersion,
  dismissOutbox,
  reconfirmQuestion,
  resolveQuestion,
  reorderLines,
  retryOutbox,
  reviewCue,
  reviewLine,
  setOnline,
  submitPlaywrightDraft,
  toggleRehearsal,
} from './script.actions';

export type CueDecision = 'pending' | 'accepted' | 'returned';
export type LineStatus = 'pending' | 'accepted' | 'returned';
export type QuestionStatus = 'open' | 'expired' | 'conflict' | 'resolved';
export type OutboxStatus = 'pending' | 'failed' | 'done';

export interface ScriptLine {
  id: string;
  role: string;
  text: string;
  status: LineStatus;
  /** 合并标记：编剧与舞台监督都改过，待裁决 */
  adjudication?: boolean;
  /** 裁决前舞台监督的结论（采纳/退回），裁决后清除 */
  previousDecision?: LineStatus;
  decidedAt?: number;
}

export interface ScriptVersion {
  id: string;
  label: string;
  playwright: string;
  note: string;
  /** 是否已合并进当前排练版本 */
  merged: boolean;
  lines: ScriptLine[];
  cues: Array<{ id: string; scene: string; text: string; status: CueDecision }>;
}

export interface ActorQuestion {
  id: string;
  lineId: string;
  /** 记下疑问时所看的排练版本 */
  versionId: string;
  /** 当时台词快照，用于判断台词是否已被改过 */
  lineText: string;
  role: string;
  text: string;
  createdAt: number;
  status: QuestionStatus;
  reason?: 'version-changed' | 'text-changed' | 'line-removed' | 'decision-made';
}

export interface OutboxItem {
  id: string;
  kind: 'draft';
  label: string;
  draft: ScriptVersion;
  createdAt: number;
  status: OutboxStatus;
  error?: string;
  /** 演示用：首次合并强制失败，用于验证“失败留待处理、可继续处理” */
  forceFail?: boolean;
}

export interface ScriptState {
  versions: ScriptVersion[];
  activeVersionId: string;
  rehearsalMode: boolean;
  online: boolean;
  questions: ActorQuestion[];
  outbox: OutboxItem[];
}

const initialVersions: ScriptVersion[] = [
  {
    id: 'v12', label: '排练稿 v12', playwright: '林编剧', merged: true,
    note: '重写第三场父女冲突，舞台灯光提示延后2拍。',
    lines: [
      { id: 'l1', role: '周岚', text: '你每次都说等明天，可舞台不会等我们。', status: 'pending' },
      { id: 'l2', role: '周野', text: '那就让灯灭吧，我早已背熟黑暗。', status: 'pending' }
    ],
    cues: [
      { id: 'c1', scene: '第三场', text: '侧灯收至30%，雨声渐入', status: 'pending' },
      { id: 'c2', scene: '第三场', text: '周野坐到舞台左前区，保留两拍静默', status: 'accepted' }
    ]
  },
  {
    id: 'v13', label: '导演修订 v13', playwright: '林编剧', merged: true,
    note: '调整周岚结论，加入一次性追光变化。',
    lines: [
      { id: 'l1', role: '周岚', text: '你总说明天，但今晚我们必须把话说完。', status: 'pending' },
      { id: 'l3', role: '周岚', text: '看着灯，再说一次你为什么回来。', status: 'pending' }
    ],
    cues: [{ id: 'c3', scene: '第三场', text: '追光由冷白切换至琥珀，等待雨声下落', status: 'pending' }]
  }
];

const initialQuestions: ActorQuestion[] = [
  {
    id: 'q1', lineId: 'l1', versionId: 'v12',
    lineText: '你每次都说等明天，可舞台不会等我们。', role: '周岚',
    text: '这句的停顿是不是该放在“可舞台”后面？',
    createdAt: 1, status: 'open'
  }
];

interface MergeResult {
  version?: ScriptVersion;
  error?: string;
}

/**
 * 把编剧新稿合并进当前排练版本：
 * - 没被改过的台词（文本/角色一致）：保住舞台监督原有结论；
 * - 舞台监督还没结论的：采用新词，继续待确认；
 * - 双方都改过的：挂进待裁决，原结论（含退回）保留不冲掉；
 * - 新台词：追加为待确认；草稿未涉及的台词原样保留。
 */
function mergeDraftInto(active: ScriptVersion, draft: ScriptVersion, forceFail = false): MergeResult {
  if (forceFail) {
    return { error: '合并失败：草稿与当前排练版本存在未预期的冲突，未落地的改动已留在待处理，可继续处理。' };
  }
  if (draft.lines.length === 0) return { error: '草稿为空，没有可合并的台词。' };

  const draftIds = new Set<string>();
  for (const line of draft.lines) {
    if (draftIds.has(line.id)) return { error: `草稿内台词 ${line.id} 重复，无法逐条合并。` };
    draftIds.add(line.id);
  }

  const currentById = new Map(active.lines.map((line) => [line.id, line]));
  for (const line of draft.lines) {
    const current = currentById.get(line.id);
    if (current && current.role !== line.role) {
      return { error: `台词 ${line.id} 角色归属冲突（${current.role} → ${line.role}），需人工核对后再合并。` };
    }
  }

  const mergedLines: ScriptLine[] = [];
  const seen = new Set<string>();
  for (const draftLine of draft.lines) {
    seen.add(draftLine.id);
    const current = currentById.get(draftLine.id);
    if (!current) {
      mergedLines.push({ id: draftLine.id, role: draftLine.role, text: draftLine.text, status: 'pending' });
    } else if (current.text === draftLine.text && current.role === draftLine.role) {
      // 台词没被改过：保住原有结论
      mergedLines.push(current);
    } else if (current.status === 'pending') {
      // 舞台监督还没结论：采用新词，继续待确认
      mergedLines.push({ ...current, role: draftLine.role, text: draftLine.text, status: 'pending', adjudication: false, previousDecision: undefined });
    } else {
      // 双方都改过：挂进待裁决，退回/采纳结论不冲掉
      mergedLines.push({
        ...current,
        role: draftLine.role,
        text: draftLine.text,
        status: 'pending',
        adjudication: true,
        previousDecision: current.status
      });
    }
  }
  for (const line of active.lines) {
    if (!seen.has(line.id)) mergedLines.push(line);
  }

  return { version: { ...active, lines: mergedLines, merged: true } };
}

/** 恢复网络或结论变化后逐条核对疑问：过期/冲突的标出，其余保持待确认 */
function evaluateQuestion(question: ActorQuestion, active: ScriptVersion | undefined): ActorQuestion {
  if (question.status === 'resolved') return question;
  const line = active?.lines.find((item) => item.id === question.lineId);
  if (!line) return { ...question, status: 'expired', reason: 'line-removed' };
  if (question.versionId !== active!.id) return { ...question, status: 'expired', reason: 'version-changed' };
  if (question.lineText !== line.text) return { ...question, status: 'expired', reason: 'text-changed' };
  if (line.status !== 'pending' && line.decidedAt !== undefined && line.decidedAt > question.createdAt) {
    return { ...question, status: 'conflict', reason: 'decision-made' };
  }
  return { ...question, status: 'open', reason: undefined };
}

function evaluateAll(questions: ActorQuestion[], active: ScriptVersion | undefined): ActorQuestion[] {
  return questions.map((question) => evaluateQuestion(question, active));
}

function loadState(): ScriptState {
  const fallback: ScriptState = {
    versions: initialVersions,
    activeVersionId: 'v12',
    rehearsalMode: false,
    online: true,
    questions: initialQuestions,
    outbox: []
  };
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem('yf52-script-state');
    if (!raw) return fallback;
    const saved = JSON.parse(raw) as Partial<ScriptState>;
    return {
      ...fallback,
      ...saved,
      versions: (saved.versions ?? fallback.versions).map((version) => ({
        ...version,
        merged: version.merged ?? true,
        lines: version.lines.map((line) => ({ ...line }))
      })),
      questions: saved.questions ?? fallback.questions,
      outbox: saved.outbox ?? []
    };
  } catch {
    return fallback;
  }
}

export const scriptReducer = createReducer(
  loadState(),
  on(addVersion, (state, { version }) => ({ ...state, versions: [...state.versions, version] })),
  on(activateVersion, (state, { id }) => ({ ...state, activeVersionId: id })),
  on(reviewLine, (state, { id, decision }) => {
    const now = Date.now();
    const versions = state.versions.map((version) => {
      if (version.id !== state.activeVersionId) return version;
      return {
        ...version,
        lines: version.lines.map((line) =>
          line.id === id
            ? { ...line, status: decision, adjudication: false, previousDecision: undefined, decidedAt: now }
            : line
        )
      };
    });
    const active = versions.find((version) => version.id === state.activeVersionId);
    return { ...state, versions, questions: evaluateAll(state.questions, active) };
  }),
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
  on(reviewCue, (state, { id, decision }) => ({
    ...state,
    versions: state.versions.map((version) =>
      version.id !== state.activeVersionId
        ? version
        : { ...version, cues: version.cues.map((cue) => (cue.id === id ? { ...cue, status: decision } : cue)) }
    )
  })),
  on(toggleRehearsal, (state) => ({ ...state, rehearsalMode: !state.rehearsalMode })),
  on(setOnline, (state, { online }) => {
    if (!online) return { ...state, online: false };

    // 恢复网络：逐条重放待处理草稿，失败的留在待处理里
    let versions = state.versions;
    let questions = state.questions;
    const remaining: OutboxItem[] = [];
    for (const item of state.outbox) {
      const active = versions.find((version) => version.id === state.activeVersionId);
      if (!active) {
        remaining.push({ ...item, status: 'failed', error: '当前排练版本不存在。' });
        continue;
      }
      const result = mergeDraftInto(active, item.draft, item.forceFail);
      if (result.error || !result.version) {
        remaining.push({ ...item, status: 'failed', error: result.error, forceFail: false });
      } else {
        versions = versions.map((version) =>
          version.id === active.id
            ? result.version!
            : version.id === item.draft.id
              ? { ...version, merged: true }
              : version
        );
        questions = evaluateAll(questions, result.version);
      }
    }
    const active = versions.find((version) => version.id === state.activeVersionId);
    questions = evaluateAll(questions, active);
    return { ...state, online: true, versions, questions, outbox: remaining };
  }),
  on(submitPlaywrightDraft, (state, { draft, simulateFailure }) => {
    const exists = state.versions.some((version) => version.id === draft.id);
    const versions = exists ? state.versions : [...state.versions, { ...draft, merged: false }];
    const item: OutboxItem = {
      id: `o${Date.now()}`,
      kind: 'draft',
      label: `${draft.label}（${draft.playwright}）`,
      draft,
      createdAt: Date.now(),
      status: 'pending',
      forceFail: simulateFailure
    };

    if (!state.online) {
      // 离线：草稿进待处理队列，恢复网络后自动逐条合并
      return { ...state, versions, outbox: [...state.outbox, item] };
    }

    const active = versions.find((version) => version.id === state.activeVersionId)!;
    const result = mergeDraftInto(active, draft, simulateFailure);
    if (result.error || !result.version) {
      // 合并失败：没落地的改动留在待处理里，重新打开还能接着处理
      return {
        ...state,
        versions,
        outbox: [...state.outbox, { ...item, status: 'failed' as OutboxStatus, error: result.error, forceFail: false }]
      };
    }
    const finalVersions = versions.map((version) =>
      version.id === active.id
        ? result.version!
        : version.id === draft.id
          ? { ...version, merged: true }
          : version
    );
    return { ...state, versions: finalVersions, questions: evaluateAll(state.questions, result.version) };
  }),
  on(addQuestion, (state, { lineId, text }) => {
    const active = state.versions.find((version) => version.id === state.activeVersionId);
    const line = active?.lines.find((item) => item.id === lineId);
    if (!active || !line || !text.trim()) return state;
    const question: ActorQuestion = {
      id: `q${Date.now()}`,
      lineId,
      versionId: active.id,
      lineText: line.text,
      role: line.role,
      text: text.trim(),
      createdAt: Date.now(),
      status: 'open'
    };
    return { ...state, questions: [...state.questions, question] };
  }),
  on(resolveQuestion, (state, { id }) => ({
    ...state,
    questions: state.questions.map((question) =>
      question.id === id ? { ...question, status: 'resolved' as QuestionStatus, reason: undefined } : question
    )
  })),
  on(reconfirmQuestion, (state, { id }) => {
    const active = state.versions.find((version) => version.id === state.activeVersionId);
    const question = state.questions.find((item) => item.id === id);
    if (!active || !question) return state;
    const line = active.lines.find((item) => item.id === question.lineId);
    if (!line) {
      return {
        ...state,
        questions: state.questions.map((item) =>
          item.id === id ? { ...item, status: 'expired' as QuestionStatus, reason: 'line-removed' as const } : item
        )
      };
    }
    return {
      ...state,
      questions: state.questions.map((item) =>
        item.id === id
          ? {
              ...item,
              versionId: active.id,
              lineText: line.text,
              role: line.role,
              status: 'open' as QuestionStatus,
              reason: undefined,
              createdAt: Date.now()
            }
          : item
      )
    };
  }),
  on(retryOutbox, (state, { id }) => {
    const item = state.outbox.find((outboxItem) => outboxItem.id === id);
    if (!item) return state;
    const active = state.versions.find((version) => version.id === state.activeVersionId);
    if (!active) {
      return {
        ...state,
        outbox: state.outbox.map((outboxItem) =>
          outboxItem.id === id ? { ...outboxItem, status: 'failed' as OutboxStatus, error: '当前排练版本不存在。' } : outboxItem
        )
      };
    }
    const result = mergeDraftInto(active, item.draft, false);
    if (result.error || !result.version) {
      return {
        ...state,
        outbox: state.outbox.map((outboxItem) =>
          outboxItem.id === id ? { ...outboxItem, status: 'failed' as OutboxStatus, error: result.error } : outboxItem
        )
      };
    }
    const versions = state.versions.map((version) =>
      version.id === active.id
        ? result.version!
        : version.id === item.draft.id
          ? { ...version, merged: true }
          : version
    );
    return { ...state, versions, questions: evaluateAll(state.questions, result.version), outbox: state.outbox.filter((outboxItem) => outboxItem.id !== id) };
  }),
  on(dismissOutbox, (state, { id }) => ({ ...state, outbox: state.outbox.filter((item) => item.id !== id) }))
);
