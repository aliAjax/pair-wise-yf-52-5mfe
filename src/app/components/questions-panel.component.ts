import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Store } from '@ngrx/store';
import { addActorQuestion, closeQuestion, flushQuestionOutbox, reconfirmQuestion } from '../state/script.actions';
import { ScriptState } from '../state/script.reducer';
import { EnrichedQuestion } from '../state/script.selectors';
import { ScriptVersion, STATUS_LABEL } from '../state/script';

@Component({
  selector: 'app-questions-panel',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MatButtonModule, MatCardModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule],
  template: `
    <mat-card>
      <mat-card-title>演员疑问</mat-card-title>
      <p class="hint">疑问逐条挂在记下时的那句台词上，并锚定当时的排练版本。版本一变即标「已过期」需重新确认；与舞台监督退回结论冲突的排在最前。</p>

      <form class="new" (ngSubmit)="add()">
        <mat-form-field appearance="outline">
          <mat-label>演员</mat-label>
          <input matInput [formControl]="actor" placeholder="演员姓名" />
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>针对台词</mat-label>
          <mat-select [formControl]="lineId">
            <mat-option *ngFor="let line of version.lines" [value]="line.id">{{ line.role }}：{{ line.text.slice(0, 14) }}…</mat-option>
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline" class="full">
          <mat-label>疑问内容</mat-label>
          <textarea matInput rows="2" [formControl]="text" placeholder="例如：这句的停顿放在哪？"></textarea>
        </mat-form-field>
        <button mat-flat-button color="primary" [disabled]="!canSubmit()">记下疑问</button>
        <span class="offline-hint" *ngIf="!online">离线记录中：疑问先存本机，恢复网络后逐条同步回该台词。</span>
      </form>

      <div class="outbox" *ngIf="outbox.length">
        <mat-icon>cloud_off</mat-icon>
        <span>{{ outbox.length }} 条疑问待同步（恢复网络后自动逐条回到台词）</span>
        <button mat-stroked-button [disabled]="!online" (click)="flush()">立即同步</button>
      </div>

      <article class="q" *ngFor="let q of questions" [class.closed]="q.status === 'closed'"
        [class.conflict]="q.flags.conflict" [class.stale]="q.flags.stale && !q.flags.conflict">
        <div class="head">
          <b>{{ q.actor }}</b>
          <span class="ver">{{ q.version?.label ?? '版本已不存在' }} · rev{{ q.versionRevision }}</span>
          <span class="badge conflict-badge" *ngIf="q.flags.conflict">与退回结论冲突</span>
          <span class="badge stale-badge" *ngIf="q.flags.stale && !q.flags.conflict">已过期</span>
          <span class="badge ok-badge" *ngIf="q.status === 'reconfirmed'">已重新确认</span>
          <span class="badge sync-badge" *ngIf="!q.synced">待同步</span>
        </div>
        <p>{{ q.text }}</p>
        <div class="target" *ngIf="target(q) as t; else missingTpl">
          <mat-icon>subtitles</mat-icon>{{ t.role }}：{{ t.text }}
          <em [class]="t.status">当前结论：{{ label(t.status) }}</em>
        </div>
        <ng-template #missingTpl><div class="target missing"><mat-icon>link_off</mat-icon>锚定的台词已从该版本移除</div></ng-template>
        <div class="actions" *ngIf="q.status !== 'closed'">
          <button mat-stroked-button color="primary" *ngIf="q.flags.stale" (click)="reconfirm(q.id)">按当前版本重新确认</button>
          <button mat-button color="warn" (click)="close(q.id)">关闭</button>
        </div>
      </article>

      <p class="empty" *ngIf="!questions.length">还没有疑问。</p>
    </mat-card>
  `,
  styles: [`
    .hint { color: #4b5563; font-size: 13px; }
    .new { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
    .new mat-form-field { width: 180px; }
    .new .full { width: 100%; }
    .offline-hint { color: #b45309; font-size: 13px; }
    .outbox { display: flex; align-items: center; gap: 10px; background: #fff7ed; border: 1px solid #fdba74;
      border-radius: 8px; padding: 10px 12px; margin: 12px 0; font-size: 13px; color: #9a3412; }
    .outbox button { margin-left: auto; }
    .q { border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px 14px; margin: 10px 0; }
    .q.conflict { border-color: #fca5a5; background: #fef2f2; }
    .q.stale { border-color: #fdba74; background: #fff7ed; }
    .q.closed { opacity: .55; }
    .head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13px; }
    .ver { color: #6b7280; }
    .badge { font-size: 12px; padding: 1px 8px; border-radius: 10px; }
    .conflict-badge { background: #dc2626; color: #fff; }
    .stale-badge { background: #d97706; color: #fff; }
    .ok-badge { background: #16a34a; color: #fff; }
    .sync-badge { background: #6b7280; color: #fff; }
    .q p { margin: 8px 0; line-height: 1.6; }
    .target { font-size: 13px; color: #4b5563; background: #f9fafb; border-radius: 8px; padding: 8px 10px;
      display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .target mat-icon { font-size: 16px; height: 16px; width: 16px; }
    .target em { font-style: normal; margin-left: auto; padding: 1px 8px; border-radius: 10px; }
    .target em.pending { color: #b45309; background: #fef3c7; }
    .target em.accepted { color: #15803d; background: #dcfce7; }
    .target em.returned { color: #b91c1c; background: #fee2e2; }
    .target.missing { color: #9a3412; }
    .actions { margin-top: 8px; display: flex; gap: 8px; justify-content: flex-end; }
    .empty { color: #9ca3af; text-align: center; padding: 16px; }
  `]
})
export class QuestionsPanelComponent {
  @Input({ required: true }) version!: ScriptVersion;
  @Input() questions: EnrichedQuestion[] = [];
  @Input() online = true;

  readonly actor = new FormControl('', { nonNullable: true, validators: Validators.required });
  readonly lineId = new FormControl('', { nonNullable: true, validators: Validators.required });
  readonly text = new FormControl('', { nonNullable: true, validators: Validators.required });

  constructor(private readonly store: Store<{ script: ScriptState }>) {}

  get outbox() { return this.questions.filter((q) => !q.synced); }
  label(status: 'pending' | 'accepted' | 'returned') { return STATUS_LABEL[status]; }
  target(q: EnrichedQuestion) { return q.version?.lines.find((line) => line.id === q.lineId); }
  canSubmit() { return this.actor.valid && this.lineId.valid && this.text.valid; }

  add() {
    if (!this.canSubmit()) return;
    this.store.dispatch(addActorQuestion({ actor: this.actor.value, text: this.text.value, lineId: this.lineId.value }));
    this.text.reset();
  }

  flush() { this.store.dispatch(flushQuestionOutbox()); }
  reconfirm(id: string) { this.store.dispatch(reconfirmQuestion({ id })); }
  close(id: string) { this.store.dispatch(closeQuestion({ id })); }
}
