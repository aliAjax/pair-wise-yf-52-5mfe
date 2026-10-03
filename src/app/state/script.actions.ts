import { createAction, props } from '@ngrx/store';
import { ArbitrationResolution, PlaywrightDraft } from './script';

export const addVersion = createAction('[Script] Add Version', props<{ version: import('./script').ScriptVersion }>());
export const activateVersion = createAction('[Script] Activate Version', props<{ id: string }>());

// 舞台监督对排练版本的逐条结论
export const reviewLine = createAction('[Script] Review Line', props<{ id: string; decision: 'accepted' | 'returned' }>());
export const reviewCue = createAction('[Script] Review Cue', props<{ id: string; decision: 'accepted' | 'returned' }>());
export const reorderLines = createAction('[Script] Reorder Lines', props<{ from: number; to: number }>());

// 编剧交新稿：在线即合并，失败或离线则进待处理队列，原结论不会被直接冲掉
export const submitPlaywrightDraft = createAction('[Script] Submit Playwright Draft', props<{ draft: PlaywrightDraft }>());
export const retryPendingChange = createAction('[Script] Retry Pending Change', props<{ id: string }>());
export const retryAllPendingChanges = createAction('[Script] Retry All Pending Changes');
export const rebasePendingChange = createAction('[Script] Rebase Pending Change', props<{ id: string }>());
export const discardPendingChange = createAction('[Script] Discard Pending Change', props<{ id: string }>());

// 待裁决：维持原结论 / 采纳编剧稿 / 混合文本
export const resolveArbitration = createAction(
  '[Script] Resolve Arbitration',
  props<{ id: string; resolution: ArbitrationResolution; finalText?: string }>()
);

// 演员疑问（离线先入待同步队列，恢复网络逐条回到当时那句台词）
export const addActorQuestion = createAction(
  '[Script] Add Actor Question',
  props<{ actor: string; text: string; lineId: string }>()
);
export const reconfirmQuestion = createAction('[Script] Reconfirm Question', props<{ id: string }>());
export const closeQuestion = createAction('[Script] Close Question', props<{ id: string }>());
export const flushQuestionOutbox = createAction('[Script] Flush Question Outbox');

export const toggleRehearsal = createAction('[Script] Toggle Rehearsal');
export const setOnline = createAction('[Script] Set Online', props<{ online: boolean }>());
