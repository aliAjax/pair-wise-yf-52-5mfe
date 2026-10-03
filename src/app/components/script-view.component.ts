import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { Store } from '@ngrx/store';
import { reorderLines, reviewCue, reviewLine } from '../state/script.actions';
import { ScriptState } from '../state/script.reducer';
import { EnrichedQuestion } from '../state/script.selectors';
import { ScriptVersion, STATUS_LABEL } from '../state/script';

@Component({
  selector: 'app-script-view',
  standalone: true,
  imports: [CommonModule, DragDropModule, MatButtonModule, MatCardModule, MatChipsModule, MatIconModule, MatTabsModule],
  template: `
    <mat-card class="script">
      <mat-card-title>{{ version.label }} <span class="rev">rev{{ version.revision }}</span></mat-card-title>
      <mat-card-subtitle>{{ version.note }}</mat-card-subtitle>
      <mat-tab-group>
        <mat-tab [label]="'角色台词 (' + version.lines.length + ')'">
          <div cdkDropList (cdkDropListDropped)="drop($event)">
            <article class="line" cdkDrag *ngFor="let line of version.lines">
              <div class="body">
                <div class="head"><b>{{ line.role }}</b><span class="status" [ngClass]="line.status">{{ label(line.status) }}</span></div>
                <p>{{ line.text }}</p>
                <div class="questions" *ngIf="questionsFor(line.id) as qs">
                  <span class="q" *ngFor="let q of qs" [class.conflict]="q.flags.conflict" [class.stale]="q.flags.stale && !q.flags.conflict">
                    <mat-icon>help_outline</mat-icon>{{ q.actor }}：{{ q.text }}
                    <em *ngIf="q.flags.conflict">· 与退回结论冲突</em>
                    <em *ngIf="q.flags.stale && !q.flags.conflict">· 已过期待重新确认</em>
                  </span>
                </div>
              </div>
              <div class="actions">
                <button mat-stroked-button color="primary" [disabled]="line.status === 'accepted'"
                  (click)="reviewLine(line.id, 'accepted')">采纳</button>
                <button mat-stroked-button color="warn" [disabled]="line.status === 'returned'"
                  (click)="reviewLine(line.id, 'returned')">退回</button>
              </div>
            </article>
          </div>
        </mat-tab>
        <mat-tab [label]="'舞台提示 (' + version.cues.length + ')'">
          <article class="line" *ngFor="let cue of version.cues">
            <div class="body">
              <div class="head"><b>{{ cue.scene }}</b><span class="status" [ngClass]="cue.status">{{ label(cue.status) }}</span></div>
              <p>{{ cue.text }}</p>
            </div>
            <div class="actions">
              <button mat-stroked-button color="primary" [disabled]="cue.status === 'accepted'"
                (click)="reviewCue(cue.id, 'accepted')">采纳</button>
              <button mat-stroked-button color="warn" [disabled]="cue.status === 'returned'"
                (click)="reviewCue(cue.id, 'returned')">退回</button>
            </div>
          </article>
        </mat-tab>
      </mat-tab-group>
    </mat-card>
  `,
  styles: [`
    .rev { font-size: 13px; color: #6b7280; font-weight: 400; margin-left: 6px; }
    .line { display: flex; justify-content: space-between; gap: 16px; align-items: center;
      padding: 14px 4px; border-bottom: 1px solid #e5e7eb; }
    .line:first-child { margin-top: 8px; }
    .head { display: flex; align-items: center; gap: 10px; }
    .line p { margin: 8px 0; font-size: 17px; line-height: 1.6; }
    .actions { display: flex; flex-direction: column; gap: 8px; flex-shrink: 0; }
    .status { font-size: 12px; padding: 2px 8px; border-radius: 10px; }
    .status.pending { color: #b45309; background: #fef3c7; }
    .status.accepted { color: #15803d; background: #dcfce7; }
    .status.returned { color: #b91c1c; background: #fee2e2; }
    .questions { display: flex; flex-direction: column; gap: 4px; }
    .q { font-size: 13px; color: #374151; background: #f3f4f6; border-radius: 8px; padding: 4px 8px;
      display: inline-flex; align-items: center; gap: 4px; width: fit-content; }
    .q mat-icon { font-size: 15px; height: 15px; width: 15px; }
    .q em { color: #6b7280; font-style: normal; }
    .q.conflict { background: #fee2e2; color: #991b1b; }
    .q.conflict em { color: #b91c1c; font-weight: 600; }
    .q.stale { background: #ffedd5; color: #9a3412; }
    .q.stale em { color: #b45309; font-weight: 600; }
    .cdk-drag-preview { background: #fff; box-shadow: 0 6px 24px #0002; border-radius: 8px; }
  `]
})
export class ScriptViewComponent {
  @Input({ required: true }) version!: ScriptVersion;
  @Input() questions: EnrichedQuestion[] = [];

  constructor(private readonly store: Store<{ script: ScriptState }>) {}

  label(status: 'pending' | 'accepted' | 'returned') { return STATUS_LABEL[status]; }
  questionsFor(lineId: string) { return this.questions.filter((q) => q.lineId === lineId && q.status !== 'closed'); }
  reviewLine(id: string, decision: 'accepted' | 'returned') { this.store.dispatch(reviewLine({ id, decision })); }
  reviewCue(id: string, decision: 'accepted' | 'returned') { this.store.dispatch(reviewCue({ id, decision })); }
  drop(event: CdkDragDrop<unknown>) {
    if (event.previousIndex !== event.currentIndex) {
      this.store.dispatch(reorderLines({ from: event.previousIndex, to: event.currentIndex }));
    }
  }
}
