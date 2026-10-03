import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatToolbarModule } from '@angular/material/toolbar';
import { Store } from '@ngrx/store';
import { TranslocoModule } from '@jsverse/transloco';
import { Subscription } from 'rxjs';
import {
  activateVersion,
  addVersion,
  dismissOutbox,
  reconfirmQuestion,
  reorderLines,
  resolveQuestion,
  retryOutbox,
  reviewCue,
  reviewLine,
  setOnline,
  submitPlaywrightDraft,
  addQuestion,
  toggleRehearsal
} from './state/script.actions';
import { ActorQuestion, OutboxItem, ScriptLine, ScriptState, ScriptVersion } from './state/script.reducer';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, DragDropModule, MatToolbarModule, MatButtonModule, MatCardModule, MatTabsModule, MatChipsModule, MatIconModule, TranslocoModule],
  template: `
    <mat-toolbar color="primary" class="topbar">
      <span>{{ 'title' | transloco }}</span>
      <span class="spacer"></span>
      <button mat-stroked-button (click)="toggleOnline()">
        {{ ((state$ | async)?.online ? 'online' : 'offline') | transloco }}
      </button>
      <button mat-flat-button color="accent" (click)="toggleRehearsal()">
        {{ ((state$ | async)?.rehearsalMode ? 'normalMode' : 'rehearsalMode') | transloco }}
      </button>
    </mat-toolbar>

    <main [class.rehearsal]="(state$ | async)?.rehearsalMode">
      <section class="summary">
        <mat-card>
          <mat-card-title>版本控制</mat-card-title>
          <p>编剧提交新稿后逐条合并：没被改过的台词保住原有结论，双方都改过的挂进待裁决，退回不会被直接冲掉。</p>
          <div class="chips">
            <button mat-stroked-button *ngFor="let version of (state$ | async)?.versions" [color]="version.id === (state$ | async)?.activeVersionId ? 'primary' : ''" (click)="activate(version.id)">
              {{ version.label }} · {{ version.playwright }}
              <span class="chip-badge" *ngIf="adjudicationCount(version)">待裁决 {{ adjudicationCount(version) }}</span>
              <span class="chip-badge muted" *ngIf="!version.merged">未合并</span>
            </button>
            <button mat-flat-button color="primary" (click)="createDraft()">新增导演修订</button>
            <button mat-flat-button color="accent" (click)="submitDraft()">编剧提交新稿</button>
            <button mat-stroked-button color="warn" (click)="submitDraft(true)">模拟合并失败</button>
          </div>
        </mat-card>
      </section>

      <section class="outbox" *ngIf="(state$ | async)?.outbox?.length">
        <mat-card>
          <mat-card-title>待处理（合并队列）</mat-card-title>
          <p>合并失败时没落地的改动留在这里，重新打开还能接着处理。</p>
          <div class="outbox-item" *ngFor="let item of (state$ | async)?.outbox">
            <div class="outbox-info">
              <b>{{ item.label }}</b>
              <span class="status" [class.err]="item.status === 'failed'">{{ outboxStatusLabel(item) }}</span>
              <p class="err" *ngIf="item.error">{{ item.error }}</p>
            </div>
            <div class="outbox-actions">
              <button mat-button color="primary" (click)="retry(item.id)">继续处理</button>
              <button mat-button (click)="dismiss(item.id)">放弃</button>
            </div>
          </div>
        </mat-card>
      </section>

      <section *ngIf="activeVersion$ | async as activeVersion" class="workspace">
        <mat-card class="script">
          <mat-card-title>{{ activeVersion.label }}</mat-card-title>
          <mat-card-subtitle>{{ activeVersion.note }}</mat-card-subtitle>
          <mat-tab-group>
            <mat-tab label="角色台词">
              <div cdkDropList (cdkDropListDropped)="dropLine($event)">
                <article class="line" cdkDrag *ngFor="let line of activeVersion.lines">
                  <div class="line-main">
                    <div class="line-head">
                      <b>{{ line.role }}</b>
                      <span class="status" [class.ok]="line.status === 'accepted'" [class.err]="line.status === 'returned'">{{ statusLabel(line.status) }}</span>
                      <span class="status adjudication" *ngIf="line.adjudication">待裁决 · 原结论：{{ line.previousDecision === 'returned' ? '退回' : '采纳' }}</span>
                      <span class="status question-count" *ngIf="openQuestionCount(line)">{{ openQuestionCount(line) }} 条疑问</span>
                    </div>
                    <p>{{ line.text }}</p>
                    <div class="question-box" *ngIf="questioningLineId === line.id">
                      <input [(ngModel)]="draftQuestionText" placeholder="记下对这句台词的疑问，恢复网络后自动逐条核对…" (keyup.enter)="submitQuestion(line.id)" />
                      <button mat-button color="primary" (click)="submitQuestion(line.id)">提交疑问</button>
                      <button mat-button (click)="cancelQuestion()">取消</button>
                    </div>
                  </div>
                  <div class="line-actions">
                    <button mat-button color="primary" (click)="reviewLine(line.id, 'accepted')">采纳</button>
                    <button mat-button color="warn" (click)="reviewLine(line.id, 'returned')">退回</button>
                    <button mat-button (click)="startQuestion(line.id)">记疑问</button>
                  </div>
                </article>
              </div>
            </mat-tab>
            <mat-tab label="舞台提示">
              <article class="line" *ngFor="let cue of activeVersion.cues">
                <div>
                  <b>{{ cue.scene }}</b>
                  <p>{{ cue.text }}</p>
                  <span class="status" [class.ok]="cue.status === 'accepted'" [class.err]="cue.status === 'returned'">{{ statusLabel(cue.status) }}</span>
                </div>
                <div>
                  <button mat-button color="primary" (click)="reviewCue(cue.id, 'accepted')">采纳</button>
                  <button mat-button color="warn" (click)="reviewCue(cue.id, 'returned')">退回</button>
                </div>
              </article>
            </mat-tab>
            <mat-tab label="演员疑问">
              <p class="tab-hint">恢复网络后逐条核对：与舞台监督新结论冲突的排在最前，版本过期的需重新确认。</p>
              <article class="line question" *ngFor="let q of sortedQuestions">
                <div class="line-main">
                  <div class="line-head">
                    <b>{{ q.role }}</b>
                    <span class="status" [class.err]="q.status === 'conflict'" [class.warn]="q.status === 'expired'" [class.ok]="q.status === 'resolved'">{{ questionStatusLabel(q.status) }}</span>
                    <span class="status reason" *ngIf="q.reason">{{ questionReasonLabel(q.reason) }}</span>
                  </div>
                  <p class="question-text">{{ q.text }}</p>
                  <p class="line-snapshot">当时台词（{{ q.versionId }}）：{{ q.lineText }}</p>
                </div>
                <div class="line-actions">
                  <button mat-button color="primary" *ngIf="q.status !== 'resolved'" (click)="reconfirm(q.id)">重新确认</button>
                  <button mat-button *ngIf="q.status !== 'resolved'" (click)="resolve(q.id)">标记已解决</button>
                </div>
              </article>
              <p class="empty" *ngIf="sortedQuestions.length === 0">暂无演员疑问。</p>
            </mat-tab>
          </mat-tab-group>
        </mat-card>

        <mat-card class="compare">
          <mat-card-title>合并状态</mat-card-title>
          <p class="version-name">当前版本 {{ activeVersion.label }}</p>
          <div class="diff"><b>待裁决台词</b><span>{{ adjudicationCount(activeVersion) }} 条</span></div>
          <div class="diff"><b>待处理草稿</b><span>{{ (state$ | async)?.outbox?.length ?? 0 }} 份</span></div>
          <div class="diff"><b>演员疑问</b><span>{{ openQuestionTotal }} 条（冲突 {{ conflictQuestionCount }}）</span></div>
          <div class="diff warn"><b>规则</b><span>退回的台词不会被新稿直接冲掉</span></div>
        </mat-card>
      </section>

      <aside class="offline" *ngIf="(state$ | async)?.online === false">网络不可用：修订与疑问已写入本地缓存；恢复网络后将逐条合并核对，失败的改动留在待处理中可继续处理。</aside>
    </main>
  `,
  styles: [`
    .topbar { position: sticky; top: 0; z-index: 4; }
    .spacer { flex: 1; }
    main { max-width: 1180px; margin: 24px auto; padding: 0 18px 48px; }
    main.rehearsal { max-width: 860px; background: #111827; color: #f9fafb; margin-top: 0; }
    main.rehearsal .script, main.rehearsal .compare, main.rehearsal .summary { opacity: .92; }
    .summary { margin-bottom: 18px; }
    .chips { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 16px; align-items: center; }
    .chip-badge { margin-left: 6px; font-size: 11px; color: #b45309; }
    .chip-badge.muted { color: #6b7280; }
    .outbox { margin-bottom: 18px; }
    .outbox-item { display: flex; justify-content: space-between; gap: 16px; align-items: center; padding: 14px 0; border-bottom: 1px solid #e5e7eb; }
    .outbox-info p { margin: 6px 0 0; font-size: 13px; }
    .outbox-actions { display: flex; gap: 4px; white-space: nowrap; }
    .workspace { display: grid; grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr); gap: 18px; }
    .line { cursor: grab; display: flex; justify-content: space-between; gap: 16px; align-items: center; padding: 16px 0; border-bottom: 1px solid #e5e7eb; }
    .line-main { flex: 1; min-width: 0; }
    .line-head { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .line p { margin: 8px 0; font-size: 17px; line-height: 1.6; }
    .line-actions { display: flex; flex-direction: column; gap: 4px; white-space: nowrap; }
    .status { font-size: 12px; color: #b45309; }
    .status.ok { color: #15803d; }
    .status.err { color: #b91c1c; }
    .status.warn { color: #b45309; }
    .status.adjudication { color: #6d28d9; font-weight: 600; }
    .status.reason { color: #6b7280; }
    .status.question-count { color: #0e7490; }
    .question-box { display: flex; gap: 8px; align-items: center; margin-top: 8px; }
    .question-box input { flex: 1; padding: 8px 10px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px; }
    .question-text { font-size: 15px !important; }
    .line-snapshot { font-size: 12px !important; color: #6b7280; margin: 4px 0 0 !important; }
    .tab-hint { font-size: 13px; color: #6b7280; margin: 12px 0; }
    .empty { color: #6b7280; font-size: 14px; padding: 12px 0; }
    .version-name { padding: 12px; background: #f3f4f6; border-radius: 8px; }
    .diff { display: flex; justify-content: space-between; border-bottom: 1px solid #e5e7eb; padding: 14px 0; }
    .diff.warn b { color: #b45309; }
    .offline { position: fixed; right: 18px; bottom: 18px; padding: 14px 18px; max-width: 360px; color: #fff; background: #b45309; border-radius: 10px; box-shadow: 0 8px 30px #0003; }
    @media (max-width: 820px) { .workspace { grid-template-columns: 1fr; } .line { align-items: flex-start; } }
  `]
})
export class AppComponent implements OnInit, OnDestroy {
  readonly state$ = this.store.select('script');
  readonly activeVersion$ = this.store.select((state) => {
    const script = state.script as ScriptState;
    return script.versions.find((item) => item.id === script.activeVersionId) ?? script.versions[0];
  });
  private latest?: ScriptState;
  private subscription?: Subscription;
  private onlineHandler = () => this.store.dispatch(setOnline({ online: navigator.onLine }));
  private offlineHandler = () => this.store.dispatch(setOnline({ online: false }));

