// 排练期台本合并的领域模型与纯函数：
// - 编剧新稿与舞台监督结论做三方合并（未改动保结论 / 双方改动进待裁决 / 基线不符合并失败）
// - 演员疑问锚定「版本 + 修订号」，据此判定过期与结论冲突

export type ReviewStatus = 'pending' | 'accepted' | 'returned';

export const STATUS_LABEL: Record<ReviewStatus, string> = {
  pending: '待确认',
  accepted: '已采纳',
  returned: '已退回'
};

export interface LineChange {
  id: string;
  role: string;
  text: string;
}

export interface CueChange {
  id: string;
  scene: string;
  text: string;
}

export interface ScriptLine extends LineChange {
  status: ReviewStatus;
}

export interface ScriptCue extends CueChange {
  status: ReviewStatus;
}

export interface ScriptVersion {
  id: string;
  label: string;
  playwright: string;
  note: string;
  /** 每次台本内容/结论推进自增，演员疑问据此判断是否过期 */
  revision: number;
  lines: ScriptLine[];
  cues: ScriptCue[];
}

/** 编剧交来的修订稿，记录所基于的排练版本与修订号 */
export interface PlaywrightDraft {
  id: string;
  baseVersionId: string;
  baseRevision: number;
  playwright: string;
  note: string;
  submittedAt: string;
  lineChanges: LineChange[];
  cueChanges: CueChange[];
}

/** 合并失败、尚未落地的改动，留在待处理队列里可继续处理 */
export interface PendingChange {
  id: string;
  kind: 'playwright-draft';
  draft: PlaywrightDraft;
  reason: string;
  createdAt: string;
}

export type ArbitrationKind = 'line' | 'cue';
export type ArbitrationResolution = 'existing' | 'proposed' | 'mixed';

/** 双方都改过、需要导演/舞台监督裁决的条目 */
export interface ArbitrationItem {
  id: string;
  kind: ArbitrationKind;
  refId: string;
  targetVersionId: string;
  /** 挂起时该版本的修订号，仅作展示 */
  targetRevision: number;
  role: string;
  scene: string;
  existingText: string;
  proposedText: string;
  /** 合并当时舞台监督的结论，裁决前一直有效，不能被新稿冲掉 */
  existingStatus: ReviewStatus;
  sourceDraftId: string;
  playwright: string;
  open: boolean;
  resolution?: ArbitrationResolution;
  finalText?: string;
  createdAt: string;
}

/** 演员疑问，锚定记下时看的版本与修订号 */
export interface ActorQuestion {
  id: string;
  lineId: string;
  actor: string;
  text: string;
  versionId: string;
  versionRevision: number;
  synced: boolean;
  status: 'open' | 'reconfirmed' | 'closed';
  createdAt: string;
  reconfirmedAt?: string;
}

export interface MergeContext {
  now: string;
  mkid: () => string;
}

export interface MergeOutcome {
  version: ScriptVersion;
  arbitration: ArbitrationItem[];
  /** 直接落地（新增/替换）的条数 */
  appliedCount: number;
}

export interface MergeResult {
  ok: boolean;
  outcome?: MergeOutcome;
  error?: string;
}

function lineKey(line: LineChange): string {
  return `${line.role} ${line.text}`;
}

function cueKey(cue: CueChange): string {
  return `${cue.scene} ${cue.text}`;
}

/**
 * 把编剧稿合并进某个排练版本。规则：
 * 1. 基线版本/修订号不符：整体失败，一条都不落地（调用方负责放进待处理队列）。
 * 2. 稿中没动的条目：保留舞台监督原有结论（采纳/退回原样）。
 * 3. 监督还没下结论（pending）而编剧改了文：直接落地为新文，结论仍待确认。
 * 4. 监督已采纳/退回、编剧又改了：原文与原结论不动，挂一条待裁决。
 * 5. 全新条目：以待确认加入。
 */
