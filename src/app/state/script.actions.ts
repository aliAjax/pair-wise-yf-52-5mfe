import { createAction, props } from '@ngrx/store';
import type { CueDecision, ScriptVersion } from './script.reducer';

export const addVersion = createAction('[Script] Add Version', props<{ version: ScriptVersion }>());
export const activateVersion = createAction('[Script] Activate Version', props<{ id: string }>());
export const reviewLine = createAction('[Script] Review Line', props<{ id: string; decision: 'accepted' | 'returned' }>());
export const reorderLines = createAction('[Script] Reorder Lines', props<{ from: number; to: number }>());
export const reviewCue = createAction('[Script] Review Cue', props<{ id: string; decision: CueDecision }>());
export const toggleRehearsal = createAction('[Script] Toggle Rehearsal');
export const setOnline = createAction('[Script] Set Online', props<{ online: boolean }>());

/** 编剧提交新稿：在线立即合并，离线或合并失败时进入待处理队列 */
export const submitPlaywrightDraft = createAction(
  '[Script] Submit Playwright Draft',
  props<{ draft: ScriptVersion; simulateFailure?: boolean }>()
);
/** 演员记下疑问（离线可用），附带当时所看的排练版本与台词快照 */
export const addQuestion = createAction('[Script] Add Question', props<{ lineId: string; text: string }>());
export const resolveQuestion = createAction('[Script] Resolve Question', props<{ id: string }>());
/** 版本过期后演员重新确认：重新挂到当前版本的台词上 */
export const reconfirmQuestion = createAction('[Script] Reconfirm Question', props<{ id: string }>());
/** 合并失败后继续处理待处理队列中的草稿 */
export const retryOutbox = createAction('[Script] Retry Outbox', props<{ id: string }>());
export const dismissOutbox = createAction('[Script] Dismiss Outbox', props<{ id: string }>());