  questioningLineId: string | null = null;
  draftQuestionText = '';

  constructor(private readonly store: Store<{ script: ScriptState }>) {}

  ngOnInit() {
    window.addEventListener('online', this.onlineHandler);
    window.addEventListener('offline', this.offlineHandler);
    this.subscription = this.state$.subscribe((state) => {
      this.latest = state;
      localStorage.setItem('yf52-script-state', JSON.stringify(state));
    });
  }

  ngOnDestroy() {
    window.removeEventListener('online', this.onlineHandler);
    window.removeEventListener('offline', this.offlineHandler);
    this.subscription?.unsubscribe();
  }

  activate(id: string) { this.store.dispatch(activateVersion({ id })); }
  toggleRehearsal() { this.store.dispatch(toggleRehearsal()); }
  setOnline(online: boolean) { this.store.dispatch(setOnline({ online })); }
  toggleOnline() { this.setOnline(!(this.latest?.online ?? true)); }
  reviewLine(id: string, decision: 'accepted' | 'returned') { this.store.dispatch(reviewLine({ id, decision })); }
  dropLine(event: CdkDragDrop<unknown>) { if (event.previousIndex !== event.currentIndex) this.store.dispatch(reorderLines({ from: event.previousIndex, to: event.currentIndex })); }
  reviewCue(id: string, decision: 'accepted' | 'returned') { this.store.dispatch(reviewCue({ id, decision })); }

