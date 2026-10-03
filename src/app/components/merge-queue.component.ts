import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { Store } from '@ngrx/store';
import { discardPendingChange, rebasePendingChange, resolveArbitration, retryAllPendingChanges, retryPendingChange } from '../state/script.actions';
import { ArbitrationItem, PendingChange, ScriptVersion, STATUS_LABEL } from '../state/script';

@Component({
  selector: 'app-merge-queue',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatCardModule, MatIconModule, MatTabsModule],
  template: `
    <mat-card>
      <mat-card-title>合并与裁决</mat-card-title>
      <mat-tab-group>
        <mat-tab [label]="'待处理改动 (' + pendingChanges.length + ')'">
          <article class="item" *ngFor="let change of pendingChanges">
            <div class="head">
              <b>{{ change.draft.playwright }}</b>
              <span class="ver">基线 {{ labelOf(change.draft.baseVersionId) }} rev{{ change.draft.baseRevision }}</span>
            </div>
            <p class="note">{{ change.draft.note }}</p>
            <p class="reason"><mat-icon>warning_amber</mat-icon>{{ change.reason }}</p>
            <ul class="changes">
              <li *ngFor="let line of change.draft.lineChanges">{{ line.role }}：{{ line.text }}</li>
              <li *ngFor="let cue of change.draft.cueChanges">【{{ cue.scene }}】{{ cue.text }}</li>
            </ul>
            <div class="actions">
              <button mat-flat-button color="primary" (click)="retry(change.id)">重试合并</button>
              <button mat-stroked-button (click)="rebase(change.id)">变基到当前版本</button>
              <button mat-button color="warn" (click)="discard(change.id)">丢弃</button>
            </div>
          </article>
          <div class="bulk" *ngIf="pendingChanges.length">
            <button mat-stroked-button color="primary" (click)="retryAll()">重试全部</button>
            <span>合并失败的改动不会丢失，重新打开仍可继续处理。</span>
          </div>
          <p class="empty" *ngIf="!pendingChanges.length">没有未落地的改动。</p>
        </mat-tab>

        <mat-tab [label]="'待裁决 (' + arbitration.filter(open).length + ')'">
          <article class="item" *ngFor="let item of arbitration" [class.closed]="!item.open">
            <div class="head">
              <b>{{ item.kind === 'line' ? '台词' : '提示' }} · {{ item.kind === 'line' ? item.role : item.scene }}</b>
              <span class="ver">{{ versionLabel(item.targetVersionId) }} rev{{ item.targetRevision }}</span>
              <span class="badge" [ngClass]="item.existingStatus">舞台监督原结论：{{ STATUS[item.existingStatus] }}</span>
            </div>
            <div class="compare">
              <div class="side existing">
                <span>排练版本（{{ item.playwright }} 之外的一方）</span>
                <p>{{ item.existingText }}</p>
              </div>
              <mat-icon>compare_arrows</mat-icon>
              <div class="side proposed">
                <span>{{ item.playwright }} 新稿</span>
                <p>{{ item.proposedText }}</p>
              </div>
            </div>

            <ng-container *ngIf="item.open; else resolvedTpl">
              <div class="mix" *ngIf="mixingId === item.id">
                <textarea rows="2" [(ngModel)]="mixedText" placeholder="输入裁决采用的混合文本"></textarea>
                <div>
                  <button mat-flat-button color="primary" [disabled]="!mixedText.trim()" (click)="applyMix(item)">采用混合文本</button>
                  <button mat-button (click)="mixingId = null">取消</button>
                </div>
              </div>
              <div class="actions" *ngIf="mixingId !== item.id">
                <button mat-stroked-button (click)="keepExisting(item)">维持原结论（退回不被冲掉）</button>
                <button mat-flat-button color="primary" (click)="takeProposed(item)">采纳编剧稿</button>
                <button mat-stroked-button (click)="startMix(item)">混合…</button>
              </div>
            </ng-container>
            <ng-template #resolvedTpl>
              <p class="resolved">
                <mat-icon>check_circle</mat-icon>
                已处理：{{ resolutionLabel(item.resolution) }}<ng-container *ngIf="item.finalText"> —— {{ item.finalText }}</ng-container>
              </p>
            </ng-template>
          </article>
          <p class="empty" *ngIf="!arbitration.length">没有待裁决条目。</p>
        </mat-tab>
      </mat-tab-group>
    </mat-card>
  `,
  styles: [`
    .item { border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px 14px; margin: 10px 0; }
    .item.closed { opacity: .6; }
    .head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13px; }
    .ver { color: #6b7280; }
    .badge { padding: 1px 8px; border-radius: 10px; }
    .badge.pending { color: #b45309; background: #fef3c7; }
    .badge.accepted { color: #15803d; background: #dcfce7; }
    .badge.returned { color: #b91c1c; background: #fee2e2; }
    .note { margin: 6px 0; }
    .reason { color: #b45309; font-size: 13px; display: flex; align-items: center; gap: 4px; }
    .reason mat-icon { font-size: 17px; height: 17px; width: 17px; }
    .changes { margin: 6px 0; padding-left: 20px; font-size: 13px; color: #374151; }
    .changes li { margin: 3px 0; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px; }
    .bulk { display: flex; align-items: center; gap: 12px; margin-top: 12px; font-size: 13px; color: #6b7280; }
    .compare { display: flex; gap: 12px; align-items: stretch; margin: 10px 0; }
    .compare mat-icon { align-self: center; color: #9ca3af; }
    .side { flex: 1; border-radius: 8px; padding: 8px 10px; font-size: 13px; }
    .side span { color: #6b7280; font-size: 12px; }
    .side p { margin: 6px 0 0; line-height: 1.6; }
    .side.existing { background: #f3f4f6; }
    .side.proposed { background: #eff6ff; }
    .mix textarea { width: 100%; border: 1px solid #d1d5db; border-radius: 8px; padding: 8px 10px; }
    .mix > div { display: flex; gap: 8px; justify-content: flex-end; margin-top: 6px; }
    .resolved { display: flex; align-items: center; gap: 6px; color: #15803d; font-size: 13px; }
    .resolved mat-icon { font-size: 17px; height: 17px; width: 17px; }
    .empty { color: #9ca3af; text-align: center; padding: 16px; }
  `]
})
export class MergeQueueComponent {
  @Input() pendingChanges: PendingChange[] = [];
  @Input() arbitration: ArbitrationItem[] = [];
  @Input() versions: ScriptVersion[] = [];