export function mergePlaywrightDraft(
  version: ScriptVersion,
  draft: PlaywrightDraft,
  ctx: MergeContext
): MergeResult {
  if (version.id !== draft.baseVersionId) {
    return { ok: false, error: `基线版本不符：稿件基于 ${draft.baseVersionId}，当前为 ${version.id}，合并失败，改动未落地。` };
  }
  if (version.revision !== draft.baseRevision) {
    return {
      ok: false,
      error: `基线版本已变化（${version.label} 从 rev${draft.baseRevision} 推进到 rev${version.revision}），合并失败，改动未落地。可先变基再合并。`
    };
  }

  const arbitration: ArbitrationItem[] = [];
  let appliedCount = 0;
  let bumped = false;

  const lines = version.lines.map((line) => ({ ...line }));
  for (const change of draft.lineChanges) {
    const index = lines.findIndex((item) => item.id === change.id);
    if (index === -1) {
      lines.push({ id: change.id, role: change.role, text: change.text, status: 'pending' });
      appliedCount += 1;
      bumped = true;
      continue;
    }
    const existing = lines[index];
    if (lineKey(change) === lineKey(existing)) continue; // 没改过：保住原结论
    if (existing.status === 'pending') {
      lines[index] = { ...existing, role: change.role, text: change.text };
      appliedCount += 1;
      bumped = true;
    } else {
      // 双方都改过：退回/采纳结论保留，挂待裁决
      arbitration.push({
        id: ctx.mkid(),
        kind: 'line',
        refId: existing.id,
        targetVersionId: version.id,
        targetRevision: version.revision,
        role: change.role,
        scene: '',
        existingText: existing.text,
        proposedText: change.text,
        existingStatus: existing.status,
        sourceDraftId: draft.id,
        playwright: draft.playwright,
        open: true,
        createdAt: ctx.now
      });
      bumped = true;
    }
  }

  const cues = version.cues.map((cue) => ({ ...cue }));
  for (const change of draft.cueChanges) {
    const index = cues.findIndex((item) => item.id === change.id);
    if (index === -1) {
      cues.push({ id: change.id, scene: change.scene, text: change.text, status: 'pending' });
      appliedCount += 1;
      bumped = true;
      continue;
    }
    const existing = cues[index];
    if (cueKey(change) === cueKey(existing)) continue;
    if (existing.status === 'pending') {
      cues[index] = { ...existing, scene: change.scene, text: change.text };
      appliedCount += 1;
      bumped = true;
    } else {
      arbitration.push({
        id: ctx.mkid(),
        kind: 'cue',
        refId: existing.id,
        targetVersionId: version.id,
        targetRevision: version.revision,
        role: '',
        scene: change.scene,
        existingText: existing.text,
        proposedText: change.text,
        existingStatus: existing.status,
        sourceDraftId: draft.id,
        playwright: draft.playwright,
        open: true,
        createdAt: ctx.now
      });
      bumped = true;
    }
  }

  return {
    ok: true,
    outcome: {
      version: { ...version, lines, cues, revision: bumped ? version.revision + 1 : version.revision },
      arbitration,
      appliedCount
    }
  };
}

/** 变基：把稿件基线指针挪到当前排练版本，之后即可重试合并 */
export function rebaseDraft(draft: PlaywrightDraft, version: ScriptVersion): PlaywrightDraft {
  return { ...draft, baseVersionId: version.id, baseRevision: version.revision };
}

/** 裁决落回版本：维持原结论 / 采纳编剧稿 / 采用混合文本 */
export function resolveArbitration(
  version: ScriptVersion,
  item: ArbitrationItem,
  resolution: Exclude<ArbitrationResolution, 'existing'>,
  finalText: string | undefined,
  bumpRevision: boolean
): ScriptVersion {
  const nextRevision = bumpRevision ? version.revision + 1 : version.revision;
  if (item.kind === 'line') {
    return {
      ...version,
      revision: nextRevision,
      lines: version.lines.map((line) =>
        line.id === item.refId
          ? { ...line, text: resolution === 'mixed' ? (finalText ?? line.text) : item.proposedText, status: 'accepted' }
          : line
      )
    };
  }
  return {
    ...version,
    revision: nextRevision,
    cues: version.cues.map((cue) =>
      cue.id === item.refId
        ? { ...cue, text: resolution === 'mixed' ? (finalText ?? cue.text) : item.proposedText, status: 'accepted' }
        : cue
    )
  };
}

export interface QuestionFlags {
  /** 锚定的台词/版本已找不到 */
  missing: boolean;
  /** 记下时的修订号与当前不一致 */
  stale: boolean;
  /** 该台词已被舞台监督退回 —— 与新结论冲突 */
  conflict: boolean;
  currentRevision: number | null;
}

export function questionFlags(question: ActorQuestion, version: ScriptVersion | undefined): QuestionFlags {
  const currentRevision = version ? version.revision : null;
  const line = version?.lines.find((item) => item.id === question.lineId);
  const missing = !version || !line;
  const stale = missing || version!.revision !== question.versionRevision;
  const conflict = !missing && line!.status === 'returned';
  return { missing, stale, conflict, currentRevision };
}

/** 冲突优先，其次过期，其余按记录时间先后 */
export function sortQuestions<T extends ActorQuestion>(items: T[], versionOf: (q: T) => ScriptVersion | undefined): T[] {
  return [...items].sort((a, b) => {
    const fa = questionFlags(a, versionOf(a));
    const fb = questionFlags(b, versionOf(b));
    const rank = (f: QuestionFlags) => (f.conflict ? 0 : f.stale ? 1 : 2);
    if (rank(fa) !== rank(fb)) return rank(fa) - rank(fb);
    return a.createdAt.localeCompare(b.createdAt);
  });
}