  statusLabel(status: string) { return status === 'accepted' ? '采纳' : status === 'returned' ? '退回' : '待确认'; }
  questionStatusLabel(status: ActorQuestion['status']) {
    return status === 'conflict' ? '与舞台监督新结论冲突' : status === 'expired' ? '已过期 · 待重新确认' : status === 'resolved' ? '已解决' : '待确认';
  }
  questionReasonLabel(reason: NonNullable<ActorQuestion['reason']>) {
    return reason === 'version-changed' ? '排练版本已更新'
      : reason === 'text-changed' ? '台词已修改'
      : reason === 'line-removed' ? '台词已删除'
      : '舞台监督已给出新结论';
  }
  outboxStatusLabel(item: OutboxItem) { return item.status === 'failed' ? '合并失败' : '待合并'; }

  adjudicationCount(version: ScriptVersion) { return version.lines.filter((line) => line.adjudication).length; }
  openQuestionCount(line: ScriptLine) {
    return (this.latest?.questions ?? []).filter((question) => question.lineId === line.id && question.status !== 'resolved').length;
  }
  get sortedQuestions(): ActorQuestion[] {
    const questions = this.latest?.questions ?? [];
    const order: Record<ActorQuestion['status'], number> = { conflict: 0, expired: 1, open: 2, resolved: 3 };
    return [...questions].sort((a, b) => order[a.status] - order[b.status] || b.createdAt - a.createdAt);
  }
  get openQuestionTotal() { return (this.latest?.questions ?? []).filter((question) => question.status !== 'resolved').length; }
  get conflictQuestionCount() { return (this.latest?.questions ?? []).filter((question) => question.status === 'conflict').length; }