  readonly STATUS = STATUS_LABEL;
  mixingId: string | null = null;
  mixedText = '';

  constructor(private readonly store: Store) {}

  open = (item: ArbitrationItem) => item.open;

  labelOf(versionId: string) { return this.versions.find((v) => v.id === versionId)?.label ?? versionId; }
  versionLabel(versionId: string) { return this.labelOf(versionId); }
  resolutionLabel(resolution?: string) {
    return resolution === 'existing' ? '维持原结论' : resolution === 'proposed' ? '采纳编剧稿' : '采用混合文本';
  }

  retry(id: string) { this.store.dispatch(retryPendingChange({ id })); }
  retryAll() { this.store.dispatch(retryAllPendingChanges()); }
  rebase(id: string) { this.store.dispatch(rebasePendingChange({ id })); }
  discard(id: string) { this.store.dispatch(discardPendingChange({ id })); }

  keepExisting(item: ArbitrationItem) { this.store.dispatch(resolveArbitration({ id: item.id, resolution: 'existing' })); }
  takeProposed(item: ArbitrationItem) { this.store.dispatch(resolveArbitration({ id: item.id, resolution: 'proposed' })); }
  startMix(item: ArbitrationItem) { this.mixingId = item.id; this.mixedText = `${item.existingText} / ${item.proposedText}`; }
  applyMix(item: ArbitrationItem) {
    this.store.dispatch(resolveArbitration({ id: item.id, resolution: 'mixed', finalText: this.mixedText.trim() }));
    this.mixingId = null;
    this.mixedText = '';
  }
}
