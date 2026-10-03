import { CommonModule } from '@angular/common';
import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { Store } from '@ngrx/store';
import { submitPlaywrightDraft } from '../state/script.actions';
import { ScriptState } from '../state/script.reducer';
import { CueChange, LineChange, ScriptVersion } from '../state/script';

interface LineRow {
  id: string;
  role: string;
  text: string;
}

interface CueRow {
  id: string;
  scene: string;
  text: string;
}

@Component({
  selector: 'app-playwright-draft',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MatButtonModule, MatCardModule, MatFormFieldModule, MatIconModule, MatInputModule],
  template: `
    <mat-card>
      <mat-card-title>编剧交稿</mat-card-title>
      <p class="hint">以 <b>{{ version.label }} rev{{ version.revision }}</b> 为基线。未改动的台词保留舞台监督原结论；双方都改过的挂入待裁决，退回不会被直接冲掉。</p>
      <form [formGroup]="form" (ngSubmit)="submit()">
        <div class="meta">
          <mat-form-field appearance="outline">
            <mat-label>编剧</mat-label>
            <input matInput formControlName="playwright" />
          </mat-form-field>
          <mat-form-field appearance="outline" class="note">
            <mat-label>修订说明</mat-label>
            <input matInput formControlName="note" placeholder="例如：第三场开场句重写" />
          </mat-form-field>
        </div>

        <h4>角色台词</h4>
        <div formArrayName="lines">
          <div class="row" *ngFor="let row of lines.controls; let i = index" [formGroupName]="i">
            <mat-form-field appearance="outline" class="role"><mat-label>角色</mat-label><input matInput formControlName="role" /></mat-form-field>
            <mat-form-field appearance="outline" class="text"><mat-label>台词</mat-label><textarea matInput rows="2" formControlName="text"></textarea></mat-form-field>
            <button type="button" mat-icon-button color="warn" (click)="removeLine(i)"><mat-icon>delete_outline</mat-icon></button>
          </div>
        </div>
        <button type="button" mat-stroked-button class="add" (click)="addLine()"><mat-icon>add</mat-icon>新增台词</button>

        <h4>舞台提示</h4>
        <div formArrayName="cues">
          <div class="row" *ngFor="let row of cues.controls; let i = index" [formGroupName]="i">
            <mat-form-field appearance="outline" class="role"><mat-label>场次</mat-label><input matInput formControlName="scene" /></mat-form-field>
            <mat-form-field appearance="outline" class="text"><mat-label>提示</mat-label><textarea matInput rows="2" formControlName="text"></textarea></mat-form-field>
            <button type="button" mat-icon-button color="warn" (click)="removeCue(i)"><mat-icon>delete_outline</mat-icon></button>
          </div>
        </div>
        <button type="button" mat-stroked-button class="add" (click)="addCue()"><mat-icon>add</mat-icon>新增提示</button>

        <div class="submit">
          <button mat-flat-button color="primary" [disabled]="form.invalid">提交修订稿</button>
          <span class="offline-hint" *ngIf="!online">当前离线：稿件先进入待处理，恢复网络后自动重试。</span>
        </div>
      </form>
    </mat-card>
  `,
  styles: [`
    .hint { color: #4b5563; font-size: 13px; }
    .meta { display: flex; gap: 12px; }
    .meta .note { flex: 1; }
    h4 { margin: 18px 0 8px; }
    .row { display: flex; gap: 10px; align-items: flex-start; }
    .role { width: 150px; flex-shrink: 0; }
    .text { flex: 1; }
    .add { margin: 4px 0 12px; }
    .submit { display: flex; align-items: center; gap: 14px; margin-top: 20px; }
    .offline-hint { color: #b45309; font-size: 13px; }
    mat-form-field { width: 100%; }
  `]
})
export class PlaywrightDraftComponent implements OnChanges {
  @Input({ required: true }) version!: ScriptVersion;
  @Input() online = true;

  readonly form = new FormGroup({
    playwright: new FormControl('林编剧', { nonNullable: true, validators: Validators.required }),
    note: new FormControl('', { nonNullable: true }),
    lines: new FormArray<FormGroup<{ id: FormControl<string>; role: FormControl<string>; text: FormControl<string> }>>([]),
    cues: new FormArray<FormGroup<{ id: FormControl<string>; scene: FormControl<string>; text: FormControl<string> }>>([])
  });

  constructor(private readonly store: Store<{ script: ScriptState }>) {}

  get lines() { return this.form.controls.lines; }
  get cues() { return this.form.controls.cues; }

  ngOnChanges(changes: SimpleChanges) {
    // 切换排练版本后，交稿表单必须以新版本为基线重建，避免拿旧版本行 ID 提交
    if (changes['version'] && this.version) this.resetRows();
  }

  private makeId(prefix: string) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  }

  private lineGroup(row?: LineRow) {
    return new FormGroup({
      id: new FormControl(row?.id ?? this.makeId('l'), { nonNullable: true }),
      role: new FormControl(row?.role ?? '', { nonNullable: true, validators: Validators.required }),
      text: new FormControl(row?.text ?? '', { nonNullable: true, validators: Validators.required })
    });
  }

  private cueGroup(row?: CueRow) {
    return new FormGroup({
      id: new FormControl(row?.id ?? this.makeId('c'), { nonNullable: true }),
      scene: new FormControl(row?.scene ?? '', { nonNullable: true, validators: Validators.required }),
      text: new FormControl(row?.text ?? '', { nonNullable: true, validators: Validators.required })
    });
  }

  resetRows() {
    this.form.setControl('lines', new FormArray(this.version.lines.map((line) => this.lineGroup(line))));
    this.form.setControl('cues', new FormArray(this.version.cues.map((cue) => this.cueGroup(cue))));
  }

  addLine() { this.lines.push(this.lineGroup()); }
  addCue() { this.cues.push(this.cueGroup()); }
  removeLine(index: number) { this.lines.removeAt(index); }
  removeCue(index: number) { this.cues.removeAt(index); }

  submit() {
    const value = this.form.getRawValue();
    const lineChanges: LineChange[] = value.lines.map((line) => ({ id: line.id, role: line.role, text: line.text }));
    const cueChanges: CueChange[] = value.cues.map((cue) => ({ id: cue.id, scene: cue.scene, text: cue.text }));
    this.store.dispatch(submitPlaywrightDraft({
      draft: {
        id: this.makeId('d'),
        baseVersionId: this.version.id,
        baseRevision: this.version.revision,
        playwright: value.playwright,
        note: value.note,
        submittedAt: new Date().toISOString(),
        lineChanges,
        cueChanges
      }
    }));
    this.form.patchValue({ note: '' });
  }
}