  createDraft() {
    const id = `v${Date.now().toString().slice(-4)}`;
    const version: ScriptVersion = {
      id,
      label: `导演修订 ${id}`,
      playwright: '本地草稿',
      note: '断网期间创建的修订，等待与编剧版本合并。',
      merged: false,
      lines: [{ id: `${id}-l1`, role: '周岚', text: '这次换你告诉我，灯亮之后准备去哪里。', status: 'pending' }],
      cues: [{ id: `${id}-c1`, scene: '第三场', text: '追光保持到台词结束，再执行全场收光', status: 'pending' }]
    };
    this.store.dispatch(addVersion({ version }));
    this.store.dispatch(activateVersion({ id }));
  }

  /** 模拟编剧提交新稿：前两句台词被编剧改过（触发待裁决），其余保留，另加一句新词 */
  submitDraft(simulateFailure = false) {
    const active = this.latest?.versions.find((version) => version.id === this.latest?.activeVersionId);
    if (!active) return;
    const id = `d${Date.now().toString().slice(-6)}`;
    const lines: ScriptLine[] = active.lines.map((line, index) =>
      index < 2 ? { ...line, text: `${line.text}（编剧修订：此处节奏调整，按新提示处理。）` } : { ...line }
    );
    lines.push({ id: `${id}-lnew`, role: active.lines[0]?.role ?? '周岚', text: '灯亮之前，我想再听你叫一次我的名字。', status: 'pending' });
    const draft: ScriptVersion = {
      id,
      label: `编剧新稿 ${id}`,
      playwright: '林编剧',
      note: '编剧离线期间完成的修订，恢复网络后提交合并。',
      merged: false,
      lines,
      cues: []
    };
    this.store.dispatch(submitPlaywrightDraft({ draft, simulateFailure }));
  }

  startQuestion(lineId: string) {
    this.questioningLineId = lineId;
    this.draftQuestionText = '';
  }
  cancelQuestion() {
    this.questioningLineId = null;
    this.draftQuestionText = '';
  }
  submitQuestion(lineId: string) {
    const text = this.draftQuestionText.trim();
    if (!text) return;
    this.store.dispatch(addQuestion({ lineId, text }));
    this.cancelQuestion();
  }
  resolve(id: string) { this.store.dispatch(resolveQuestion({ id })); }
  reconfirm(id: string) { this.store.dispatch(reconfirmQuestion({ id })); }

  retry(id: string) { this.store.dispatch(retryOutbox({ id })); }
  dismiss(id: string) { this.store.dispatch(dismissOutbox({ id })); }
}
