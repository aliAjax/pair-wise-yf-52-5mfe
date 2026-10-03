import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatTabsModule } from '@angular/material/tabs';
import { MatToolbarModule } from '@angular/material/toolbar';
import { Store } from '@ngrx/store';
import { TranslocoModule } from '@jsverse/transloco';
import { Observable, Subscription, map } from 'rxjs';
import { activateVersion, setOnline, toggleRehearsal } from './state/script.actions';
import { ScriptState } from './state/script.reducer';
import { ScriptVersion } from './state/script';
import { EnrichedQuestion, enrichQuestions, openArbitrationCount, outboxCount, pendingChangeCount } from './state/script.selectors';
import { ScriptViewComponent } from './components/script-view.component';
import { PlaywrightDraftComponent } from './components/playwright-draft.component';
import { QuestionsPanelComponent } from './components/questions-panel.component';
import { MergeQueueComponent } from './components/merge-queue.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule, TranslocoModule, MatToolbarModule, MatButtonModule, MatCardModule, MatTabsModule,
    ScriptViewComponent, PlaywrightDraftComponent, QuestionsPanelComponent, MergeQueueComponent
  ],
  template: `
    <mat-toolbar color="primary" class="topbar">
      <span>{{ 'title' | transloco }}</span>
      <span class="spacer"></span>
      <button mat-stroked-button (click)="toggleOnline()">
        {{ (online ? 'online' : 'offline') | transloco }}
      </button>
      <button mat-flat-button color="accent" (click)="toggleRehearsal()">
        {{ (rehearsal ? 'normalMode' : 'rehearsalMode') | transloco }}
      </button>
    </mat-toolbar>

    <main [class.rehearsal]="rehearsal">
      <section class="summary" *ngIf="vm$ | async as vm">
        <mat-card>
          <mat-card-title>排练版本</mat-card-title>
          <p>舞台监督已把当前排练版本的台词标成采纳或退回；编剧再交稿时，没被改过的台词保住原结论，双方都改过的进待裁决。</p>
          <div class="chips">
            <button mat-stroked-button *ngFor="let version of vm.versions"
              [color]="version.id === vm.active.id ? 'primary' : ''" (click)="activate(version.id)">
              {{ version.label }} · rev{{ version.revision }} · {{ version.playwright }}
            </button>
          </div>
        </mat-card>
      </section>

      <ng-container *ngIf="vm$ | async as vm">
        <mat-tab-group class="panels">
          <mat-tab label="排练台本">
            <app-script-view [version]="vm.active" [questions]="vm.questions" />
          </mat-tab>
          <mat-tab label="编剧交稿">
            <app-playwright-draft [version]="vm.active" [online]="vm.online" />
          </mat-tab>
          <mat-tab>
            <ng-template matTabLabel>
              演员疑问<span class="tab-dot" *ngIf="vm.outboxCount">（{{ vm.outboxCount }} 待同步）</span>
            </ng-template>
            <app-questions-panel [version]="vm.active" [questions]="vm.questions" [online]="vm.online" />
          </mat-tab>
          <mat-tab>
            <ng-template matTabLabel>
              合并与裁决<span class="tab-dot warn" *ngIf="vm.pendingCount + vm.arbitrationCount">
                （{{ vm.pendingCount }} 待处理 / {{ vm.arbitrationCount }} 待裁决）</span>
            </ng-template>
            <app-merge-queue [pendingChanges]="vm.pendingChanges" [arbitration]="vm.arbitration" [versions]="vm.versions" />
          </mat-tab>
        </mat-tab-group>

        <aside class="offline" *ngIf="!vm.online">
          网络不可用：编剧交稿与演员疑问先留在本机待处理/待同步，恢复网络后逐条落地，已有采纳与退回结论不会被冲掉。
        </aside>
      </ng-container>
    </main>
  `,
  styles: [`
    .topbar { position: sticky; top: 0; z-index: 4; gap: 10px; }
    .topbar button { margin-left: 8px; }
    .spacer { flex: 1; }
    main { max-width: 1080px; margin: 24px auto; padding: 0 18px 64px; }
    main.rehearsal { max-width: 900px; background: #111827; color: #f9fafb; margin-top: 0; padding-top: 18px; min-height: 100vh; }
    main.rehearsal ::ng-deep .mat-mdc-tab .mdc-tab__text-label,
    main.rehearsal ::ng-deep .mat-expansion-panel { color: #f9fafb; }
    .summary { margin-bottom: 14px; }
    .chips { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 12px; }
    .panels mat-card { box-shadow: none; border: 1px solid #e5e7eb; }
    .tab-dot { font-size: 12px; color: #b45309; }
    .tab-dot.warn { color: #b91c1c; }
    main.rehearsal app-script-view { font-size: 22px; }
    main.rehearsal ::ng-deep .line p { font-size: 24px !important; }
    .offline { position: fixed; right: 18px; bottom: 18px; max-width: 360px; padding: 14px 18px; color: #fff;
      background: #b45309; border-radius: 10px; box-shadow: 0 8px 30px #0003; font-size: 13px; line-height: 1.6; }
  `]
})
export class AppComponent implements OnInit, OnDestroy {
  readonly vm$: Observable<{
    versions: ScriptVersion[];
    active: ScriptVersion;
    online: boolean;
    questions: EnrichedQuestion[];
    pendingChanges: ScriptState['pendingChanges'];
    arbitration: ScriptState['arbitration'];
    pendingCount: number;
    arbitrationCount: number;
    outboxCount: number;
  }>;
  online = true;
  rehearsal = false;
  private subscription?: Subscription;
  private onlineHandler = () => this.store.dispatch(setOnline({ online: navigator.onLine }));

  constructor(private readonly store: Store<{ script: ScriptState }>) {
    this.vm$ = this.store.select('script').pipe(
      map((state) => ({
        versions: state.versions,
        active: state.versions.find((item) => item.id === state.activeVersionId) ?? state.versions[0],
        online: state.online,
        questions: enrichQuestions(state.questions, state.versions),
        pendingChanges: state.pendingChanges,
        arbitration: state.arbitration,
        pendingCount: pendingChangeCount(state),
        arbitrationCount: openArbitrationCount(state),
        outboxCount: outboxCount(state)
      }))
    );
    this.store.select((state) => state.script.online).subscribe((online) => { this.online = online; });
    this.store.select((state) => state.script.rehearsalMode).subscribe((mode) => { this.rehearsal = mode; });
  }

  ngOnInit() {
    window.addEventListener('online', this.onlineHandler);
    window.addEventListener('offline', this.onlineHandler);
    // 合并失败未落地的改动、待裁决与待同步疑问都持久化，重新打开可继续处理
    this.subscription = this.store.select('script')
      .subscribe((state) => localStorage.setItem('yf52-script-state', JSON.stringify(state)));
  }

  ngOnDestroy() {
    window.removeEventListener('online', this.onlineHandler);
    window.removeEventListener('offline', this.onlineHandler);
    this.subscription?.unsubscribe();
  }

  activate(id: string) { this.store.dispatch(activateVersion({ id })); }
  toggleRehearsal() { this.store.dispatch(toggleRehearsal()); }
  toggleOnline() { this.store.dispatch(setOnline({ online: !this.online })); }
}
